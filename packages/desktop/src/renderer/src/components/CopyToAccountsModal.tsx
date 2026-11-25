import { useState } from 'react'
import type { AccountSummary, Job } from '@tiktok-uploader/core'
import { baseName } from '../utils'
import { Modal } from './Modal'
import { ToggleSwitch } from './ToggleSwitch'

export interface CopyToAccountsModalProps {
  job: Job
  accounts: AccountSummary[]
  currentAccountId: string
  onClose: () => void
  onCopy: (accountIds: string[], keepSchedule: boolean) => void
}

export function CopyToAccountsModal({
  job,
  accounts,
  currentAccountId,
  onClose,
  onCopy
}: CopyToAccountsModalProps) {
  const others = accounts.filter((account) => account.id !== currentAccountId)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [keepSchedule, setKeepSchedule] = useState(false)

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Modal
      title="Copy to Accounts"
      subtitle={baseName(job.videoPath)}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={!selected.size}
            onClick={() => onCopy(Array.from(selected), keepSchedule)}
          >
            Copy to {selected.size} account{selected.size === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      {others.length ? (
        <div className="account-picker">
          {others.map((account) => (
            <button
              key={account.id}
              type="button"
              className={`account-card${selected.has(account.id) ? ' selected' : ''}`}
              aria-pressed={selected.has(account.id)}
              onClick={() => toggle(account.id)}
            >
              <span
                className={`status-dot ${account.locked ? 'locked' : account.signedIn ? 'ok' : 'bad'}`}
                aria-hidden="true"
              />
              <span className="account-name">{account.label}</span>
              {account.group ? <span className="badge">{account.group}</span> : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="hint">No other accounts yet. Add one from the sidebar first.</p>
      )}

      <div className="field">
        <span className="field-label">Keep schedule</span>
        <ToggleSwitch checked={keepSchedule} onChange={setKeepSchedule} label="Keep schedule" />
        <p className="hint">
          {keepSchedule
            ? 'The copied video keeps this schedule, which can collide with the other account.'
            : 'The copied video is queued with no schedule so you can stagger it later.'}
        </p>
      </div>
    </Modal>
  )
}
