import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent, ReactNode } from 'react'
import type {
  AccountSummary,
  Job,
  JobStatus,
  QueueEvent,
  Settings,
  StaggerRule,
  VideoItem,
  Visibility
} from '@tiktok-uploader/core'

/** Feed preview truncation point. Mirrors core MAX_DESCRIPTION_LENGTH. */
const SOFT_LIMIT = 150
/** Hard TikTok description cap. Mirrors core MAX_DESCRIPTION_HARD. */
const HARD_LIMIT = 2200

const VISIBILITIES: { value: Visibility; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
  { value: 'private', label: 'Private' }
]

const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped'
}

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv|flv|wmv)$/i

interface LogLine {
  ts: string
  message: string
  level: 'info' | 'error'
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isoToLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : localInput(d)
}

function localToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function stamp(): string {
  return new Date().toLocaleTimeString(undefined, { hour12: false })
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function stem(path: string): string {
  return baseName(path).replace(/\.[^.]+$/, '')
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function newJob(path: string, title: string, defaults: { visibility: Visibility; aiLabel: boolean }): Job {
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

function formatWhen(iso: string | null): string {
  if (!iso) return 'post now'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'post now' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function Modal({
  title,
  onClose,
  children,
  footer
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>
  )
}

function AccountChip({ account, checking }: { account?: AccountSummary; checking?: boolean }) {
  if (!account) return <span className="chip">No account</span>
  if (checking) return <span className="chip">Checking…</span>
  if (account.locked) {
    return (
      <span className="chip locked" title={account.lockSource ? `Locked by ${account.lockSource}` : 'Locked by another process'}>
        Locked by CLI
      </span>
    )
  }
  if (account.signedIn) return <span className="chip ok">Signed in</span>
  return <span className="chip bad">Expired</span>
}

function Flag({
  id,
  label,
  checked,
  onChange,
  title
}: {
  id: string
  label: string
  checked: boolean
  onChange: (value: boolean) => void
  title?: string
}) {
  return (
    <label className="flag" htmlFor={id} title={title}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function JobRow({
  job,
  onChange
}: {
  job: Job
  onChange: (patch: Partial<Job>) => void
}) {
  const length = job.description.length
  const counterClass = length > HARD_LIMIT ? 'counter over' : length > SOFT_LIMIT ? 'counter soft' : 'counter'
  const scheduleDisabled = job.draft || job.visibility === 'private'
  const screenshot = job.screenshot

  return (
    <tr>
      <td className="col-file">
        <div className="file-name" title={job.videoPath}>
          {baseName(job.videoPath)}
        </div>
        <div className="file-id">{job.id}</div>
      </td>
      <td className="col-caption">
        <textarea
          rows={3}
          value={job.description}
          aria-label={`Caption for ${baseName(job.videoPath)}`}
          aria-describedby={`${job.id}-counter`}
          placeholder="Write a caption"
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <div className="caption-foot">
          <span className={counterClass} id={`${job.id}-counter`}>
            {length}
            {length > SOFT_LIMIT ? ` / ${HARD_LIMIT}` : ''}
            {length > SOFT_LIMIT && length <= HARD_LIMIT ? ' · over preview limit' : ''}
            {length > HARD_LIMIT ? ` · over hard limit ${HARD_LIMIT}` : ''}
          </span>
        </div>
      </td>
      <td className="col-schedule">
        <input
          type="datetime-local"
          value={isoToLocal(job.schedule)}
          disabled={scheduleDisabled}
          aria-label={`Schedule for ${baseName(job.videoPath)}`}
          title={scheduleDisabled ? 'Scheduling is unavailable for drafts and private posts' : undefined}
          onChange={(e) => onChange({ schedule: localToIso(e.target.value) })}
        />
        <div className="hint">{scheduleDisabled ? 'disabled' : formatWhen(job.schedule)}</div>
      </td>
      <td className="col-vis">
        <select
          value={job.visibility}
          aria-label={`Visibility for ${baseName(job.videoPath)}`}
          onChange={(e) => onChange({ visibility: e.target.value as Visibility })}
        >
          {VISIBILITIES.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </td>
      <td className="col-flags">
        <div className="flags">
          <Flag
            id={`${job.id}-draft`}
            label="Draft"
            checked={job.draft}
            onChange={(v) => onChange({ draft: v })}
            title="Save as draft: scheduling is not allowed"
          />
          <Flag id={`${job.id}-ai`} label="AI label" checked={job.aiLabel} onChange={(v) => onChange({ aiLabel: v })} />
          <Flag id={`${job.id}-comment`} label="Comment" checked={job.comment} onChange={(v) => onChange({ comment: v })} />
          <Flag id={`${job.id}-duet`} label="Duet" checked={job.duet} onChange={(v) => onChange({ duet: v })} />
          <Flag id={`${job.id}-stitch`} label="Stitch" checked={job.stitch} onChange={(v) => onChange({ stitch: v })} />
        </div>
      </td>
      <td className="col-status">
        <span className={`pill ${job.status}`}>{STATUS_LABEL[job.status]}</span>
        {job.error ? (
          <div className="row-error">
            {job.error}
            {screenshot ? (
              <button
                type="button"
                className="link"
                aria-label={`Open failure screenshot ${baseName(screenshot)}`}
                onClick={() => void window.api.reveal(screenshot)}
              >
                {baseName(screenshot)}
              </button>
            ) : null}
          </div>
        ) : null}
      </td>
    </tr>
  )
}

function BulkModal({
  count,
  onClose,
  onApply
}: {
  count: number
  onClose: () => void
  onApply: (timestamps: string[]) => void
}) {
  const [start, setStart] = useState(() => localInput(new Date(Date.now() + 60 * 60 * 1000)))
  const [every, setEvery] = useState('12h')
  const [jitter, setJitter] = useState('')
  const [quiet, setQuiet] = useState('')
  const [preview, setPreview] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!count || !start || !every.trim()) {
      setPreview([])
      return
    }
    let alive = true
    const rule: StaggerRule = {
      start: start.replace('T', ' '),
      every: every.trim(),
      count,
      jitter: jitter.trim() || undefined,
      window: quiet.trim() || undefined
    }
    const timer = window.setTimeout(() => {
      window.api.schedule
        .stagger(count, rule)
        .then((timestamps) => {
          if (!alive) return
          setPreview(timestamps)
          setError(null)
        })
        .catch((e: unknown) => {
          if (!alive) return
          setPreview([])
          setError(errText(e))
        })
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [start, every, jitter, quiet, count])

  return (
    <Modal
      title="Bulk Schedule"
      onClose={onClose}
      footer={
        <>
          <span className="hint">{preview.length ? `${preview.length} slot(s) will be written` : 'No preview yet'}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => onApply(preview)} disabled={!preview.length}>
            Apply
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label htmlFor="bulk-start">Start</label>
        <input id="bulk-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        <label htmlFor="bulk-every">Every</label>
        <input id="bulk-every" type="text" value={every} placeholder="12h" onChange={(e) => setEvery(e.target.value)} />
        <label htmlFor="bulk-jitter">Jitter (optional)</label>
        <input id="bulk-jitter" type="text" value={jitter} placeholder="15m" onChange={(e) => setJitter(e.target.value)} />
        <label htmlFor="bulk-window">Window (optional)</label>
        <input id="bulk-window" type="text" value={quiet} placeholder="09:00-21:00" onChange={(e) => setQuiet(e.target.value)} />
      </div>
      <p className="hint">{count} schedulable row(s). Drafts and private rows are skipped.</p>
      {error ? <div className="row-error">{error}</div> : null}
      <ol className="preview" aria-label="Schedule preview">
        {preview.map((iso, i) => (
          <li key={iso}>
            <span className="preview-index">{i + 1}</span>
            {formatWhen(iso)}
          </li>
        ))}
      </ol>
    </Modal>
  )
}

function ConfirmModal({
  account,
  jobs,
  headed,
  busy,
  error,
  onClose,
  onStart
}: {
  account?: AccountSummary
  jobs: Job[]
  headed: boolean
  busy: boolean
  error: string | null
  onClose: () => void
  onStart: () => void
}) {
  const scheduled = useMemo(() => jobs.map((j) => j.schedule).filter((s): s is string => Boolean(s)).sort(), [jobs])
  const first = scheduled[0]
  const last = scheduled[scheduled.length - 1]
  const emptyCaptions = jobs.filter((j) => !j.description.trim()).length
  const visibility = useMemo(() => {
    const counts: Record<Visibility, number> = { everyone: 0, friends: 0, private: 0 }
    for (const job of jobs) counts[job.visibility] += 1
    return VISIBILITIES.filter((v) => counts[v.value] > 0).map((v) => `${v.label} ${counts[v.value]}`)
  }, [jobs])

  return (
    <Modal
      title="Start upload queue"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={onStart} disabled={busy || !jobs.length}>
            {busy ? 'Starting…' : `Run ${jobs.length} job(s)`}
          </button>
        </>
      }
    >
      <dl className="summary">
        <dt>Account</dt>
        <dd>
          {account ? `${account.label} (${account.id})` : '—'} <AccountChip account={account} />
        </dd>
        <dt>Jobs</dt>
        <dd>{jobs.length}</dd>
        <dt>Schedule span</dt>
        <dd>{scheduled.length ? `${formatWhen(first)} → ${formatWhen(last)}` : 'Post now (no schedule set)'}</dd>
        <dt>Visibility</dt>
        <dd>{visibility.join(' · ') || '—'}</dd>
        <dt>Empty captions</dt>
        <dd className={emptyCaptions ? 'warn' : undefined}>{emptyCaptions}</dd>
        <dt>Mode</dt>
        <dd>{headed ? 'Headed browser (Show browser on)' : 'Headless'}</dd>
      </dl>
      <p className="hint">Scheduled posts cannot be edited on TikTok afterwards. Review the rows before running.</p>
      {error ? <div className="row-error">{error}</div> : null}
    </Modal>
  )
}

function AccountManagerModal({
  accounts,
  currentId,
  onClose,
  onUse,
  onRefresh,
  addLog
}: {
  accounts: AccountSummary[]
  currentId: string
  onClose: () => void
  onUse: (id: string) => void
  onRefresh: () => Promise<void>
  addLog: (message: string, level?: 'info' | 'error') => void
}) {
  const [newId, setNewId] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const rowBusy = (id: string) => busy !== null && busy.endsWith(`:${id}`)

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(null)
    }
  }

  function add(e: FormEvent) {
    e.preventDefault()
    const id = newId.trim()
    if (!id) {
      setError('Account id is required')
      return
    }
    void run('add', async () => {
      await window.api.accounts.add({ id, label: newLabel.trim() || id })
      setNewId('')
      setNewLabel('')
      await onRefresh()
      addLog(`Added account ${id}`)
    })
  }

  function saveLabel(account: AccountSummary) {
    void run(`label:${account.id}`, async () => {
      await window.api.accounts.label({ id: account.id, label })
      setEditing(null)
      await onRefresh()
    })
  }

  function signIn(account: AccountSummary) {
    void run(`login:${account.id}`, async () => {
      const result = await window.api.auth.login(account.id)
      addLog(result.message, result.ok ? 'info' : 'error')
      await onRefresh()
    })
  }

  function importCookies(account: AccountSummary) {
    void run(`import:${account.id}`, async () => {
      const result = await window.api.auth.importCookies(account.id)
      addLog(result.message, result.ok ? 'info' : 'error')
      if (result.ok) await window.api.auth.status(account.id)
      await onRefresh()
    })
  }

  function exportCookies(account: AccountSummary) {
    void run(`export:${account.id}`, async () => {
      const result = await window.api.auth.exportCookies(account.id)
      addLog(
        result.path ? `Exported cookies to ${result.path}` : 'Cookie export cancelled or failed',
        result.path ? 'info' : 'error'
      )
    })
  }

  function remove(account: AccountSummary) {
    // removeAccount deletes the whole profile dir (cookies, sessions, queue)
    if (!window.confirm(`Remove "${account.id}"? Its browser profile, cookies and queue are deleted.`)) return
    void run(`remove:${account.id}`, async () => {
      const result = await window.api.accounts.remove(account.id)
      if (!result.ok) throw new Error(`Could not remove ${account.id}`)
      addLog(`Removed account ${account.id}`)
      await onRefresh()
    })
  }

  return (
    <Modal
      title="Accounts"
      onClose={onClose}
      footer={
        <>
          <span className="hint">Cookies are stored per account under profiles/</span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {accounts.length === 0 ? (
        <p className="hint">No accounts yet. Add one below, then sign in.</p>
      ) : (
        <ul className="accounts">
          {accounts.map((account) => (
            <li
              key={account.id}
              className={account.id === currentId ? 'account-row active' : 'account-row'}
              aria-busy={rowBusy(account.id)}
            >
              <div className="account-main">
                {editing === account.id ? (
                  <input
                    type="text"
                    value={label}
                    aria-label={`Label for ${account.id}`}
                    placeholder={account.id}
                    autoFocus
                    onChange={(e) => setLabel(e.target.value)}
                  />
                ) : (
                  <div className="account-title">
                    <span className="account-label">{account.label}</span>
                    <span className="account-id">{account.id}</span>
                    <AccountChip account={account} />
                    {account.id === currentId ? <span className="chip ok">Active</span> : null}
                  </div>
                )}
                {rowBusy(account.id) ? <div className="hint">working…</div> : null}
              </div>
              <div className="account-actions">
                {editing === account.id ? (
                  <>
                    <button
                      type="button"
                      className="btn tiny primary"
                      onClick={() => saveLabel(account)}
                      disabled={rowBusy(account.id)}
                    >
                      Save
                    </button>
                    <button type="button" className="btn tiny ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn tiny"
                      onClick={() => onUse(account.id)}
                      disabled={account.id === currentId || rowBusy(account.id)}
                    >
                      Use
                    </button>
                    <button
                      type="button"
                      className="btn tiny"
                      onClick={() => signIn(account)}
                      disabled={account.locked || rowBusy(account.id)}
                      title={account.locked ? 'Locked by another process' : 'Open a browser window to sign in'}
                    >
                      Sign in
                    </button>
                    <button
                      type="button"
                      className="btn tiny"
                      onClick={() => importCookies(account)}
                      disabled={account.locked || rowBusy(account.id)}
                    >
                      Import
                    </button>
                    <button
                      type="button"
                      className="btn tiny"
                      onClick={() => exportCookies(account)}
                      disabled={account.locked || rowBusy(account.id)}
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      className="btn tiny"
                      onClick={() => {
                        setEditing(account.id)
                        setLabel(account.label)
                      }}
                      disabled={rowBusy(account.id)}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="btn tiny danger"
                      onClick={() => remove(account)}
                      disabled={account.locked || rowBusy(account.id)}
                      title={account.locked ? 'Locked by another process' : 'Deletes the profile, cookies and queue'}
                    >
                      Remove
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="account-add" onSubmit={add}>
        <input
          type="text"
          value={newId}
          placeholder="New account id (e.g. brand-main)"
          aria-label="New account id"
          onChange={(e) => setNewId(e.target.value)}
        />
        <input
          type="text"
          value={newLabel}
          placeholder="Label (optional)"
          aria-label="New account label"
          onChange={(e) => setNewLabel(e.target.value)}
        />
        <button type="submit" className="btn" disabled={busy === 'add'}>
          {busy === 'add' ? 'Adding…' : 'Add'}
        </button>
      </form>
      {error ? <div className="row-error">{error}</div> : null}
    </Modal>
  )
}

function SettingsModal({
  settings,
  onClose,
  onSaved
}: {
  settings: Settings
  onClose: () => void
  onSaved: (next: Settings) => void
}) {
  const [headless, setHeadless] = useState(settings.headless)
  const [browserPath, setBrowserPath] = useState(settings.browserPath)
  const [maxDays, setMaxDays] = useState(settings.maxScheduleDays)
  const [visibility, setVisibility] = useState<Visibility>(settings.visibility)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const patch: Partial<Settings> = {
        headless,
        browserPath: browserPath.trim(),
        maxScheduleDays: maxDays,
        visibility
      }
      onSaved(await window.api.settings.set(patch))
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label htmlFor="set-headless">Run headless</label>
        <label className="flag" htmlFor="set-headless">
          <input id="set-headless" type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} />
          <span>Upload without a visible browser window</span>
        </label>
        <label htmlFor="set-browser">Browser path</label>
        <input
          id="set-browser"
          type="text"
          value={browserPath}
          placeholder="Auto-detect Chrome / Edge / Brave"
          onChange={(e) => setBrowserPath(e.target.value)}
        />
        <label htmlFor="set-days">Schedule horizon</label>
        <select id="set-days" value={maxDays} onChange={(e) => setMaxDays(Number(e.target.value))}>
          <option value={10}>10 days (standard)</option>
          <option value={30}>30 days (TikTok Studio)</option>
        </select>
        <label htmlFor="set-visibility">Default visibility</label>
        <select id="set-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
          {VISIBILITIES.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </div>
      {error ? <div className="row-error">{error}</div> : null}
    </Modal>
  )
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [accountId, setAccountId] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [running, setRunning] = useState(false)
  const [headed, setHeaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [logOpen, setLogOpen] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [authChecking, setAuthChecking] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  const accountIdRef = useRef('')
  /** Latest queue, for handlers that run after an await. */
  const jobsRef = useRef<Job[]>([])

  const addLog = useCallback((message: string, level: 'info' | 'error' = 'info') => {
    setLogs((prev) => [...prev.slice(-499), { ts: stamp(), message, level }])
  }, [])

  useEffect(() => {
    accountIdRef.current = accountId
  }, [accountId])

  const currentAccount = useMemo(() => accounts.find((a) => a.id === accountId), [accounts, accountId])
  const defaults = useMemo(
    () => ({ visibility: settings?.visibility ?? 'everyone', aiLabel: settings?.aiLabel ?? true }),
    [settings]
  )

  const persist = useCallback((account: string, next: Job[]) => {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void window.api.queue.save(account, next).catch((e: unknown) => addLog(`Save queue failed: ${errText(e)}`, 'error'))
    }, 250)
  }, [addLog])

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
    } catch (e) {
      addLog(`Could not list accounts: ${errText(e)}`, 'error')
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
        if (alive) addLog(`Could not load queue for ${accountId}: ${errText(e)}`, 'error')
      }
    })()
    return () => {
      alive = false
    }
  }, [accountId, addLog, replaceJobs])

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
        setAccounts((prev) =>
          prev.map((account) => (account.id === accountId ? { ...account, signedIn: status.signedIn } : account))
        )
        if (!status.signedIn) addLog(`${accountId}: ${status.message}`, 'error')
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
  }, [accountId, running, addLog])

  // Live queue events from main.
  useEffect(() => {
    return window.api.events.onQueue((event: QueueEvent) => {
      switch (event.type) {
        case 'log':
          addLog(event.message)
          break
        case 'job-stage':
          addLog(`${event.jobId ? `[${event.jobId}] ` : ''}${event.stage}`)
          break
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
          addLog(`Queue finished — ${event.done} done, ${event.failed} failed, ${event.skipped} skipped`)
          setRunning(false)
          break
      }
    })
  }, [addLog])

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
        return
      }
      commit([...current, ...added])
      addLog(`Added ${added.length} video(s)`)
    },
    [addLog, commit, defaults]
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
      jobs.map((job): Job => {
        if (job.draft || job.visibility === 'private') return { ...job, schedule: null }
        const iso = timestamps[index++]
        return iso ? { ...job, schedule: iso } : job
      })
    )
    setBulkOpen(false)
    addLog(`Applied ${timestamps.length} schedule slot(s)`)
  }

  function retryFailed() {
    const failed = jobs.filter((j) => j.status === 'failed').length
    if (!failed) {
      addLog('No failed jobs to retry')
      return
    }
    commit(jobs.map((job): Job => (job.status === 'failed' ? { ...job, status: 'pending', error: undefined, screenshot: undefined } : job)))
    setStartError(null)
    setConfirmOpen(true)
  }

  function clearFinished() {
    const next = jobs.filter((j) => j.status !== 'done' && j.status !== 'skipped')
    if (next.length === jobs.length) {
      addLog('Nothing finished to clear')
      return
    }
    commit(next)
    addLog(`Removed ${jobs.length - next.length} finished row(s)`)
  }

  async function signIn() {
    if (!accountId) return
    setBusy(true)
    addLog(`Opening a browser window to sign in ${accountId}…`)
    try {
      const result = await window.api.auth.login(accountId)
      addLog(result.message, result.ok ? 'info' : 'error')
      await refreshAccounts()
    } catch (e) {
      addLog(`Sign in failed: ${errText(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function startQueue() {
    if (!accountId) return
    setBusy(true)
    setStartError(null)
    try {
      const result = await window.api.queue.start({ accountId, jobs, headed })
      if (result.started) {
        setRunning(true)
        setConfirmOpen(false)
        addLog(`Started ${jobs.length} job(s) on ${accountId}${headed ? ' with a visible browser' : ''}`)
      } else {
        const message = result.error ?? 'Could not start the queue'
        setStartError(message)
        addLog(message, 'error')
      }
    } catch (e) {
      const message = errText(e)
      setStartError(message)
      addLog(message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function stopQueue() {
    if (!accountId) return
    setBusy(true)
    try {
      const result = await window.api.queue.stop(accountId)
      addLog(result.stopped ? 'Stop requested — the in-flight job will finish' : 'Nothing to stop')
    } catch (e) {
      addLog(`Stop failed: ${errText(e)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function copyLog() {
    const text = logs.map((line) => `${line.ts}  ${line.message}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      addLog('Log copied to clipboard')
    } catch (e) {
      addLog(`Copy failed: ${errText(e)}`, 'error')
    }
  }

  const schedulableCount = jobs.filter((j) => !j.draft && j.visibility !== 'private').length
  const finishedCount = jobs.filter((j) => j.status === 'done' || j.status === 'skipped').length
  const runLabel = running ? 'Running…' : 'Run'

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      <header className="toolbar">
        <div className="brand">
          <span className="dot" aria-hidden="true" />
          TikTok Uploader
        </div>

        <div className="field account">
          <label htmlFor="account-select" className="sr-only">
            Account
          </label>
          <select
            id="account-select"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            aria-label="Account"
          >
            {accounts.length === 0 ? <option value="">No accounts yet</option> : null}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.id})
              </option>
            ))}
          </select>
          <AccountChip account={currentAccount} checking={authChecking} />
        </div>

        <div className="group">
          <button type="button" className="btn" onClick={() => void signIn()} disabled={!accountId || busy}>
            Sign In
          </button>
          <button type="button" className="btn" onClick={() => setAccountsOpen(true)}>
            Accounts
          </button>
        </div>

        <div className="group">
          <button type="button" className="btn" onClick={() => void addVideos()} disabled={!accountId}>
            Add videos
          </button>
          <button type="button" className="btn" onClick={() => void addFolder()} disabled={!accountId}>
            Add folder
          </button>
          <button type="button" className="btn" onClick={() => setBulkOpen(true)} disabled={!schedulableCount}>
            Bulk Schedule
          </button>
          <button type="button" className="btn" onClick={retryFailed} disabled={!jobs.some((j) => j.status === 'failed')}>
            Retry Failed
          </button>
          <button type="button" className="btn" onClick={clearFinished} disabled={!finishedCount}>
            Clear
          </button>
        </div>

        <span className="spacer" />

        <label className="flag" htmlFor="show-browser" title="Open a visible browser window while running">
          <input id="show-browser" type="checkbox" checked={headed} onChange={(e) => setHeaded(e.target.checked)} />
          <span>Show browser</span>
        </label>

        <button
          type="button"
          className="icon-btn"
          aria-label="Settings"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" strokeLinecap="round" />
            <circle cx="16" cy="7" r="2" />
            <circle cx="8" cy="17" r="2" />
          </svg>
        </button>

        <button type="button" className="btn primary" onClick={() => { setStartError(null); setConfirmOpen(true) }} disabled={!accountId || !jobs.length || running}>
          {runLabel}
        </button>
        <button type="button" className="btn danger" onClick={() => void stopQueue()} disabled={!running || busy}>
          Stop
        </button>
      </header>

      <main className="queue-wrap">
        {jobs.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No videos queued</p>
            <p>Drop files or a folder here, or use Add videos / Add folder.</p>
          </div>
        ) : (
          <table className="queue">
            <thead>
              <tr>
                <th scope="col" className="col-file">File</th>
                <th scope="col" className="col-caption">Caption</th>
                <th scope="col" className="col-schedule">Schedule</th>
                <th scope="col" className="col-vis">Visibility</th>
                <th scope="col" className="col-flags">Options</th>
                <th scope="col" className="col-status">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onChange={(patch) => updateJob(job.id, patch)}
                />
              ))}
            </tbody>
          </table>
        )}
      </main>

      <section className={`log ${logOpen ? 'open' : 'closed'}`} aria-label="Run log">
        <div className="log-head">
          <button
            type="button"
            className="btn tiny"
            aria-expanded={logOpen}
            aria-controls="log-lines"
            onClick={() => setLogOpen((v) => !v)}
          >
            {logOpen ? '▾' : '▸'} Log
          </button>
          <span className="hint" role="status" aria-live="polite">
            {running ? 'Running' : 'Idle'} · {logs.length} line(s)
          </span>
          <span className="spacer" />
          <button type="button" className="btn tiny" onClick={() => void copyLog()} disabled={!logs.length}>
            Copy
          </button>
        </div>
        {logOpen ? (
          <div className="log-lines" id="log-lines" ref={logRef} aria-live="polite" role="log">
            {logs.length === 0 ? (
              <div className="log-line muted">Waiting for events…</div>
            ) : (
              logs.map((line, i) => (
                <div key={`${line.ts}-${i}`} className={`log-line ${line.level}`}>
                  <span className="ts">{line.ts}</span>
                  <span className="msg">{line.message}</span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>

      {dragOver ? (
        <div className="drop-overlay">
          <div className="drop-card">Drop videos or a folder</div>
        </div>
      ) : null}

      {bulkOpen ? (
        <BulkModal
          count={schedulableCount}
          onClose={() => setBulkOpen(false)}
          onApply={applyBulk}
        />
      ) : null}

      {confirmOpen ? (
        <ConfirmModal
          account={currentAccount}
          jobs={jobs}
          headed={headed}
          busy={busy}
          error={startError}
          onClose={() => {
            setConfirmOpen(false)
            setStartError(null)
          }}
          onStart={() => void startQueue()}
        />
      ) : null}

      {accountsOpen ? (
        <AccountManagerModal
          accounts={accounts}
          currentId={accountId}
          addLog={addLog}
          onClose={() => setAccountsOpen(false)}
          onRefresh={refreshAccounts}
          onUse={(id) => {
            setAccountId(id)
            setAccountsOpen(false)
          }}
        />
      ) : null}

      {settingsOpen && settings ? (
        <SettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSaved={(next) => {
            setSettings(next)
            setSettingsOpen(false)
            setHeaded(!next.headless)
            addLog('Settings saved')
          }}
        />
      ) : null}
    </div>
  )
}
