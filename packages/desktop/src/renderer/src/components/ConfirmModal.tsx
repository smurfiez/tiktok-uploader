import type { AccountSummary, Job, Visibility } from '@tiktok-uploader/core'
import { HARD_LIMIT, VISIBILITIES, formatWhen, validateRowSchedule } from '../utils'
import { AccountChip } from './AccountChip'
import { Modal } from './Modal'

export interface ConfirmModalProps {
  account?: AccountSummary
  jobs: Job[]
  headed: boolean
  busy: boolean
  maxScheduleDays: number
  error: string | null
  onClose: () => void
  onStart: () => void
}

export function ConfirmModal({
  account,
  jobs,
  headed,
  busy,
  maxScheduleDays,
  error,
  onClose,
  onStart
}: ConfirmModalProps) {
  const scheduled = jobs
    .map((job) => job.schedule)
    .filter((value): value is string => Boolean(value))
    .sort()
  const span = scheduled.length
    ? `${formatWhen(scheduled[0])} → ${formatWhen(scheduled[scheduled.length - 1])}`
    : 'Post now (no schedule set)'

  const emptyCaptions = jobs.filter((job) => !job.description.trim()).length
  const tooLong = jobs.filter((job) => job.description.length > HARD_LIMIT).length
  const badSchedules = jobs.filter(
    (job) => validateRowSchedule(job.schedule, maxScheduleDays)?.level === 'error'
  ).length

  const counts: Record<Visibility, number> = { everyone: 0, friends: 0, private: 0 }
  for (const job of jobs) counts[job.visibility] += 1
  const visibility =
    VISIBILITIES.filter((item) => counts[item.value] > 0)
      .map((item) => `${item.label} ${counts[item.value]}`)
      .join(' · ') || '—'

  const warnings: string[] = []
  if (emptyCaptions) warnings.push(`${emptyCaptions} caption(s) are empty`)
  if (badSchedules) warnings.push(`${badSchedules} schedule(s) are outside the allowed window`)
  if (account && !account.signedIn) warnings.push('Account is not signed in')

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
          <button
            type="button"
            className="btn primary"
            onClick={onStart}
            disabled={busy || !jobs.length || tooLong > 0}
          >
            {busy ? 'Starting…' : `Run ${jobs.length} job(s)`}
          </button>
        </>
      }
    >
      <div className="field-label">
        <span>{account?.label ?? 'No account'}</span>
        <AccountChip account={account} />
      </div>

      <dl className="kv-grid">
        <dt>Jobs</dt>
        <dd>{jobs.length}</dd>
        <dt>Schedule span</dt>
        <dd>{span}</dd>
        <dt>Visibility</dt>
        <dd>{visibility}</dd>
        <dt>Empty captions</dt>
        <dd>{emptyCaptions}</dd>
        <dt>Mode</dt>
        <dd>{headed ? 'Headed browser (Show browser on)' : 'Headless'}</dd>
      </dl>

      <p className="hint">Scheduled posts cannot be edited on TikTok afterwards. Review the rows before running.</p>

      {tooLong ? (
        <div className="alert error">
          {tooLong} caption(s) exceed the {HARD_LIMIT}-character limit
        </div>
      ) : null}
      {warnings.length ? <div className="alert warn">{warnings.join(' · ')}</div> : null}
      {error ? <div className="alert error">{error}</div> : null}
    </Modal>
  )
}
