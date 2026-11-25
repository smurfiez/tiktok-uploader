import { useMemo, useState } from 'react'
import type { AccountSummary } from '@tiktok-uploader/core'
import { errText, formatWhen } from '../utils'
import { AccountChip } from './AccountChip'
import { PlayIcon, RefreshIcon, StopIcon } from './Icons'

function checkedLabel(iso?: string): string {
  if (!iso) return 'never checked'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'never checked'
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000))
  if (mins < 1) return 'checked just now'
  if (mins < 60) return `checked ${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `checked ${hours}h ago`
  return `checked ${Math.round(hours / 24)}d ago`
}

export interface AccountsOverviewProps {
  accounts: AccountSummary[]
  runningAccounts: Set<string>
  stoppingAccounts?: Set<string>
  headed: boolean
  onOpen(id: string): void
  onEdit(account: AccountSummary): void
  onCookies(account: AccountSummary): void
  onRun(id: string): void
  onStop(id: string): void
  onChanged(): void | Promise<void>
  onNotify?: (message: string, tone?: 'info' | 'ok' | 'error') => void
}

export function AccountsOverview({
  accounts,
  runningAccounts,
  stoppingAccounts,
  headed,
  onOpen,
  onEdit,
  onCookies,
  onRun,
  onStop,
  onChanged,
  onNotify
}: AccountsOverviewProps) {
  const [checking, setChecking] = useState<{ done: number; total: number } | null>(null)
  const [confirm, setConfirm] = useState<{ ids: string[]; videos: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [group, setGroup] = useState<string | null>(null)

  const groups = useMemo(
    () => Array.from(new Set(accounts.map((a) => a.group?.trim()).filter(Boolean))) as string[],
    [accounts]
  )
  const visible = group ? accounts.filter((a) => a.group === group) : accounts

  const signedInCount = accounts.filter((a) => a.signedIn).length
  const pendingVideos = accounts.reduce((sum, a) => sum + a.pendingCount + a.failedCount, 0)
  const attention = accounts.filter((a) => a.failedCount > 0 || !a.signedIn).length
  const ready = accounts.filter(
    (a) => a.signedIn && !a.locked && !runningAccounts.has(a.id) && a.pendingCount + a.failedCount > 0
  )

  async function checkAll() {
    const targets = accounts.filter((a) => !a.locked)
    if (!targets.length) return
    setError(null)
    setChecking({ done: 0, total: targets.length })
    try {
      for (let i = 0; i < targets.length; i++) {
        setChecking({ done: i + 1, total: targets.length })
        try {
          await window.api.auth.status(targets[i].id)
        } catch {
          // one broken profile must not stop the batch
        }
      }
      await onChanged()
    } finally {
      setChecking(null)
    }
  }

  function askRunAll() {
    setError(null)
    setConfirm({
      ids: ready.map((a) => a.id),
      videos: ready.reduce((sum, a) => sum + a.pendingCount + a.failedCount, 0)
    })
  }

  async function startAll() {
    if (!confirm) return
    setBusy(true)
    setError(null)
    try {
      const res = await window.api.queue.startAll({ accountIds: confirm.ids, headed })
      setConfirm(null)
      await onChanged()
      onNotify?.(
        `Started ${res.started.length} account(s)${res.queued.length ? `, ${res.queued.length} queued next` : ''}${res.skipped.length ? `, ${res.skipped.length} skipped` : ''}`,
        res.skipped.length ? 'info' : 'ok'
      )
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overview">
      <header className="overview-header">
        <h2>All Accounts</h2>
        <span className="spacer" />
        {checking ? (
          <span className="hint">
            Checking {checking.done} / {checking.total}…
          </span>
        ) : null}
        <button
          type="button"
          className="btn"
          disabled={Boolean(checking) || !accounts.some((a) => !a.locked)}
          onClick={() => void checkAll()}
        >
          <RefreshIcon />
          Check All Sessions
        </button>
        <button type="button" className="btn primary" disabled={!ready.length} onClick={askRunAll}>
          <PlayIcon />
          Run All Ready
        </button>
      </header>

      {confirm ? (
        <div className="overview-confirm">
          <strong>
            Run {confirm.ids.length} account{confirm.ids.length === 1 ? '' : 's'} · {confirm.videos} video
            {confirm.videos === 1 ? '' : 's'}
          </strong>
          <span className="hint">{headed ? 'Visible browser windows' : 'Headless'}</span>
          <span className="spacer" />
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirm(null)}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void startAll()}>
            {busy ? 'Starting…' : 'Start'}
          </button>
        </div>
      ) : null}

      {error ? <div className="alert error">{error}</div> : null}

      <div className="overview-kpis">
        <div className="kpi-card">
          <span className="kpi-label">Accounts</span>
          <strong className="kpi-value">{accounts.length}</strong>
          <span className="kpi-sub">{signedInCount} signed in</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Pending Videos</span>
          <strong className="kpi-value">{pendingVideos}</strong>
          <span className="kpi-sub">pending + failed</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Currently Running</span>
          <strong className="kpi-value">
            <span className="status-dot running" aria-hidden="true" />
            {runningAccounts.size}
          </strong>
          <span className="kpi-sub">live queues</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">Needs Attention</span>
          <strong className="kpi-value">{attention}</strong>
          <span className="kpi-sub">failed or signed out</span>
        </div>
      </div>

      {groups.length ? (
        <div className="filter-pills">
          <button
            type="button"
            className="option-pill"
            aria-pressed={group === null}
            onClick={() => setGroup(null)}
          >
            All groups
          </button>
          {groups.map((name) => (
            <button
              key={name}
              type="button"
              className="option-pill"
              aria-pressed={group === name}
              onClick={() => setGroup(name)}
            >
              {name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="queue-surface">
        <table className="overview-table">
          <thead>
            <tr>
              <th>Account</th>
              <th>Session</th>
              <th>Queue</th>
              <th>Next Slot</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((account) => {
              const running = runningAccounts.has(account.id)
              const stopping = stoppingAccounts?.has(account.id) ?? false
              return (
                <tr key={account.id}>
                  <td>
                    <div className="account-cell">
                      <span className={`account-avatar${account.color ? ` ${account.color}` : ''}`}>
                        {account.label.trim().charAt(0).toUpperCase() || '?'}
                      </span>
                      <div className="account-meta">
                        <strong>{account.label}</strong>
                        {account.handle ? <span className="hint">@{account.handle}</span> : null}
                      </div>
                      {account.group ? <span className="badge">{account.group}</span> : null}
                    </div>
                  </td>
                  <td>
                    <AccountChip account={account} />
                    <span className="hint">{checkedLabel(account.lastCheckedAt)}</span>
                  </td>
                  <td>
                    <div className="queue-pills">
                      {account.pendingCount ? <span className="badge">{account.pendingCount} pending</span> : null}
                      {account.scheduledCount ? (
                        <span className="badge">{account.scheduledCount} scheduled</span>
                      ) : null}
                      {account.failedCount ? (
                        <span className="badge error">{account.failedCount} failed</span>
                      ) : null}
                      {account.doneCount ? <span className="badge ok">{account.doneCount} done</span> : null}
                      {!account.pendingCount &&
                      !account.scheduledCount &&
                      !account.failedCount &&
                      !account.doneCount ? (
                        <span className="hint">Empty</span>
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <span className="hint">
                      {account.nextSchedule ? formatWhen(account.nextSchedule) : 'Not scheduled'}
                    </span>
                  </td>
                  <td>
                    <div className="actions-cell">
                      <button type="button" className="btn ghost sm" onClick={() => onOpen(account.id)}>
                        Open
                      </button>
                      {running ? (
                        <button
                          type="button"
                          className="btn danger sm"
                          disabled={stopping}
                          onClick={() => onStop(account.id)}
                        >
                          <StopIcon />
                          {stopping ? 'Stopping…' : 'Stop'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn ghost sm"
                          disabled={
                            !account.signedIn ||
                            account.locked ||
                            account.pendingCount + account.failedCount === 0
                          }
                          title={account.locked ? 'Profile is in use by another run' : undefined}
                          onClick={() => onRun(account.id)}
                        >
                          <PlayIcon />
                          Run
                        </button>
                      )}
                      <button type="button" className="btn ghost sm" onClick={() => onCookies(account)}>
                        Cookies
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => onEdit(account)}>
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!visible.length ? (
          <div className="empty-state">
            <h3>No accounts yet</h3>
            <p className="hint">Add an account from the sidebar to start uploading.</p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
