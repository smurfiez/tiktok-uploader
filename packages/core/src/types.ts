export type Visibility = 'everyone' | 'friends' | 'private'

export type ThemeMode = 'system' | 'light' | 'dark'

export type JobStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export type AccountColor = 'red' | 'teal' | 'blue' | 'amber' | 'purple' | 'green'

export interface AccountDefaults {
  visibility?: Visibility
  aiLabel?: boolean
  maxScheduleDays?: number
  bulkEvery?: string
  bulkJitter?: string
  bulkWindow?: string
}

export interface Account {
  id: string
  label: string
  handle?: string
  createdAt: string
  group?: string
  color?: AccountColor
  lastSignedIn?: boolean
  lastCheckedAt?: string
  sourceFolder?: string
  recursiveFolder?: boolean
  defaults?: AccountDefaults
}

export interface AccountSummary extends Account {
  signedIn: boolean
  locked: boolean
  lockSource?: string
  running: boolean
  pendingCount: number
  scheduledCount: number
  failedCount: number
  doneCount: number
  nextSchedule: string | null
}

export interface AccountPatch {
  label?: string
  handle?: string
  group?: string
  color?: AccountColor | null
  lastSignedIn?: boolean
  lastCheckedAt?: string
  sourceFolder?: string | null
  recursiveFolder?: boolean | null
  defaults?: AccountDefaults
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
  | {
      type: 'job-status'
      accountId?: string
      jobId: string
      status: JobStatus
      error?: string
      screenshot?: string
    }
  | { type: 'job-stage'; accountId?: string; jobId: string; stage: string }
  | { type: 'log'; accountId?: string; jobId?: string; message: string }
  | { type: 'auth-required'; accountId?: string; message: string }
  | { type: 'queue-done'; accountId?: string; done: number; failed: number; skipped: number }

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
  /** Include videos inside nested subfolders when adding folders */
  recursiveFolder?: boolean
  /** How many account queues may run at the same time */
  maxConcurrentAccounts?: number
}

export interface AuthStatus {
  signedIn: boolean
  message: string
  /** The profile is in use by another run, so the session could not be checked */
  locked?: boolean
  /** True when a failed cookie import restored the previous browser session */
  restored?: boolean
}

export type RemoteVideoStatus = 'published' | 'scheduled' | 'draft' | 'private' | 'processing' | 'unknown'

export interface TikTokVideo {
  id: string
  caption: string
  /** Base64 data URI fetched in Playwright so renderer CSP stays `img-src 'self' data:` */
  thumbnailDataUrl?: string
  url: string
  status: RemoteVideoStatus
  visibility: Visibility | 'unknown'
  createdAt?: string
  scheduledAt?: string
  durationSec?: number
  views?: number
  likes?: number
  comments?: number
  shares?: number
}

export interface AccountLibrary {
  fetchedAt: string
  handle?: string
  items: TikTokVideo[]
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
