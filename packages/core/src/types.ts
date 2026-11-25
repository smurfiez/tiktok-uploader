export type Visibility = 'everyone' | 'friends' | 'private'

export type ThemeMode = 'system' | 'light' | 'dark'

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface Account {
  id: string
  label: string
  handle?: string
  createdAt: string
}

export interface AccountSummary extends Account {
  signedIn: boolean
  locked: boolean
  lockSource?: string
}

export interface VideoItem {
  path: string
  title: string
  size: number
  mtimeMs: number
}

export interface Job {
  id: string
  videoPath: string
  description: string
  /** UTC ISO string, or null to post now */
  schedule: string | null
  visibility: Visibility
  draft: boolean
  aiLabel: boolean
  comment: boolean
  duet: boolean
  stitch: boolean
  status: JobStatus
  error?: string
  screenshot?: string
}

export type QueueEvent =
  | { type: 'job-status'; jobId: string; status: JobStatus; error?: string; screenshot?: string }
  | { type: 'job-stage'; jobId: string; stage: string }
  | { type: 'log'; jobId?: string; message: string }
  | { type: 'auth-required'; message: string }
  | { type: 'queue-done'; done: number; failed: number; skipped: number }

export interface Settings {
  defaultAccount: string
  headless: boolean
  /** Chrome/Edge/Brave binary; auto-detected when empty */
  browserPath: string
  /** 10 for standard web accounts, 30 for TikTok Studio */
  maxScheduleDays: number
  visibility: Visibility
  aiLabel: boolean
  theme?: ThemeMode
}

export interface AuthStatus {
  signedIn: boolean
  message: string
  /** The profile is in use by another run, so the session could not be checked */
  locked?: boolean
}

export interface LockInfo {
  pid: number
  source: string
  startedAt: string
}

/** Relative scheduling: `12h`, `1d`, `15m`, `30s` */
export interface StaggerRule {
  /** ISO string, `YYYY-MM-DD HH:mm`, `today HH:mm` or `tomorrow HH:mm` */
  start: string | Date
  every: string
  count: number
  jitter?: string
  /** Allowed posting hours, e.g. `09:00-21:00` */
  window?: string
}
