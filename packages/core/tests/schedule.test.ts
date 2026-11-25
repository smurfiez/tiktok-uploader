import { describe, expect, it } from 'vitest'

import {
  assertWithinHorizon,
  buildStaggeredSchedule,
  calendarSteps,
  DEFAULT_MAX_SCHEDULE_DAYS,
  inWindow,
  isValidSchedule,
  MIN_LEAD_MINUTES,
  parseStart,
  parseWindow,
  partsInZone,
  pushIntoWindow,
  roundUpToFive
} from '../src/schedule'

const NOW = new Date('2026-12-01T10:00:00.000Z')
const DAY = 24 * 60 * 60_000

describe('roundUpToFive', () => {
  it('rounds a non-grid minute up and clears seconds', () => {
    expect(roundUpToFive(new Date('2026-12-01T18:02:30.000Z')).toISOString()).toBe(
      '2026-12-01T18:05:00.000Z'
    )
  })

  it('keeps an exact grid minute and clears seconds', () => {
    expect(roundUpToFive(new Date('2026-12-01T18:25:59.000Z')).toISOString()).toBe(
      '2026-12-01T18:25:00.000Z'
    )
  })

  it('does not mutate the input', () => {
    const date = new Date('2026-12-01T18:01:00.000Z')
    roundUpToFive(date)
    expect(date.getUTCMinutes()).toBe(1)
  })
})

describe('isValidSchedule', () => {
  it('rejects a slot 19 minutes ahead', () => {
    expect(isValidSchedule(new Date(NOW.getTime() + 19 * 60_000), NOW)).toBe(false)
  })

  it('accepts a 5-minute slot 20 minutes ahead', () => {
    expect(MIN_LEAD_MINUTES).toBe(20)
    expect(isValidSchedule(new Date(NOW.getTime() + 20 * 60_000), NOW)).toBe(true)
  })

  it('rejects a slot off the 5-minute grid', () => {
    expect(isValidSchedule(new Date(NOW.getTime() + 25 * 60_000 + 60_000), NOW)).toBe(false)
  })

  it('accepts the 10-day edge and rejects one past it', () => {
    expect(DEFAULT_MAX_SCHEDULE_DAYS).toBe(10)
    expect(isValidSchedule(new Date(NOW.getTime() + 10 * DAY), NOW)).toBe(true)
    expect(isValidSchedule(new Date(NOW.getTime() + 10 * DAY + 5 * 60_000), NOW)).toBe(false)
  })

  it('honours a 30-day horizon for Studio accounts', () => {
    expect(isValidSchedule(new Date(NOW.getTime() + 20 * DAY), NOW, 30)).toBe(true)
    expect(isValidSchedule(new Date(NOW.getTime() + 31 * DAY), NOW, 30)).toBe(false)
  })
})

describe('parseStart', () => {
  it('parses a full ISO string as an instant', () => {
    expect(parseStart('2026-12-01T18:00:00.000Z').toISOString()).toBe(
      '2026-12-01T18:00:00.000Z'
    )
  })

  it('parses "2026-12-01 18:00" as wall-clock time', () => {
    const date = parseStart('2026-12-01 18:00')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(11)
    expect(date.getDate()).toBe(1)
    expect(date.getHours()).toBe(18)
    expect(date.getMinutes()).toBe(0)
  })

  it('parses "tomorrow 18:00" relative to an injected now', () => {
    const now = new Date(2026, 11, 1, 10, 0, 0)
    const date = parseStart('tomorrow 18:00', now)
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(11)
    expect(date.getDate()).toBe(2)
    expect(date.getHours()).toBe(18)
  })

  it('parses "today 09:30" relative to an injected now', () => {
    const date = parseStart('today 09:30', new Date(2026, 11, 1, 10, 0, 0))
    expect(date.getDate()).toBe(1)
    expect(date.getHours()).toBe(9)
    expect(date.getMinutes()).toBe(30)
  })

  it('returns a copy of a Date input', () => {
    const input = new Date('2026-12-01T18:00:00.000Z')
    const parsed = parseStart(input)
    expect(parsed.toISOString()).toBe(input.toISOString())
    expect(parsed).not.toBe(input)
  })

  it('throws on garbage', () => {
    expect(() => parseStart('someday soon')).toThrow(/Invalid start/)
  })
})

describe('parseWindow / inWindow', () => {
  it('parses a normal window', () => {
    expect(parseWindow('09:00-21:00')).toEqual({ start: 540, end: 1260 })
  })

  it('parses a window that wraps midnight', () => {
    expect(parseWindow('22:00-02:00')).toEqual({ start: 1320, end: 120 })
  })

  it('throws on a malformed window', () => {
    expect(() => parseWindow('9 to 5')).toThrow(/Invalid window/)
  })

  it('checks a normal window inclusively', () => {
    expect(inWindow(new Date(2026, 11, 1, 10, 0), '09:00-21:00')).toBe(true)
    expect(inWindow(new Date(2026, 11, 1, 8, 59), '09:00-21:00')).toBe(false)
    expect(inWindow(new Date(2026, 11, 1, 9, 0), '09:00-21:00')).toBe(true)
    expect(inWindow(new Date(2026, 11, 1, 21, 0), '09:00-21:00')).toBe(true)
    expect(inWindow(new Date(2026, 11, 1, 21, 1), '09:00-21:00')).toBe(false)
  })

  it('checks a wrapping window across midnight', () => {
    expect(inWindow(new Date(2026, 11, 1, 23, 0), '22:00-02:00')).toBe(true)
    expect(inWindow(new Date(2026, 11, 1, 1, 0), '22:00-02:00')).toBe(true)
    expect(inWindow(new Date(2026, 11, 1, 2, 0), '22:00-02:00')).toBe(true)
    expect(inWindow(new Date(2026, 11, 1, 3, 0), '22:00-02:00')).toBe(false)
    expect(inWindow(new Date(2026, 11, 1, 12, 0), '22:00-02:00')).toBe(false)
  })
})

describe('pushIntoWindow', () => {
  it('leaves an in-window slot untouched', () => {
    const date = new Date(2026, 11, 1, 10, 15)
    expect(pushIntoWindow(date, '09:00-21:00').getTime()).toBe(date.getTime())
  })

  it('moves an early slot to the same day opening', () => {
    const pushed = pushIntoWindow(new Date(2026, 11, 1, 6, 30), '09:00-21:00')
    expect(pushed.getDate()).toBe(1)
    expect(pushed.getHours()).toBe(9)
    expect(pushed.getMinutes()).toBe(0)
  })

  it('moves a late slot to the next day opening', () => {
    const pushed = pushIntoWindow(new Date(2026, 11, 1, 22, 0), '09:00-21:00')
    expect(pushed.getDate()).toBe(2)
    expect(pushed.getHours()).toBe(9)
    expect(pushed.getMinutes()).toBe(0)
  })

  it('moves a daytime slot of a wrapping window to 22:00 the same day', () => {
    const pushed = pushIntoWindow(new Date(2026, 11, 1, 12, 0), '22:00-02:00')
    expect(pushed.getDate()).toBe(1)
    expect(pushed.getHours()).toBe(22)
  })

  it('moves a 03:00 slot to 22:00 the same day for a wrapping window', () => {
    const pushed = pushIntoWindow(new Date(2026, 11, 1, 3, 0), '22:00-02:00')
    expect(pushed.getDate()).toBe(1)
    expect(pushed.getHours()).toBe(22)
  })
})

describe('buildStaggeredSchedule', () => {
  it('spaces count slots by the interval', () => {
    const dates = buildStaggeredSchedule(
      { start: '2026-12-01T18:00:00.000Z', every: '30m', count: 3 },
      NOW
    )

    expect(dates.map((date) => date.toISOString())).toEqual([
      '2026-12-01T18:00:00.000Z',
      '2026-12-01T18:30:00.000Z',
      '2026-12-01T19:00:00.000Z'
    ])
  })

  it('rounds the start onto the 5-minute grid', () => {
    const [date] = buildStaggeredSchedule(
      { start: '2026-12-01T18:02:10.000Z', every: '1d', count: 1 },
      NOW
    )
    expect(date.toISOString()).toBe('2026-12-01T18:05:00.000Z')
  })

  it('adds no offset when random() is 0.5', () => {
    const dates = buildStaggeredSchedule(
      { start: '2026-12-01T18:00:00.000Z', every: '1d', count: 2, jitter: '15m' },
      NOW,
      () => 0.5
    )
    expect(dates.map((date) => date.toISOString())).toEqual([
      '2026-12-01T18:00:00.000Z',
      '2026-12-02T18:00:00.000Z'
    ])
  })

  it('adds the full jitter when random() is 1 and snaps back to the grid', () => {
    const dates = buildStaggeredSchedule(
      { start: '2026-12-01T18:00:00.000Z', every: '1d', count: 1, jitter: '1m' },
      NOW,
      () => 1
    )
    expect(dates[0].toISOString()).toBe('2026-12-01T18:05:00.000Z')
  })

  it('subtracts the full jitter when random() is 0', () => {
    const [date] = buildStaggeredSchedule(
      { start: '2026-12-01T18:00:00.000Z', every: '1d', count: 1, jitter: '15m' },
      NOW,
      () => 0
    )
    expect(date.toISOString()).toBe('2026-12-01T17:45:00.000Z')
  })

  it('pushes quiet-hours slots into the window', () => {
    const dates = buildStaggeredSchedule(
      { start: new Date(2026, 11, 1, 22, 0, 0), every: '1h', count: 2, window: '09:00-21:00' },
      NOW
    )

    expect(dates.map((date) => [date.getDate(), date.getHours()])).toEqual([
      [2, 9],
      [2, 9]
    ])
  })

  it('rejects an interval under 5 minutes', () => {
    expect(() =>
      buildStaggeredSchedule({ start: '2026-12-01T18:00:00.000Z', every: '4m', count: 2 }, NOW)
    ).toThrow(/at least 5m/)
  })
})

describe('assertWithinHorizon', () => {
  it('accepts slots inside the horizon', () => {
    expect(() => assertWithinHorizon([new Date(NOW.getTime() + DAY)], NOW)).not.toThrow()
  })

  it('throws past the 10-day horizon', () => {
    expect(() => assertWithinHorizon([new Date(NOW.getTime() + 11 * DAY)], NOW)).toThrow(
      /more than 10 days ahead/
    )
  })

  it('throws past a 30-day horizon', () => {
    expect(() => assertWithinHorizon([new Date(NOW.getTime() + 31 * DAY)], NOW, 30)).toThrow(
      /more than 30 days ahead/
    )
    expect(() => assertWithinHorizon([new Date(NOW.getTime() + 20 * DAY)], NOW, 30)).not.toThrow()
  })
})

describe('partsInZone', () => {
  it('reads UTC parts', () => {
    expect(partsInZone(new Date('2026-12-01T18:05:00.000Z'), 'UTC')).toEqual({
      month: 12,
      day: 1,
      hour: 18,
      minute: 5
    })
  })

  it('reads midnight as hour 0, not 24', () => {
    expect(partsInZone(new Date('2026-12-01T00:00:00.000Z'), 'UTC').hour).toBe(0)
  })

  it('applies an explicit zone across DST', () => {
    expect(partsInZone(new Date('2026-12-01T12:00:00.000Z'), 'America/New_York').hour).toBe(7)
    expect(partsInZone(new Date('2026-07-01T12:00:00.000Z'), 'America/New_York').hour).toBe(8)
  })

  it('rolls the day forward in an ahead-of-UTC zone', () => {
    expect(partsInZone(new Date('2026-12-01T18:00:00.000Z'), 'Asia/Tokyo')).toEqual({
      month: 12,
      day: 2,
      hour: 3,
      minute: 0
    })
  })
})

describe('calendarSteps', () => {
  it('steps forward one or two months when close', () => {
    expect(calendarSteps(1, 2)).toBe(1)
    expect(calendarSteps(1, 3)).toBe(2)
    expect(calendarSteps(11, 1)).toBe(2)
  })

  it('steps back for the same or a far month', () => {
    expect(calendarSteps(1, 1)).toBe(-1)
    expect(calendarSteps(1, 4)).toBe(-1)
    expect(calendarSteps(1, 11)).toBe(-1)
  })
})
