/**
 * TikTok scheduling rules: a 5-minute grid, at least 20 minutes of lead time,
 * and a maximum horizon that depends on the account type.
 */

import type { StaggerRule } from './types'
import { parseDuration } from './utils'

const VALID_MINUTE_MULTIPLE = 5
export const MIN_LEAD_MINUTES = 20
export const DEFAULT_MAX_SCHEDULE_DAYS = 10

export function roundUpToFive(date: Date): Date {
  const rounded = new Date(date)
  const remainder = rounded.getUTCMinutes() % VALID_MINUTE_MULTIPLE

  if (remainder !== 0) {
    rounded.setUTCMinutes(rounded.getUTCMinutes() + (VALID_MINUTE_MULTIPLE - remainder), 0, 0)
  } else {
    rounded.setUTCSeconds(0, 0)
  }

  return rounded
}

export function isValidSchedule(
  schedule: Date,
  now = new Date(),
  maxScheduleDays = DEFAULT_MAX_SCHEDULE_DAYS
): boolean {
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60_000
  const latest = now.getTime() + maxScheduleDays * 24 * 60 * 60_000

  return (
    schedule.getTime() >= earliest &&
    schedule.getTime() <= latest &&
    schedule.getUTCMinutes() % VALID_MINUTE_MULTIPLE === 0
  )
}

export function normalizeSchedule(
  schedule: Date,
  now = new Date(),
  maxScheduleDays = DEFAULT_MAX_SCHEDULE_DAYS
): { ok: true; date: Date } | { ok: false; error: string } {
  const rounded = roundUpToFive(schedule)

  if (!isValidSchedule(rounded, now, maxScheduleDays)) {
    return {
      ok: false,
      error: `Scheduled time must be ${MIN_LEAD_MINUTES} minutes to ${maxScheduleDays} days ahead, on a 5-minute mark`
    }
  }

  return { ok: true, date: rounded }
}

/**
 * `2026-12-01 18:00`, a full ISO string, or `today 18:00` / `tomorrow 18:00`.
 * Wall-clock times are read in the machine's timezone.
 */
export function parseStart(value: string | Date, now = new Date()): Date {
  if (value instanceof Date) return new Date(value)

  const text = value.trim()
  const relative = /^(today|tomorrow)\s+(\d{1,2}):(\d{2})$/i.exec(text)
  if (relative) {
    const date = new Date(now)
    if (relative[1].toLowerCase() === 'tomorrow') date.setDate(date.getDate() + 1)
    date.setHours(Number(relative[2]), Number(relative[3]), 0, 0)
    return date
  }

  const wallClock = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (wallClock) {
    return new Date(
      Number(wallClock[1]),
      Number(wallClock[2]) - 1,
      Number(wallClock[3]),
      Number(wallClock[4]),
      Number(wallClock[5]),
      Number(wallClock[6] ?? 0)
    )
  }

  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid start "${value}": use an ISO date, "2026-12-01 18:00" or "tomorrow 18:00"`)
  }
  return parsed
}

/** `09:00-21:00`; a window may wrap midnight, e.g. `22:00-02:00`. */
export function parseWindow(window: string): { start: number; end: number } {
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(window.trim())
  if (!match) throw new Error(`Invalid window "${window}": use "09:00-21:00"`)

  const start = Number(match[1]) * 60 + Number(match[2])
  const end = Number(match[3]) * 60 + Number(match[4])
  if (start > 24 * 60 || end > 24 * 60) throw new Error(`Invalid window "${window}"`)
  return { start, end }
}

export function inWindow(date: Date, window: string): boolean {
  const { start, end } = parseWindow(window)
  const minute = date.getHours() * 60 + date.getMinutes()
  return start <= end ? minute >= start && minute <= end : minute >= start || minute <= end
}

/** Moves a slot to the next opening, so jobs never land outside the window. */
export function pushIntoWindow(date: Date, window: string): Date {
  if (inWindow(date, window)) return date

  const { start, end } = parseWindow(window)
  const pushed = new Date(date)
  const minute = pushed.getHours() * 60 + pushed.getMinutes()
  const wraps = start > end

  const outside = wraps ? minute > end && minute < start : minute < start
  if (outside) {
    pushed.setHours(Math.floor(start / 60), start % 60, 0, 0)
  } else {
    pushed.setDate(pushed.getDate() + 1)
    pushed.setHours(Math.floor(start / 60), start % 60, 0, 0)
  }
  return pushed
}

/**
 * Bulk auto-stagger: `count` slots from `start`, one `every` apart, with
 * optional random jitter pulled back onto TikTok's 5-minute grid, and kept
 * inside the allowed posting window.
 */
export function buildStaggeredSchedule(
  rule: StaggerRule,
  now = new Date(),
  random: () => number = Math.random
): Date[] {
  const interval = parseDuration(rule.every)
  if (interval < 5 * 60_000) {
    throw new Error('Interval must be at least 5m so slots stay on TikTok\'s grid')
  }

  const start = parseStart(rule.start, now)
  const jitter = rule.jitter ? parseDuration(rule.jitter) : 0
  const dates: Date[] = []

  for (let index = 0; index < rule.count; index++) {
    let time = start.getTime() + index * interval
    if (jitter > 0) time += (random() * 2 - 1) * jitter

    let date = roundUpToFive(new Date(time))
    if (rule.window) date = pushIntoWindow(date, rule.window)
    dates.push(date)
  }

  return dates
}

/**
 * Throws unless every slot is schedulable now: 20+ minutes of lead, inside the
 * horizon, on TikTok's 5-minute grid.
 */
export function assertSchedulable(
  dates: Date[],
  now = new Date(),
  maxScheduleDays = DEFAULT_MAX_SCHEDULE_DAYS
): void {
  for (const date of dates) {
    if (!isValidSchedule(date, now, maxScheduleDays)) {
      throw new Error(
        `Slot ${date.toISOString()} is not schedulable: needs ${MIN_LEAD_MINUTES}+ minutes of lead and at most ${maxScheduleDays} days, on a 5-minute mark`
      )
    }
  }
}

export function assertWithinHorizon(
  dates: Date[],
  now = new Date(),
  maxScheduleDays = DEFAULT_MAX_SCHEDULE_DAYS
): void {
  const latest = now.getTime() + maxScheduleDays * 24 * 60 * 60_000
  const beyond = dates.find((date) => date.getTime() > latest)
  if (beyond) {
    throw new Error(
      `Slot ${beyond.toISOString()} is more than ${maxScheduleDays} days ahead; raise maxScheduleDays for a TikTok Studio account`
    )
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export function monthNumber(name: string): number {
  const index = MONTH_NAMES.findIndex((month) => month.toLowerCase() === name.trim().toLowerCase())
  return index === -1 ? 0 : index + 1
}

export function monthNumberFromShort(name: string): number {
  const index = MONTH_NAMES.findIndex(
    (month) => month.slice(0, 3).toLowerCase() === name.trim().toLowerCase()
  )
  return index === -1 ? 0 : index + 1
}

/** The date parts as TikTok's calendar shows them, in the browser's timezone. */
export function partsInZone(
  date: Date,
  timeZone: string
): { month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false
  }).formatToParts(date)

  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')

  return {
    month: value('month'),
    day: value('day'),
    hour: value('hour') % 24,
    minute: value('minute')
  }
}

/** Months to step forward, or a single step back for far dates. */
export function calendarSteps(currentMonth: number, targetMonth: number): number {
  const delta = (((targetMonth - currentMonth) % 12) + 12) % 12
  return delta >= 1 && delta <= 2 ? delta : -1
}
