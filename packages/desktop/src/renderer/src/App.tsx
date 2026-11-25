import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent } from 'react'
import type { AccountSummary, Job, QueueEvent, Settings, ThemeMode, VideoItem } from '@tiktok-uploader/core'
import type { LogLine, ToastItem } from './utils'
import { VIDEO_EXT, baseName, errText, newJob, stamp, stem } from './utils'
import { AccountChip } from './components/AccountChip'
import { ToggleSwitch } from './components/ToggleSwitch'
import { Modal } from './components/Modal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { JobRow } from './components/JobRow'
import { ImportCookiesModal } from './components/ImportCookiesModal'
import { BulkModal } from './components/BulkModal'
import { ConfirmModal } from './components/ConfirmModal'
import { SettingsModal } from './components/SettingsModal'
import { ToastStack } from './components/ToastStack'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CookieIcon,
  DownloadIcon,
  EditIcon,
  FolderIcon,
  LogInIcon,
  MonitorIcon,
  MoonIcon,
  PlayIcon,
  PlusIcon,
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

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [accountId, setAccountId] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [running, setRunning] = useState(false)
  const [headed, setHeaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [startOpen, setStartOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [renameLabel, setRenameLabel] = useState('')
  const [formBusy, setFormBusy] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [authChecking, setAuthChecking] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastTimers = useRef<number[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)
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
  const defaults = useMemo(
    () => ({ visibility: settings?.visibility ?? 'everyone', aiLabel: settings?.aiLabel ?? true }),
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
      setAccounts(list)
      setAccountId((current) => (list.some((a) => a.id === current) ? current : list[0]?.id ?? ''))
      return list
    } catch (e) {
      addLog(`Could not list accounts: ${errText(e)}`, 'error')
      return []
    }
  }, [addLog])

  // Initial bootstrap: settings + accounts.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [loaded, list] = await Promise.all([window.api.settings.get(), window.api.accounts.list()])
        if (!alive) return
        setSettings(loaded)
        setAccounts(list)
        setHeaded(!loaded.headless)
        const preferred = list.find((a) => a.id === loaded.defaultAccount) ?? list[0]
        if (preferred) setAccountId(preferred.id)
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
    if (!accountId || running) return
    let alive = true
    setAuthChecking(true)
    void window.api.auth
      .status(accountId)
      .then((status) => {
        if (!alive || status.locked) return
        setAccounts((prev) => prev.map((account) => (account.id === accountId ? { ...account, signedIn: status.signedIn } : account)))
        if (!status.signedIn) addLog(`${labelOf(accountId)}: ${status.message}`, 'error')
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
  }, [accountId, running, addLog, labelOf])

  // Live queue events from main.
  useEffect(() => {
    return window.api.events.onQueue((event: QueueEvent) => {
      switch (event.type) {
        case 'log':
          addLog(event.message)
          break
        case 'job-stage': {
          const job = jobsRef.current.find((item) => item.id === event.jobId)
          addLog(job ? `${baseName(job.videoPath)}: ${event.stage}` : event.stage)
          break
        }
        case 'job-status': {
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
          break
        }
        case 'auth-required':
          addLog(event.message, 'error')
          setRunning(false)
          break
        case 'queue-done':
          addLog(
            `${labelOf(accountIdRef.current)}: queue finished — ${event.done} done, ${event.failed} failed, ${event.skipped} skipped`
          )
          setRunning(false)
          break
      }
    })
  }, [addLog, labelOf])

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
          return newJob(item.path, item.title, defaults)
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
    [addLog, commit, defaults, pushToast]
  )

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
      const items: VideoItem[] = await window.api.videos.list(dir)
      addItems(items.map((item) => ({ path: item.path, title: item.title || stem(item.path) })))
    } catch (e) {
      addLog(`Add folder failed: ${errText(e)}`, 'error')
    }
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const transfer = e.dataTransfer
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
    } else {
      for (const file of Array.from(transfer.files)) {
        try {
          const path = window.api.files.getPathForFile(file)
          if (path) paths.push(path)
        } catch {
          // ignore
        }
      }
    }
    if (!paths.length) {
      addLog('Dropped items had no readable path', 'error')
      return
    }

    const found: { path: string; title: string }[] = []
    for (const path of paths) {
      try {
        const videos = await window.api.videos.list(path)
        if (videos.length) {
          found.push(...videos.map((v) => ({ path: v.path, title: v.title || stem(v.path) })))
          continue
        }
      } catch {
        // not a directory: fall through and treat as a single file
      }
      if (VIDEO_EXT.test(path)) found.push({ path, title: stem(path) })
    }
    addItems(found)
  }

  function applyBulk(timestamps: string[]) {
    let index = 0
    commit(
      jobsRef.current.map((job): Job => {
        if (job.draft || job.visibility === 'private') return { ...job, schedule: null }
        const iso = timestamps[index++]
        return iso ? { ...job, schedule: iso } : job
      })
    )
    setBulkOpen(false)
    addLog(`Applied ${timestamps.length} schedule slot(s)`)
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
    if (next.length === current.length) {
      addLog('Nothing finished to clear')
      return
    }
    commit(next)
    addLog(`Removed ${current.length - next.length} finished row(s)`)
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
      const result = await window.api.queue.start({ accountId: currentAccount.id, jobs, headed })
      if (result.started) {
        setRunning(true)
        setStartOpen(false)
        addLog(`Started ${jobs.length} job(s) for ${currentAccount.label}${headed ? ' with a visible browser' : ''}`)
        pushToast(`Queue started (${jobs.length} job${jobs.length === 1 ? '' : 's'})`, 'ok')
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
    setBusy(true)
    try {
      const result = await window.api.queue.stop(currentAccount.id)
      const message = result.stopped ? 'Stop requested — the in-flight job will finish' : 'Nothing to stop'
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

  function openRename() {
    if (!currentAccount) return
    setRenameLabel(currentAccount.label)
    setRenameOpen(true)
  }

  async function renameAccount(e: FormEvent) {
    e.preventDefault()
    if (!currentAccount) return
    const label = renameLabel.trim()
    if (!label) return
    setFormBusy(true)
    try {
      await window.api.accounts.label({ id: currentAccount.id, label })
      await refreshAccounts()
      setRenameOpen(false)
      pushToast(`Renamed to "${label}"`, 'ok')
    } catch (error) {
      const message = `Rename failed: ${errText(error)}`
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

  const scheduledCount = jobs.filter((j) => j.schedule).length
  const doneCount = jobs.filter((j) => j.status === 'done').length
  const failedCount = jobs.filter((j) => j.status === 'failed').length
  const finishedCount = jobs.filter((j) => j.status === 'done' || j.status === 'skipped').length
  const schedulableCount = jobs.filter((j) => !j.draft && j.visibility !== 'private').length
  const errorCount = logs.filter((line) => line.level === 'error').length
  const signedOut = Boolean(currentAccount && !currentAccount.signedIn)

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

  return (
    <div
      className="shell"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          TikTok Uploader
        </div>

        <div className="section-title">
          ACCOUNTS
          <button type="button" className="btn ghost sm" aria-label="Add account" title="Add account" onClick={openAdd}>
            <PlusIcon size={13} />
          </button>
        </div>

        <div className="account-list">
          {accounts.map(({ id, label, signedIn, locked }) => (
            <button
              key={id}
              type="button"
              className={id === accountId ? 'account-item active' : 'account-item'}
              title={label}
              onClick={() => setAccountId(id)}
            >
              <span className={locked ? 'status-dot locked' : signedIn ? 'status-dot ok' : 'status-dot off'} />
              {label}
            </button>
          ))}
        </div>

        <div className="account-actions">
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
            onClick={() => setImportOpen(true)}
            disabled={!currentAccount || currentAccount.locked}
          >
            <CookieIcon />
            Chrome Cookies
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void exportCookies()}
            disabled={!currentAccount || currentAccount.locked}
          >
            <DownloadIcon />
            Export
          </button>
          <button type="button" className="btn" onClick={openRename} disabled={!currentAccount}>
            <EditIcon />
            Rename
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => setDeleteOpen(true)}
            disabled={!currentAccount || currentAccount.locked}
          >
            <TrashIcon />
            Delete
          </button>
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
        <header className="workspace-header">
          <h2>{currentAccount?.label ?? 'No account'}</h2>
          <AccountChip account={currentAccount} checking={authChecking} />
          {signedOut ? (
            <button type="button" className="btn ghost sm" onClick={() => setImportOpen(true)}>
              Import Chrome Cookies
            </button>
          ) : null}
          <span className="spacer" />
          <label className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Show browser
            <ToggleSwitch checked={headed} onChange={setHeaded} label="Show browser" />
          </label>
          {running ? (
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
              disabled={!currentAccount || !jobs.length || busy}
            >
              <PlayIcon />
              Run
            </button>
          )}
        </header>

        {running ? (
          <div className="run-progress">
            <div className="run-progress-fill" />
          </div>
        ) : null}

        <div className="sub-toolbar">
          <button type="button" className="btn" onClick={() => void addVideos()} disabled={!currentAccount}>
            <PlusIcon />
            Add Videos
          </button>
          <button type="button" className="btn" onClick={() => void addFolder()} disabled={!currentAccount}>
            <FolderIcon />
            Add Folder
          </button>
          <button type="button" className="btn" onClick={() => setBulkOpen(true)} disabled={!schedulableCount}>
            Bulk Schedule
          </button>
          {failedCount ? (
            <button type="button" className="btn" onClick={retryFailed}>
              Retry Failed
            </button>
          ) : null}
          {finishedCount ? (
            <button type="button" className="btn" onClick={clearFinished}>
              Clear Finished
            </button>
          ) : null}
          <span className="spacer" />
          <span className="stats">
            <span>
              <b>{jobs.length}</b> videos
            </span>
            <span>
              <b>{scheduledCount}</b> scheduled
            </span>
            <span>
              <b>{doneCount}</b> done
            </span>
            <span>
              <b>{failedCount}</b> failed
            </span>
          </span>
        </div>

        {!accounts.length ? (
          <div className="empty-card">
            <h2>Create your first account</h2>
            <p>Each account gets its own browser profile, cookies and upload queue. Add one to start scheduling.</p>
            <button type="button" className="btn primary" onClick={openAdd}>
              <PlusIcon />
              Add Account
            </button>
          </div>
        ) : !jobs.length ? (
          <div className="empty-card">
            <UploadCloudIcon size={28} />
            <h2>No videos queued</h2>
            <p>Drop videos or a folder anywhere in this window, or add them here.</p>
            <button type="button" className="btn" onClick={() => void addVideos()}>
              <PlusIcon />
              Add Videos
            </button>
            <button type="button" className="btn" onClick={() => void addFolder()}>
              <FolderIcon />
              Add Folder
            </button>
            {signedOut ? (
              <div className="hint">Need to connect this account? Sign In or Import Chrome Cookies.</div>
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
                  {jobs.map((item) => (
                    <JobRow
                      key={item.id}
                      job={item}
                      maxScheduleDays={settings.maxScheduleDays ?? 10}
                      onChange={(patch) => updateJob(item.id, patch)}
                      onRemove={() => removeJob(item.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

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
              {running ? 'Running' : 'Idle'} · {logs.length} events
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

      {renameOpen ? (
        <Modal
          title="Rename account"
          size="sm"
          onClose={() => setRenameOpen(false)}
          footer={
            <>
              <span className="spacer" />
              <button type="button" className="btn ghost" onClick={() => setRenameOpen(false)} disabled={formBusy}>
                Cancel
              </button>
              <button type="submit" form="rename-account" className="btn primary" disabled={!renameLabel.trim() || formBusy}>
                {formBusy ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <form id="rename-account" className="field" onSubmit={(e) => void renameAccount(e)}>
            <label className="field-label" htmlFor="rename-name">
              Account name
            </label>
            <input
              id="rename-name"
              type="text"
              value={renameLabel}
              autoFocus
              onChange={(e) => setRenameLabel(e.target.value)}
            />
          </form>
        </Modal>
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

      {importOpen && currentAccount ? (
        <ImportCookiesModal
          account={currentAccount}
          onClose={() => setImportOpen(false)}
          onImported={(result) => {
            pushToast(result.message, result.signedIn ? 'ok' : 'info')
            void refreshAccounts()
          }}
        />
      ) : null}

      {bulkOpen ? <BulkModal count={schedulableCount} onClose={() => setBulkOpen(false)} onApply={applyBulk} /> : null}

      {startOpen ? (
        <ConfirmModal
          account={currentAccount}
          jobs={jobs}
          headed={headed}
          busy={busy}
          maxScheduleDays={settings.maxScheduleDays ?? 10}
          error={startError}
          onClose={() => {
            setStartOpen(false)
            setStartError(null)
          }}
          onStart={() => void startQueue()}
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
