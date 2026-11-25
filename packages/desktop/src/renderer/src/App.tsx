import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import type {
  AccountLibrary,
  AccountSummary,
  Job,
  QueueEvent,
  Settings,
  ThemeMode,
  VideoItem
} from '@tiktok-uploader/core'
import type { LogLine, ToastItem } from './utils'
import { VIDEO_EXT, baseName, errText, newJob, stamp, stem } from './utils'
import { AccountChip } from './components/AccountChip'
import { AccountSettingsModal } from './components/AccountSettingsModal'
import { AccountsOverview } from './components/AccountsOverview'
import { BulkModal } from './components/BulkModal'
import { CompletedRow } from './components/CompletedRow'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ConfirmModal } from './components/ConfirmModal'
import { CopyToAccountsModal } from './components/CopyToAccountsModal'
import { ImportCookiesModal } from './components/ImportCookiesModal'
import { JobRow } from './components/JobRow'
import { Modal } from './components/Modal'
import { SettingsModal } from './components/SettingsModal'
import { TikTokLibraryView } from './components/TikTokLibraryView'
import { ToastStack } from './components/ToastStack'
import { ToggleSwitch } from './components/ToggleSwitch'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CookieIcon,
  DownloadIcon,
  EditIcon,
  FolderIcon,
  GridIcon,
  LogInIcon,
  MonitorIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
  RefreshIcon,
  SettingsIcon,
  StopIcon,
  SunIcon,
  TrashIcon,
  UploadCloudIcon
} from './components/Icons'

const THEMES: { value: ThemeMode; label: string; icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon }
]

type WorkspaceTab = 'queue' | 'completed' | 'library'

const isActiveJob = (job: Job): boolean =>
  job.status === 'pending' || job.status === 'running' || job.status === 'failed'

const isRunnableJob = (job: Job): boolean => job.status === 'pending' || job.status === 'failed'

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [accountId, setAccountId] = useState('')
  const [overview, setOverview] = useState(false)
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('queue')
  const [jobs, setJobs] = useState<Job[]>([])
  const [runningAccounts, setRunningAccounts] = useState<Set<string>>(() => new Set())
  const [headed, setHeaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [startOpen, setStartOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editAccount, setEditAccount] = useState<AccountSummary | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [importAccount, setImportAccount] = useState<AccountSummary | null>(null)
  const [copyJob, setCopyJob] = useState<Job | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [authChecking, setAuthChecking] = useState(false)
  const [library, setLibrary] = useState<AccountLibrary | null>(null)
  const [libraryFor, setLibraryFor] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastTimers = useRef<number[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const refreshTimer = useRef<number | undefined>(undefined)
  const accountIdRef = useRef('')
  const accountsRef = useRef<AccountSummary[]>([])
  /** Latest queue, for handlers that run after an await. */
  const jobsRef = useRef<Job[]>([])

  const addLog = useCallback((message: string, level: 'info' | 'error' = 'info') => {
    setLogs((prev) => [...prev.slice(-499), { ts: stamp(), message, level }])
  }, [])

  const pushToast = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, message, tone }])
    const timer = window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
      toastTimers.current = toastTimers.current.filter((t) => t !== timer)
    }, 3500)
    toastTimers.current.push(timer)
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of toastTimers.current) window.clearTimeout(timer)
      window.clearTimeout(refreshTimer.current)
    }
  }, [])

  useEffect(() => {
    accountIdRef.current = accountId
  }, [accountId])

  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

  const labelOf = useCallback((id: string) => accountsRef.current.find((a) => a.id === id)?.label ?? 'this account', [])

  const currentAccount = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId])
  const recursiveFolder = currentAccount?.recursiveFolder ?? settings?.recursiveFolder ?? false
  const maxScheduleDays = currentAccount?.defaults?.maxScheduleDays ?? settings?.maxScheduleDays ?? 10
  const isCurrentRunning = Boolean(accountId && runningAccounts.has(accountId))

  const accountDefaults = useCallback(
    (account?: AccountSummary) => ({
      visibility: account?.defaults?.visibility ?? settings?.visibility ?? 'everyone',
      aiLabel: account?.defaults?.aiLabel ?? settings?.aiLabel ?? true
    }),
    [settings]
  )

  const theme: ThemeMode = settings?.theme ?? 'system'

  // Follow the OS when the theme is 'system'.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  const persist = useCallback(
    (account: string, next: Job[]) => {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void window.api.queue.save(account, next).catch((e: unknown) => addLog(`Save queue failed: ${errText(e)}`, 'error'))
      }, 250)
    },
    [addLog]
  )

  const commit = useCallback(
    (next: Job[]) => {
      jobsRef.current = next
      setJobs(next)
      if (accountIdRef.current) persist(accountIdRef.current, next)
    },
    [persist]
  )

  const replaceJobs = useCallback((next: Job[]) => {
    jobsRef.current = next
    setJobs(next)
  }, [])

  const refreshAccounts = useCallback(async () => {
    try {
      const list = await window.api.accounts.list()
      accountsRef.current = list
      setAccounts(list)
      setRunningAccounts((prev) => {
        const running = list.filter((a) => a.running)
        if (!running.length) return prev
        let changed = false
        const next = new Set(prev)
        for (const account of running) {
          if (!next.has(account.id)) {
            next.add(account.id)
            changed = true
          }
        }
        return changed ? next : prev
      })
      setAccountId((current) => (list.some((a) => a.id === current) ? current : list[0]?.id ?? ''))
      if (!list.length) setOverview(true)
      return list
    } catch (e) {
      addLog(`Could not list accounts: ${errText(e)}`, 'error')
      return []
    }
  }, [addLog])

  /** Sidebar counts for background accounts update often; coalesce the reloads. */
  const refreshSoon = useCallback(() => {
    window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => void refreshAccounts(), 350)
  }, [refreshAccounts])

  // Initial bootstrap: settings + accounts.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [loaded, list] = await Promise.all([window.api.settings.get(), window.api.accounts.list()])
        if (!alive) return
        setSettings(loaded)
        accountsRef.current = list
        setAccounts(list)
        setHeaded(!loaded.headless)
        const preferred = list.find((a) => a.id === loaded.defaultAccount) ?? list[0]
        if (preferred) setAccountId(preferred.id)
        else setOverview(true)
      } catch (e) {
        if (alive) addLog(`Startup failed: ${errText(e)}`, 'error')
      }
    })()
    return () => {
      alive = false
    }
  }, [addLog])

  // Load the persisted queue whenever the account changes (and on mount).
  useEffect(() => {
    if (!accountId) {
      replaceJobs([])
      return
    }
    let alive = true
    replaceJobs([])
    void (async () => {
      try {
        const loaded = await window.api.queue.load(accountId)
        if (alive) replaceJobs(loaded)
      } catch (e) {
        if (alive) addLog(`Could not load the queue for ${labelOf(accountId)}: ${errText(e)}`, 'error')
      }
    })()
    return () => {
      alive = false
    }
  }, [accountId, addLog, labelOf, replaceJobs])

  // Ask the engine for the real session status: the account list is cached and
  // would otherwise show "Expired" after a CLI login or an app restart.
  useEffect(() => {
    if (!accountId || isCurrentRunning) return
    let alive = true
    setAuthChecking(true)
    void window.api.auth
      .status(accountId)
      .then((status) => {
        if (!alive || status.locked) return
        setAccounts((prev) => prev.map((account) => (account.id === accountId ? { ...account, signedIn: status.signedIn } : account)))
        if (!status.signedIn) {
          // Never surface the `tiktok-up login --account <id>` CLI hint in the UI.
          const clean = /tiktok-up login/i.test(status.message)
            ? 'Not signed in — click Sign In or Import Chrome Cookies'
            : status.message
          addLog(`${labelOf(accountId)}: ${clean}`, 'error')
        }
      })
      .catch((error: unknown) => {
        if (alive) addLog(`Session check failed: ${errText(error)}`, 'error')
      })
      .finally(() => {
        if (alive) setAuthChecking(false)
      })
    return () => {
      alive = false
    }
  }, [accountId, isCurrentRunning, addLog, labelOf])

  // Live queue events from main.
  useEffect(() => {
    return window.api.events.onQueue((event: QueueEvent) => {
      const targetId = event.accountId ?? accountIdRef.current
      const prefix = accountsRef.current.length > 1 ? `[${labelOf(targetId)}] ` : ''
      switch (event.type) {
        case 'log':
          addLog(`${prefix}${event.message}`)
          break
        case 'job-stage': {
          const job = jobsRef.current.find((item) => item.id === event.jobId)
          addLog(`${prefix}${job ? `${baseName(job.videoPath)}: ` : ''}${event.stage}`)
          break
        }
        case 'job-status': {
          if (event.status === 'running') {
            setRunningAccounts((prev) => (prev.has(targetId) ? prev : new Set(prev).add(targetId)))
          }
          // Only the visible account mutates the rendered queue; background
          // accounts just refresh their sidebar counts.
          if (targetId === accountIdRef.current) {
            const next = jobsRef.current.map((job): Job =>
              job.id === event.jobId
                ? {
                    ...job,
                    status: event.status,
                    error: event.error ?? job.error,
                    screenshot: event.screenshot ?? job.screenshot
                  }
                : job
            )
            jobsRef.current = next
            setJobs(next)
          }
          refreshSoon()
          break
        }
        case 'auth-required': {
          addLog(`${prefix}${event.message}`, 'error')
          setRunningAccounts((prev) => {
            const next = new Set(prev)
            next.delete(targetId)
            return next
          })
          pushToast(`${labelOf(targetId)}: ${event.message}`, 'error')
          refreshSoon()
          break
        }
        case 'queue-done': {
          addLog(
            `${prefix}queue finished — ${event.done} done, ${event.failed} failed, ${event.skipped} skipped`
          )
          setRunningAccounts((prev) => {
            const next = new Set(prev)
            next.delete(targetId)
            return next
          })
          pushToast(
            `${labelOf(targetId)}: queue finished (${event.done} done, ${event.failed} failed)`,
            event.failed ? 'error' : 'ok'
          )
          refreshSoon()
          break
        }
      }
    })
  }, [addLog, labelOf, pushToast, refreshSoon])

  // Auto-scroll the log drawer.
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs, logOpen])

  const updateJob = useCallback(
    (id: string, patch: Partial<Job>) => {
      commit(
        jobsRef.current.map((job): Job => {
          if (job.id !== id) return job
          const next: Job = { ...job, ...patch }
          // Drafts and private posts cannot be scheduled on TikTok.
          if (next.draft || next.visibility === 'private') next.schedule = null
          return next
        })
      )
    },
    [commit]
  )

  const removeJob = useCallback(
    (id: string) => commit(jobsRef.current.filter((job) => job.id !== id)),
    [commit]
  )

  const addItems = useCallback(
    (items: { path: string; title: string }[]) => {
      const current = jobsRef.current
      const known = new Set(current.map((j) => j.videoPath))
      const added = items
        .filter((item) => item.path && !known.has(item.path))
        .map((item) => {
          known.add(item.path)
          return newJob(item.path, item.title, accountDefaults(currentAccount))
        })
      if (!added.length) {
        addLog('No new videos to add')
        pushToast('No new videos to add', 'info')
        return
      }
      commit([...current, ...added])
      addLog(`Added ${added.length} video(s)`)
      pushToast(`Added ${added.length} video${added.length === 1 ? '' : 's'}`, 'ok')
    },
    [accountDefaults, addLog, commit, currentAccount, pushToast]
  )

  function pathsFromTransfer(transfer: DataTransfer): string[] {
    const paths: string[] = []
    const items = Array.from(transfer.items)
    if (items.length) {
      for (const item of items) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (!file) continue
        try {
          const path = window.api.files.getPathForFile(file)
          if (path) paths.push(path)
        } catch {
          // ignore files the preload cannot map
        }
      }
      return paths
    }
    for (const file of Array.from(transfer.files)) {
      try {
        const path = window.api.files.getPathForFile(file)
        if (path) paths.push(path)
      } catch {
        // ignore
      }
    }
    return paths
  }

  async function expandPaths(paths: string[], recursive: boolean): Promise<{ path: string; title: string }[]> {
    const found: { path: string; title: string }[] = []
    for (const path of paths) {
      try {
        const videos = await window.api.videos.list(path, { recursive })
        if (videos.length) {
          found.push(...videos.map((v) => ({ path: v.path, title: v.title || stem(v.path) })))
          continue
        }
      } catch {
        // not a directory: fall through and treat as a single file
      }
      if (VIDEO_EXT.test(path)) found.push({ path, title: stem(path) })
    }
    return found
  }

  async function addVideos() {
    try {
      const paths = await window.api.videos.pick()
      if (paths.length) addItems(paths.map((p) => ({ path: p, title: stem(p) })))
    } catch (e) {
      addLog(`Add videos failed: ${errText(e)}`, 'error')
    }
  }

  async function addFolder() {
    try {
      const dir = await window.api.videos.pickFolder()
      if (!dir) return
      const items: VideoItem[] = await window.api.videos.list(dir, { recursive: recursiveFolder })
      addItems(items.map((item) => ({ path: item.path, title: item.title || stem(item.path) })))
    } catch (e) {
      addLog(`Add folder failed: ${errText(e)}`, 'error')
    }
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const paths = pathsFromTransfer(e.dataTransfer)
    if (!paths.length) {
      addLog('Dropped items had no readable path', 'error')
      return
    }
    addItems(await expandPaths(paths, recursiveFolder))
  }

  async function dropOnAccount(e: DragEvent<HTMLButtonElement>, target: AccountSummary) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    setDropTarget(null)
    const paths = pathsFromTransfer(e.dataTransfer)
    if (!paths.length) {
      addLog('Dropped items had no readable path', 'error')
      return
    }
    const recursive = target.recursiveFolder ?? settings?.recursiveFolder ?? false
    const found = await expandPaths(paths, recursive)
    if (!found.length) {
      pushToast('No videos found in the dropped items', 'error')
      return
    }
    if (target.id === accountIdRef.current) {
      addItems(found)
      return
    }
    try {
      const jobsToAdd = found.map((item) => newJob(item.path, item.title, accountDefaults(target)))
      const result = await window.api.queue.append({ accountId: target.id, jobs: jobsToAdd })
      const count = result.added
      addLog(`Added ${count} video(s) to ${target.label}`)
      pushToast(
        count
          ? `Added ${count} video${count === 1 ? '' : 's'} to "${target.label}"`
          : `Those videos are already queued on "${target.label}"`,
        count ? 'ok' : 'info'
      )
      void refreshAccounts()
    } catch (error) {
      const message = `Could not queue into "${target.label}": ${errText(error)}`
      addLog(message, 'error')
      pushToast(message, 'error')
    }
  }

  async function scanLinkedFolder() {
    if (!currentAccount?.sourceFolder) return
    try {
      const videos = await window.api.videos.list(currentAccount.sourceFolder, { recursive: recursiveFolder })
      const known = new Set(jobsRef.current.map((job) => job.videoPath))
      const fresh = videos.filter((video) => !known.has(video.path))
      if (!fresh.length) {
        addLog('No new videos in linked folder')
        pushToast('No new videos in linked folder', 'info')
        return
      }
      addItems(fresh.map((video) => ({ path: video.path, title: video.title || stem(video.path) })))
    } catch (e) {
      addLog(`Scan folder failed: ${errText(e)}`, 'error')
    }
  }

  async function toggleRecursiveFolder() {
    if (!currentAccount) return
    const next = !recursiveFolder
    try {
      if (currentAccount.recursiveFolder !== undefined) {
        const updated = await window.api.accounts.update({ id: currentAccount.id, patch: { recursiveFolder: next } })
        const list = accountsRef.current.map((a) => (a.id === updated.id ? updated : a))
        accountsRef.current = list
        setAccounts(list)
      } else {
        setSettings(await window.api.settings.set({ recursiveFolder: next }))
      }
    } catch (e) {
      addLog(`Could not save the subfolder setting: ${errText(e)}`, 'error')
    }
  }

  function applyBulk(timestamps: string[]) {
    let index = 0
    commit(
      jobsRef.current.map((job): Job => {
        if (!isRunnableJob(job)) return job
        if (job.draft || job.visibility === 'private') return { ...job, schedule: null }
        const iso = timestamps[index++]
        return iso ? { ...job, schedule: iso } : job
      })
    )
    setBulkOpen(false)
    addLog(`Applied ${timestamps.length} schedule slot(s) to pending jobs`)
    pushToast(`Scheduled ${timestamps.length} video${timestamps.length === 1 ? '' : 's'}`, 'ok')
  }

  function retryFailed() {
    const failed = jobsRef.current.filter((j) => j.status === 'failed').length
    if (!failed) {
      addLog('No failed jobs to retry')
      return
    }
    commit(jobsRef.current.map((job): Job => (job.status === 'failed' ? { ...job, status: 'pending', error: undefined, screenshot: undefined } : job)))
    setStartError(null)
    setStartOpen(true)
  }

  function clearFinished() {
    const current = jobsRef.current
    const next = current.filter((j) => j.status !== 'done' && j.status !== 'skipped')
    const removed = current.length - next.length
    if (!removed) {
      addLog('Nothing finished to clear')
      pushToast('Nothing to clear', 'info')
      return
    }
    commit(next)
    addLog(`Removed ${removed} finished row(s)`)
    pushToast(`Cleared ${removed} completed row${removed === 1 ? '' : 's'}`, 'ok')
  }

  function requeue(job: Job) {
    commit(
      jobsRef.current.map((item): Job =>
        item.id === job.id ? { ...item, status: 'pending', error: undefined, screenshot: undefined } : item
      )
    )
    addLog(`Re-queued ${baseName(job.videoPath)}`)
    pushToast(`Moved "${baseName(job.videoPath)}" back to the queue`, 'ok')
    setWorkspaceTab('queue')
  }

  async function signIn() {
    if (!currentAccount) return
    setBusy(true)
    addLog(`Opening a browser window to sign in ${currentAccount.label}…`)
    try {
      const result = await window.api.auth.login(currentAccount.id)
      addLog(result.message, result.ok ? 'info' : 'error')
      pushToast(result.message, result.ok ? 'ok' : 'error')
      await refreshAccounts()
    } catch (e) {
      const message = `Sign in failed: ${errText(e)}`
      addLog(message, 'error')
      pushToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function exportCookies() {
    if (!currentAccount) return
    try {
      const result = await window.api.auth.exportCookies(currentAccount.id)
      if (result.path) pushToast(`Exported cookies to ${result.path}`, 'ok')
      else pushToast('Cookie export cancelled or failed', 'error')
    } catch (e) {
      pushToast(`Export failed: ${errText(e)}`, 'error')
    }
  }

  async function startQueue() {
    if (!currentAccount) return
    setBusy(true)
    setStartError(null)
    try {
      // Pass the full queue: runQueue skips finished rows, and the IPC call persists what it receives.
      const result = await window.api.queue.start({ accountId: currentAccount.id, jobs, headed })
      if (result.started) {
        setRunningAccounts((prev) => new Set(prev).add(currentAccount.id))
        setStartOpen(false)
        addLog(`Started ${runnableJobs.length} job(s) for ${currentAccount.label}${headed ? ' with a visible browser' : ''}`)
        pushToast(`Queue started (${runnableJobs.length} job${runnableJobs.length === 1 ? '' : 's'})`, 'ok')
      } else {
        const message = result.error ?? 'Could not start the queue'
        setStartError(message)
        addLog(message, 'error')
        pushToast(message, 'error')
      }
    } catch (e) {
      const message = errText(e)
      setStartError(message)
      addLog(message, 'error')
      pushToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function stopQueue() {
    if (!currentAccount) return
    const id = currentAccount.id
    setBusy(true)
    try {
      const result = await window.api.queue.stop(id)
      const message = result.stopped ? 'Stop requested — the in-flight job will finish' : 'Nothing to stop'
      if (result.stopped) {
        setRunningAccounts((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }
      addLog(message)
      pushToast(message, result.stopped ? 'ok' : 'info')
    } catch (e) {
      const message = `Stop failed: ${errText(e)}`
      addLog(message, 'error')
      pushToast(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function runAccount(id: string) {
    const label = labelOf(id)
    setBusy(true)
    try {
      const list = await window.api.queue.load(id)
      const runnable = list.filter(isRunnableJob)
      if (!runnable.length) {
        pushToast(`No runnable videos for "${label}"`, 'info')
        return
      }
      const result = await window.api.queue.start({ accountId: id, jobs: list, headed })
      if (result.started) {
        setRunningAccounts((prev) => new Set(prev).add(id))
        addLog(`Started ${runnable.length} job(s) for ${label}`)
        pushToast(`Queue started for "${label}"`, 'ok')
      } else {
        pushToast(result.error ?? 'Could not start the queue', 'error')
      }
    } catch (e) {
      addLog(`Start failed: ${errText(e)}`, 'error')
      pushToast(`Start failed: ${errText(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function stopAccount(id: string) {
    try {
      const result = await window.api.queue.stop(id)
      setRunningAccounts((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      pushToast(result.stopped ? `Stopping "${labelOf(id)}"` : 'Nothing to stop', result.stopped ? 'ok' : 'info')
    } catch (e) {
      pushToast(`Stop failed: ${errText(e)}`, 'error')
    }
  }

  function openImport(account?: AccountSummary) {
    if (!account) return
    setImportAccount(account)
  }

  async function copyToAccounts(accountIds: string[], keepSchedule: boolean) {
    const job = copyJob
    if (!job) return
    try {
      let copied = 0
      for (const id of accountIds) {
        const target = accountsRef.current.find((a) => a.id === id)
        if (!target) continue
        const base = newJob(job.videoPath, job.description, accountDefaults(target))
        const copy: Job = {
          ...base,
          description: job.description,
          visibility: job.visibility,
          draft: job.draft,
          aiLabel: job.aiLabel,
          comment: job.comment,
          duet: job.duet,
          stitch: job.stitch,
          schedule: keepSchedule ? job.schedule : null
        }
        const result = await window.api.queue.append({ accountId: id, jobs: [copy] })
        copied += result.added
      }
      addLog(`Copied ${baseName(job.videoPath)} to ${accountIds.length} account(s)`)
      pushToast(
        copied
          ? `Copied to ${accountIds.length} account${accountIds.length === 1 ? '' : 's'}`
          : 'Already queued on the selected accounts',
        copied ? 'ok' : 'info'
      )
      setCopyJob(null)
      await refreshAccounts()
    } catch (e) {
      const message = `Copy failed: ${errText(e)}`
      addLog(message, 'error')
      pushToast(message, 'error')
    }
  }

  async function syncLibrary() {
    if (!currentAccount || syncing) return
    const id = currentAccount.id
    setSyncing(true)
    try {
      const result = await window.api.library.sync(id)
      if (result.library) {
        setLibrary(result.library)
        setLibraryFor(id)
      }
      addLog(`${labelOf(id)}: ${result.message}`, result.ok ? 'info' : 'error')
      pushToast(result.message, result.ok ? 'ok' : result.locked ? 'info' : 'error')
      if (result.ok) await refreshAccounts()
    } catch (e) {
      const message = `Library sync failed: ${errText(e)}`
      addLog(message, 'error')
      pushToast(message, 'error')
    } finally {
      setSyncing(false)
    }
  }

  async function copyLog() {
    const text = logs.map((line) => `${line.ts}  ${line.message}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      pushToast('Log copied to clipboard', 'ok')
    } catch (e) {
      addLog(`Copy failed: ${errText(e)}`, 'error')
    }
  }

  async function pickTheme(next: ThemeMode) {
    try {
      setSettings(await window.api.settings.set({ theme: next }))
    } catch (e) {
      addLog(`Could not save the theme: ${errText(e)}`, 'error')
    }
  }

  function openAdd() {
    setNewLabel('')
    setAddOpen(true)
  }

  async function addAccount(e: FormEvent) {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label) return
    setFormBusy(true)
    try {
      const account = await window.api.accounts.add({ label })
      await refreshAccounts()
      setAccountId(account.id)
      setOverview(false)
      setAddOpen(false)
      pushToast(`Added "${label}"`, 'ok')
    } catch (error) {
      const message = `Add account failed: ${errText(error)}`
      addLog(message, 'error')
      pushToast(message, 'error')
    } finally {
      setFormBusy(false)
    }
  }

  async function removeAccount() {
    if (!currentAccount) return
    const label = currentAccount.label
    setFormBusy(true)
    try {
      const result = await window.api.accounts.remove(currentAccount.id)
      if (!result.ok) throw new Error(`Could not remove "${label}"`)
      setDeleteOpen(false)
      await refreshAccounts()
      pushToast(`Removed "${label}"`, 'ok')
    } catch (error) {
      const message = `Remove failed: ${errText(error)}`
      addLog(message, 'error')
      pushToast(message, 'error')
    } finally {
      setFormBusy(false)
    }
  }

  const activeJobs = useMemo(() => jobs.filter(isActiveJob), [jobs])
  const runnableJobs = useMemo(() => jobs.filter(isRunnableJob), [jobs])
  const completedJobs = useMemo(() => jobs.filter((job) => job.status === 'done' || job.status === 'skipped'), [jobs])
  const schedulableCount = useMemo(
    () => runnableJobs.filter((job) => !job.draft && job.visibility !== 'private').length,
    [runnableJobs]
  )

  const visibleAccounts = useMemo(() => {
    const query = filter.trim().toLowerCase()
    if (!query) return accounts
    return accounts.filter((account) => {
      const haystack = [account.label, account.handle, account.group].filter(Boolean).join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [accounts, filter])

  const modalOpen = Boolean(
    addOpen ||
      editAccount ||
      deleteOpen ||
      importAccount ||
      bulkOpen ||
      startOpen ||
      settingsOpen ||
      copyJob
  )

  // Lazy-load the cached TikTok library when its tab opens.
  useEffect(() => {
    setLibrary(null)
    setLibraryFor('')
    if (overview || workspaceTab !== 'library' || !accountId) return
    let alive = true
    void window.api.library
      .load(accountId)
      .then((loaded) => {
        if (!alive) return
        setLibrary(loaded ?? null)
        setLibraryFor(accountId)
      })
      .catch((e: unknown) => {
        if (alive) addLog(`Could not load the TikTok library: ${errText(e)}`, 'error')
      })
    return () => {
      alive = false
    }
  }, [accountId, overview, workspaceTab, addLog])

  // Cmd/Ctrl + 0 opens the overview, Cmd/Ctrl + 1..9 the visible accounts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (!/^[0-9]$/.test(e.key)) return
      const el = document.activeElement as HTMLElement | null
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return
      }
      if (modalOpen) return
      e.preventDefault()
      if (e.key === '0') {
        setOverview(true)
        return
      }
      const target = visibleAccounts[Number(e.key) - 1]
      if (!target) return
      setOverview(false)
      setAccountId(target.id)
      setWorkspaceTab('queue')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visibleAccounts, modalOpen])

  const scheduledCount = runnableJobs.filter((j) => j.schedule).length
  const errorCount = logs.filter((line) => line.level === 'error').length
  const signedOut = Boolean(currentAccount && !currentAccount.signedIn)
  const libraryCount = libraryFor === accountId && library ? library.items.length : null
  const progressTotal = activeJobs.length + completedJobs.length
  const progressPct = progressTotal ? Math.max(4, Math.round((completedJobs.length / progressTotal) * 100)) : 0

  if (!settings) {
    return (
      <div className="shell">
        <div
          className="loading"
          style={{ gridColumn: '1 / -1', display: 'grid', placeItems: 'center', color: 'var(--muted)', fontSize: 13 }}
        >
          Loading…
        </div>
      </div>
    )
  }

  const logDrawer = (
    <section className={`log-drawer ${logOpen ? 'open' : 'closed'}`} aria-label="Activity log">
      <div className="log-header">
        <button
          type="button"
          className="btn ghost sm"
          aria-expanded={logOpen}
          aria-controls="log-body"
          onClick={() => setLogOpen((v) => !v)}
        >
          {logOpen ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          Activity Log
        </button>
        <span className="hint">
          {runningAccounts.size ? 'Running' : 'Idle'} · {logs.length} events
        </span>
        {errorCount ? (
          <span className="badge error">
            {errorCount} error{errorCount === 1 ? '' : 's'}
          </span>
        ) : null}
        <span className="spacer" />
        <button type="button" className="btn sm" onClick={() => setLogs([])} disabled={!logs.length}>
          Clear
        </button>
        <button type="button" className="btn sm" onClick={() => void copyLog()} disabled={!logs.length}>
          Copy
        </button>
      </div>
      {logOpen ? (
        <div className="log-body" id="log-body" ref={logRef} role="log" aria-live="polite">
          {logs.length === 0 ? (
            <div className="log-line">Waiting for events…</div>
          ) : (
            logs.map((line, i) => (
              <div key={`${line.ts}-${i}`} className={line.level === 'error' ? 'log-line error' : 'log-line'}>
                <span className="log-time">{line.ts}</span>
                <span>{line.message}</span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </section>
  )

  return (
    <div
      className="shell"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragOver(false)
          setDropTarget(null)
        }
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      <aside className="sidebar">
        <div className="brand">
          <svg
            className="brand-icon"
            viewBox="0 0 1024 1024"
            width="20"
            height="20"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id="brand-tile-bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#1c1b26" />
                <stop offset="100%" stopColor="#0d0c11" />
              </linearGradient>
              <g id="brand-emblem" fill="none" strokeWidth="76" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 340 456 L 512 276 L 684 456" />
                <path d="M 512 288 L 512 604" />
                <path d="M 288 612 L 288 684 Q 288 740 344 740 L 680 740 Q 736 740 736 684 L 736 612" />
              </g>
            </defs>
            <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#brand-tile-bg)" />
            <use href="#brand-emblem" transform="translate(-16, -12)" stroke="#25f4ee" />
            <use href="#brand-emblem" transform="translate(16, 12)" stroke="#fe2c55" />
            <use href="#brand-emblem" stroke="#ffffff" />
            <rect
              x="66"
              y="66"
              width="892"
              height="892"
              rx="198"
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.1"
              strokeWidth="4"
            />
          </svg>
          TikTok Uploader
        </div>

        <button
          type="button"
          className={overview ? 'account-item all-accounts active' : 'account-item all-accounts'}
          onClick={() => setOverview(true)}
        >
          <GridIcon size={14} />
          <span className="account-name">All Accounts</span>
          <span className="account-count">{accounts.length}</span>
        </button>

        <div className="section-title">
          ACCOUNTS
          <button type="button" className="icon-btn" aria-label="Add account" title="Add account" onClick={openAdd}>
            <PlusIcon size={13} />
          </button>
        </div>

        {accounts.length >= 5 ? (
          <div className="sidebar-search">
            <input
              type="search"
              value={filter}
              placeholder="Filter accounts…"
              aria-label="Filter accounts"
              onChange={(e) => setFilter(e.target.value)}
            />
          </div>
        ) : null}

        <div className="account-list">
          {visibleAccounts.map((account) => {
            const dotClass =
              account.running || runningAccounts.has(account.id)
                ? 'status-dot running'
                : account.locked
                  ? 'status-dot locked'
                  : account.signedIn
                    ? 'status-dot ok'
                    : 'status-dot off'
            const active = account.id === accountId && !overview
            return (
              <button
                key={account.id}
                type="button"
                className={`account-item${active ? ' active' : ''}${dropTarget === account.id ? ' drop-target' : ''}`}
                title={account.label}
                onClick={() => {
                  setOverview(false)
                  setAccountId(account.id)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDragOver(false)
                  setDropTarget(account.id)
                }}
                onDragLeave={(e) => {
                  e.stopPropagation()
                  setDropTarget((current) => (current === account.id ? null : current))
                }}
                onDrop={(e) => void dropOnAccount(e, account)}
              >
                <span className={dotClass} />
                {account.color ? <span className={`account-color color-${account.color}`} /> : null}
                <span className="account-name">{account.label}</span>
                <span className="account-badges">
                  {account.failedCount > 0 ? <span className="account-badge bad">{`!${account.failedCount}`}</span> : null}
                  {account.pendingCount > 0 ? <span className="account-badge">{account.pendingCount}</span> : null}
                </span>
              </button>
            )
          })}
        </div>

        <div className="account-actions">
          <div className="account-actions-primary">
            <button
              type="button"
              className="btn"
              onClick={() => void signIn()}
              disabled={!currentAccount || busy || currentAccount.locked}
            >
              <LogInIcon />
              Sign In
            </button>
            <button
              type="button"
              className="btn"
              title="Import Chrome Cookies"
              onClick={() => openImport(currentAccount)}
              disabled={!currentAccount || currentAccount.locked}
            >
              <CookieIcon />
              Cookies
            </button>
          </div>
          <div className="account-actions-secondary">
            <button
              type="button"
              className="btn ghost sm"
              onClick={() => void exportCookies()}
              disabled={!currentAccount || currentAccount.locked}
            >
              <DownloadIcon />
              Export
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setEditAccount(currentAccount ?? null)} disabled={!currentAccount}>
              <EditIcon />
              Edit
            </button>
            <button
              type="button"
              className="btn danger sm"
              onClick={() => setDeleteOpen(true)}
              disabled={!currentAccount || currentAccount.locked}
            >
              <TrashIcon />
              Delete
            </button>
          </div>
        </div>

        <div className="sidebar-footer">
          <div className="segmented" role="group" aria-label="Theme">
            {THEMES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                className={theme === value ? 'seg-btn active' : 'seg-btn'}
                aria-pressed={theme === value}
                onClick={() => void pickTheme(value)}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon />
            Settings
          </button>
        </div>
      </aside>

      <main className="workspace">
        {!accounts.length ? (
          <div className="empty-card">
            <h2>Create your first account</h2>
            <p>Each account gets its own browser profile, cookies and upload queue. Add one to start scheduling.</p>
            <button type="button" className="btn primary" onClick={openAdd}>
              <PlusIcon />
              Add Account
            </button>
          </div>
        ) : overview ? (
          <AccountsOverview
            accounts={accounts}
            runningAccounts={runningAccounts}
            headed={headed}
            onOpen={(id) => {
              setOverview(false)
              setAccountId(id)
            }}
            onEdit={(account) => setEditAccount(account)}
            onCookies={(account) => openImport(account)}
            onRun={(id) => void runAccount(id)}
            onStop={(id) => void stopAccount(id)}
            onChanged={() => void refreshAccounts()}
          />
        ) : (
          <>
            <header className="workspace-header">
              <h2>{currentAccount?.label ?? 'No account'}</h2>
              <AccountChip account={currentAccount} checking={authChecking} />
              {signedOut ? (
                <button type="button" className="btn ghost sm" onClick={() => openImport(currentAccount)}>
                  Import Chrome Cookies
                </button>
              ) : null}
              <span className="spacer" />
              <label className="header-toggle">
                Show browser
                <ToggleSwitch checked={headed} onChange={setHeaded} label="Show browser" />
              </label>
              {isCurrentRunning ? (
                <button type="button" className="btn danger" onClick={() => void stopQueue()} disabled={busy}>
                  <StopIcon />
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => {
                    setStartError(null)
                    setStartOpen(true)
                  }}
                  disabled={!currentAccount || !runnableJobs.length || busy}
                >
                  <PlayIcon />
                  {runnableJobs.length ? `Run (${runnableJobs.length})` : 'Run'}
                </button>
              )}
            </header>

            {isCurrentRunning ? (
              <div className="run-progress">
                <div
                  className="run-progress-fill"
                  style={completedJobs.length > 0 ? { width: `${progressPct}%`, animation: 'none' } : undefined}
                />
              </div>
            ) : null}

            <nav className="workspace-tabs" role="tablist" aria-label="Workspace views">
              <button
                type="button"
                role="tab"
                aria-selected={workspaceTab === 'queue'}
                className={`workspace-tab${workspaceTab === 'queue' ? ' active' : ''}`}
                onClick={() => setWorkspaceTab('queue')}
              >
                Queue
                <span className="tab-count">{activeJobs.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={workspaceTab === 'completed'}
                className={`workspace-tab${workspaceTab === 'completed' ? ' active' : ''}`}
                onClick={() => setWorkspaceTab('completed')}
              >
                Completed
                <span className="tab-count">{completedJobs.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={workspaceTab === 'library'}
                className={`workspace-tab${workspaceTab === 'library' ? ' active' : ''}`}
                onClick={() => setWorkspaceTab('library')}
              >
                TikTok Library
                {libraryCount !== null ? <span className="tab-count">{libraryCount}</span> : null}
              </button>
            </nav>

            {workspaceTab === 'queue' ? (
              <>
                <div className="sub-toolbar">
                  <button type="button" className="btn" onClick={() => void addVideos()} disabled={!currentAccount}>
                    <PlusIcon />
                    Add Videos
                  </button>
                  <button type="button" className="btn" onClick={() => void addFolder()} disabled={!currentAccount}>
                    <FolderIcon />
                    Add Folder
                  </button>
                  <button
                    type="button"
                    className="option-pill"
                    aria-pressed={recursiveFolder}
                    title="Include videos inside nested subfolders when adding or dropping folders"
                    onClick={() => void toggleRecursiveFolder()}
                  >
                    {recursiveFolder ? <CheckIcon size={12} /> : null}
                    Subfolders
                  </button>
                  {currentAccount?.sourceFolder ? (
                    <button
                      type="button"
                      className="btn"
                      title={currentAccount.sourceFolder}
                      onClick={() => void scanLinkedFolder()}
                    >
                      <RefreshIcon />
                      Scan Folder
                    </button>
                  ) : null}
                  <button type="button" className="btn" onClick={() => setBulkOpen(true)} disabled={!schedulableCount}>
                    Bulk Schedule
                  </button>
                  {runnableJobs.some((job) => job.status === 'failed') ? (
                    <button type="button" className="btn" onClick={retryFailed}>
                      Retry Failed
                    </button>
                  ) : null}
                  <span className="spacer" />
                  <span className="stats">
                    <span>
                      <b>{activeJobs.length}</b> active
                    </span>
                    <span>
                      <b>{scheduledCount}</b> scheduled
                    </span>
                    <span>
                      <b>{completedJobs.length}</b> done
                    </span>
                  </span>
                </div>

                {activeJobs.length === 0 ? (
                  <div className="empty-card">
                    <UploadCloudIcon size={28} />
                    <h2>{completedJobs.length ? 'All caught up' : 'No videos queued'}</h2>
                    <p>
                      {completedJobs.length
                        ? `${completedJobs.length} completed video${completedJobs.length === 1 ? '' : 's'} in the Completed tab.`
                        : 'Drop videos or a folder anywhere in this window, or add them here.'}
                    </p>
                    <div className="empty-actions">
                      <button type="button" className="btn primary" onClick={() => void addVideos()}>
                        <PlusIcon />
                        Add Videos
                      </button>
                      <button type="button" className="btn" onClick={() => void addFolder()}>
                        <FolderIcon />
                        Add Folder
                      </button>
                      {completedJobs.length ? (
                        <button type="button" className="btn" onClick={() => setWorkspaceTab('completed')}>
                          View Completed
                        </button>
                      ) : null}
                    </div>
                    {signedOut ? (
                      <div className="hint">
                        Need to connect this account?{' '}
                        <button type="button" className="text-link" onClick={() => void signIn()}>
                          Sign In
                        </button>{' '}
                        or{' '}
                        <button type="button" className="text-link" onClick={() => openImport(currentAccount)}>
                          Import Chrome Cookies
                        </button>
                        .
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="queue-surface">
                    <div className="queue-scroll">
                      <table className="queue-table">
                        <thead>
                          <tr className="queue-header">
                            <th scope="col">Video</th>
                            <th scope="col">Caption</th>
                            <th scope="col">Schedule</th>
                            <th scope="col">Settings</th>
                            <th scope="col">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeJobs.map((item) => (
                            <JobRow
                              key={item.id}
                              job={item}
                              maxScheduleDays={maxScheduleDays}
                              onChange={(patch) => updateJob(item.id, patch)}
                              onRemove={() => removeJob(item.id)}
                              onCopyToAccounts={accounts.length > 1 ? () => setCopyJob(item) : undefined}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : workspaceTab === 'completed' ? (
              <>
                <div className="sub-toolbar">
                  <span className="stats">
                    <span>
                      <b>{completedJobs.length}</b> completed
                    </span>
                  </span>
                  <span className="spacer" />
                  <button type="button" className="btn" onClick={clearFinished} disabled={!completedJobs.length}>
                    <TrashIcon />
                    Clear All Completed
                  </button>
                </div>

                {completedJobs.length === 0 ? (
                  <div className="empty-card">
                    <h2>No completed uploads yet</h2>
                    <p>Videos appear here once they finish uploading or are skipped.</p>
                    <div className="empty-actions">
                      <button type="button" className="btn" onClick={() => setWorkspaceTab('queue')}>
                        View Queue
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="queue-surface">
                    <div className="queue-scroll">
                      <table className="queue-table">
                        <thead>
                          <tr className="queue-header">
                            <th scope="col">Video</th>
                            <th scope="col">Caption</th>
                            <th scope="col">Schedule</th>
                            <th scope="col">Settings</th>
                            <th scope="col">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {completedJobs.map((item) => (
                            <CompletedRow
                              key={item.id}
                              job={item}
                              onRequeue={() => requeue(item)}
                              onRemove={() => removeJob(item.id)}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : currentAccount ? (
              <TikTokLibraryView
                key={currentAccount.id}
                account={currentAccount}
                library={libraryFor === accountId ? library : null}
                syncing={syncing}
                onSync={() => void syncLibrary()}
                onSignIn={() => void signIn()}
                onImportCookies={() => openImport(currentAccount)}
              />
            ) : (
              <div className="empty-card">
                <h2>No account selected</h2>
                <p>Pick an account in the sidebar to see its TikTok library.</p>
              </div>
            )}

            {logDrawer}
          </>
        )}

        {!accounts.length || overview ? logDrawer : null}
      </main>

      {dragOver ? (
        <div className="drop-overlay">
          <div className="drop-card">Drop videos or a folder</div>
        </div>
      ) : null}

      {addOpen ? (
        <Modal
          title="Add account"
          subtitle="Creates a new browser profile with its own cookies and queue."
          size="sm"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={() => setAddOpen(false)} disabled={formBusy}>
                Cancel
              </button>
              <button type="submit" form="add-account" className="btn primary" disabled={!newLabel.trim() || formBusy}>
                {formBusy ? 'Adding…' : 'Add account'}
              </button>
            </>
          }
        >
          <form id="add-account" className="field" onSubmit={(e) => void addAccount(e)}>
            <label className="field-label" htmlFor="account-name">
              Account name
            </label>
            <input
              id="account-name"
              type="text"
              value={newLabel}
              placeholder="e.g. Brand Main"
              autoFocus
              onChange={(e) => setNewLabel(e.target.value)}
            />
          </form>
        </Modal>
      ) : null}

      {editAccount ? (
        <AccountSettingsModal
          account={editAccount}
          onClose={() => setEditAccount(null)}
          onSaved={(next) => {
            setEditAccount(null)
            const list = accountsRef.current.map((a) => (a.id === next.id ? next : a))
            accountsRef.current = list
            setAccounts(list)
            void refreshAccounts()
            addLog(`Saved settings for ${next.label}`)
            pushToast(`Saved "${next.label}"`, 'ok')
          }}
        />
      ) : null}

      {deleteOpen && currentAccount ? (
        <ConfirmDialog
          title={`Remove "${currentAccount.label}"?`}
          description="Its browser profile, cookies and upload queue are deleted from this computer. This cannot be undone."
          confirmLabel="Delete"
          danger
          busy={formBusy}
          onConfirm={() => void removeAccount()}
          onCancel={() => setDeleteOpen(false)}
        />
      ) : null}

      {importAccount ? (
        <ImportCookiesModal
          account={importAccount}
          onClose={() => setImportAccount(null)}
          onImported={(result) => {
            pushToast(result.message, result.signedIn ? 'ok' : 'info')
            void refreshAccounts()
          }}
        />
      ) : null}

      {bulkOpen ? (
        <BulkModal
          count={schedulableCount}
          defaultEvery={currentAccount?.defaults?.bulkEvery}
          defaultJitter={currentAccount?.defaults?.bulkJitter}
          defaultWindow={currentAccount?.defaults?.bulkWindow}
          onClose={() => setBulkOpen(false)}
          onApply={applyBulk}
        />
      ) : null}

      {startOpen ? (
        <ConfirmModal
          account={currentAccount}
          jobs={runnableJobs}
          headed={headed}
          busy={busy}
          maxScheduleDays={maxScheduleDays}
          error={startError}
          onClose={() => {
            setStartOpen(false)
            setStartError(null)
          }}
          onStart={() => void startQueue()}
        />
      ) : null}

      {copyJob ? (
        <CopyToAccountsModal
          job={copyJob}
          accounts={accounts}
          currentAccountId={accountId}
          onClose={() => setCopyJob(null)}
          onCopy={(accountIds, keepSchedule) => void copyToAccounts(accountIds, keepSchedule)}
        />
      ) : null}

      {settingsOpen ? (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setSettings(next)
            setSettingsOpen(false)
            setHeaded(!next.headless)
            addLog('Settings saved')
            pushToast('Settings saved', 'ok')
          }}
        />
      ) : null}

      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((prev) => prev.filter((toast) => toast.id !== id))} />
    </div>
  )
}
