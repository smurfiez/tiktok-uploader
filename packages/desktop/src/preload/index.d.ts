import type {
  AccountSummary,
  AuthStatus,
  Job,
  QueueEvent,
  Settings,
  StaggerRule,
  VideoItem
} from '@tiktok-uploader/core'

export interface SettingsView extends Settings {
  /** never the key itself */
  hasApiKey: boolean
}

export interface TiktokApi {
  settings: {
    get(): Promise<SettingsView>
    set(patch: Partial<Settings> & { captionApiKey?: string }): Promise<SettingsView>
  }
  accounts: {
    list(): Promise<AccountSummary[]>
    add(input: { id: string; label: string }): Promise<AccountSummary>
    label(input: { id: string; label: string }): Promise<AccountSummary>
    remove(accountId: string): Promise<{ ok: boolean }>
  }
  auth: {
    status(accountId: string): Promise<AuthStatus>
    login(accountId: string): Promise<{ ok: boolean; message: string }>
    importCookies(accountId: string): Promise<{ ok: boolean; message: string }>
    exportCookies(accountId: string): Promise<{ ok: boolean; path?: string }>
  }
  videos: {
    pick(): Promise<string[]>
    pickFolder(): Promise<string | null>
    list(directory: string): Promise<VideoItem[]>
  }
  captions: {
    suggest(videoPath: string): Promise<{ caption: string; generated: boolean; error?: string }>
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
