import type { Job, JobStatus, Visibility } from '@tiktok-uploader/core'

/** Feed preview truncation point. Mirrors core MAX_DESCRIPTION_LENGTH. */
export const SOFT_LIMIT = 150
/** Hard TikTok description cap. Mirrors core MAX_DESCRIPTION_HARD. */
export const HARD_LIMIT = 2200
/** Minimum lead time for a scheduled post. */
export const MIN_LEAD_MINUTES = 20

export const VISIBILITIES: { value: Visibility; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
  { value: 'private', label: 'Private' }
]

export const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped'
}

export const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|flv|wmv)$/i

export interface LogLine {
  ts: string
  message: string
  level: 'info' | 'error'
}

export interface ToastItem {
  id: string
  message: string
  tone: 'info' | 'ok' | 'error'
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function localInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function isoToLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : localInput(d)
}

export function localToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function stamp(): string {
  return new Date().toLocaleTimeString(undefined, { hour12: false })
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Uppercased extension without the dot, e.g. `MP4`; empty when there is none. */
export function fileExt(path: string): string {
  return baseName(path).match(/\.([^.]+)$/)?.[1].toUpperCase() ?? ''
}

export function stem(path: string): string {
  return baseName(path).replace(/\.[^.]+$/, '')
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function newJob(path: string, title: string, defaults: { visibility: Visibility; aiLabel: boolean }): Job {
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    videoPath: path,
    description: title,
    schedule: null,
    visibility: defaults.visibility,
    draft: false,
    aiLabel: defaults.aiLabel,
    comment: true,
    duet: true,
    stitch: true,
    status: 'pending'
  }
}

export function formatWhen(iso: string | null): string {
  if (!iso) return 'post now'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'post now' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function validateRowSchedule(
  iso: string | null,
  maxScheduleDays: number
): { level: 'error' | 'warn'; text: string } | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  if (d.getTime() < now.getTime() + MIN_LEAD_MINUTES * 60 * 1000) {
    return { level: 'error', text: `Must be at least ${MIN_LEAD_MINUTES} min ahead` }
  }
  if (d.getTime() > now.getTime() + maxScheduleDays * 24 * 60 * 60 * 1000) {
    return { level: 'error', text: `Exceeds ${maxScheduleDays}-day limit` }
  }
  if (d.getMinutes() % 5 !== 0) return { level: 'warn', text: 'Will round to 5-min mark' }
  return null
}

export function detectCookieFormat(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('[')) return 'JSON cookies'
  if (trimmed.split(/\r?\n/).some((line) => line.split('\t').length >= 7)) return 'Netscape cookies.txt'
  if (trimmed.includes('=')) return 'Cookie header'
  if (!/\s/.test(trimmed) && trimmed.length >= 8) return 'sessionid token'
  return null
}
