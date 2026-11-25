import type {
  AccountLibrary,
  AccountPatch,
  AccountSummary,
  AuthStatus,
  Job,
  QueueEvent,
  Settings,
  StaggerRule,
  SyncLibraryResult,
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
    update(input: { id: string; patch: AccountPatch }): Promise<AccountSummary>
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
    list(directory: string, options?: { recursive?: boolean }): Promise<VideoItem[]>
  }
  schedule: {
    stagger(count: number, rule: StaggerRule, accountId?: string): Promise<string[]>
  }
  queue: {
    load(accountId: string): Promise<Job[]>
    save(accountId: string, jobs: Job[]): Promise<{ ok: boolean }>
    append(input: { accountId: string; jobs: Job[] }): Promise<{ added: number; total: number }>
    start(input: { accountId: string; jobs: Job[]; headed?: boolean }): Promise<{ started: boolean; error?: string }>
    startAll(input: { accountIds: string[]; headed?: boolean }): Promise<{ started: string[]; queued: string[]; skipped: string[] }>
    stop(accountId: string): Promise<{ stopped: boolean }>
  }
  library: {
    load(accountId: string): Promise<AccountLibrary | null>
    sync(accountId: string, maxItems?: number): Promise<SyncLibraryResult>
  }
  events: {
    onQueue(callback: (event: QueueEvent) => void): () => void
  }
  files: {
    /** Electron's webUtils.getPathForFile, for drag and drop */
    getPathForFile(file: File): string
  }
  reveal(path: string): Promise<void>
  openExternal(url: string): Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    api: TiktokApi
  }
}

export {}
