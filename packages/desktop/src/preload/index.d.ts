import type {
  AccountSummary,
  AuthStatus,
  Job,
  QueueEvent,
  Settings,
  StaggerRule,
  VideoItem
} from '@tiktok-uploader/core'

export interface ImportCookiesResult {
  ok: boolean
  signedIn?: boolean
  canceled?: boolean
  count?: number
  message: string
}

export interface TiktokApi {
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  accounts: {
    list(): Promise<AccountSummary[]>
    add(input: { id?: string; label: string }): Promise<AccountSummary>
    label(input: { id: string; label: string }): Promise<AccountSummary>
    remove(accountId: string): Promise<{ ok: boolean }>
  }
  auth: {
    status(accountId: string): Promise<AuthStatus>
    login(accountId: string): Promise<{ ok: boolean; message: string }>
    importCookies(accountId: string): Promise<ImportCookiesResult>
    importCookiesText(input: { accountId: string; text: string }): Promise<ImportCookiesResult>
    exportCookies(accountId: string): Promise<{ ok: boolean; path?: string }>
  }
  videos: {
    pick(): Promise<string[]>
    pickFolder(): Promise<string | null>
    list(directory: string): Promise<VideoItem[]>
  }
  schedule: {
    stagger(count: number, rule: StaggerRule): Promise<string[]>
  }
  queue: {
    load(accountId: string): Promise<Job[]>
    save(accountId: string, jobs: Job[]): Promise<{ ok: boolean }>
    start(input: { accountId: string; jobs: Job[]; headed?: boolean }): Promise<{ started: boolean; error?: string }>
    stop(accountId: string): Promise<{ stopped: boolean }>
  }
  events: {
    onQueue(callback: (event: QueueEvent) => void): () => void
  }
  files: {
    /** Electron's webUtils.getPathForFile, for drag and drop */
    getPathForFile(file: File): string
  }
  reveal(path: string): Promise<void>
}

declare global {
  interface Window {
    api: TiktokApi
  }
}

export {}
