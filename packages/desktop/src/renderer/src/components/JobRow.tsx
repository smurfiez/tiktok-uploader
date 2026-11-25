import type { Job, Visibility } from '@tiktok-uploader/core'
import {
  SOFT_LIMIT,
  HARD_LIMIT,
  VISIBILITIES,
  STATUS_LABEL,
  baseName,
  fileExt,
  formatWhen,
  isoToLocal,
  localToIso,
  validateRowSchedule
} from '../utils'
import { CheckIcon, CloseIcon, FilmIcon, TrashIcon } from './Icons'

export interface JobRowProps {
  job: Job
  maxScheduleDays: number
  onChange: (patch: Partial<Job>) => void
  onRemove: () => void
}

interface PillProps {
  label: string
  active: boolean
  onToggle: () => void
  variant?: string
  title?: string
}

function Pill({ label, active, onToggle, variant, title }: PillProps) {
  return (
    <button
      type="button"
      className={variant ? `option-pill ${variant}` : 'option-pill'}
      aria-pressed={active}
      title={title}
      onClick={onToggle}
    >
      {active ? <CheckIcon size={12} /> : null}
      {label}
    </button>
  )
}

export function JobRow({ job, maxScheduleDays, onChange, onRemove }: JobRowProps) {
  const name = baseName(job.videoPath)
  const length = job.description.length
  const scheduleDisabled = job.draft || job.visibility === 'private'
  const disabledReason = job.draft ? 'Drafts cannot be scheduled' : 'Private posts cannot be scheduled'
  const check = validateRowSchedule(job.schedule, maxScheduleDays)
  const screenshot = job.screenshot

  const setVisibility = (visibility: Visibility) => {
    if (visibility === 'private' && job.schedule) onChange({ visibility, schedule: null })
    else onChange({ visibility })
  }

  return (
    <tr className="job-row">
      <td className="video-cell">
        <span className="video-thumb">
          <FilmIcon />
        </span>
        <strong title={job.videoPath}>{name}</strong>
        <span className="ext-tag">{fileExt(job.videoPath)}</span>
      </td>

      <td className="caption-cell">
        <textarea
          className="caption-input"
          rows={3}
          value={job.description}
          aria-label={`Caption for ${name}`}
          placeholder="Write a caption"
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <div className="caption-meta">
          <span className="char-count">
            {length} / {length > HARD_LIMIT ? HARD_LIMIT : SOFT_LIMIT}
          </span>
          {length > SOFT_LIMIT ? <span className="badge warn">Over preview limit</span> : null}
          {length > HARD_LIMIT ? <span className="badge error">Over hard limit</span> : null}
        </div>
      </td>

      <td className="schedule-cell">
        <input
          type="datetime-local"
          className="datetime-input"
          value={isoToLocal(job.schedule)}
          disabled={scheduleDisabled}
          aria-label={`Schedule for ${name}`}
          title={scheduleDisabled ? disabledReason : undefined}
          onChange={(e) => onChange({ schedule: localToIso(e.target.value) })}
        />
        {job.schedule ? (
          <button type="button" className="clear-btn" aria-label="Clear schedule" onClick={() => onChange({ schedule: null })}>
            <CloseIcon size={12} />
          </button>
        ) : null}
        <div className="hint">{scheduleDisabled ? disabledReason : formatWhen(job.schedule)}</div>
        {check ? <span className={`schedule-badge ${check.level}`}>{check.text}</span> : null}
      </td>

      <td className="settings-cell">
        <select
          className="visibility-select"
          value={job.visibility}
          aria-label={`Visibility for ${name}`}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
        >
          {VISIBILITIES.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
        <div className="option-pills">
          <Pill
            label="Draft"
            variant="draft"
            active={job.draft}
            title="Save as draft: scheduling is not allowed"
            onToggle={() => onChange({ draft: !job.draft, schedule: !job.draft ? null : job.schedule })}
          />
          <Pill label="AI" active={job.aiLabel} onToggle={() => onChange({ aiLabel: !job.aiLabel })} />
          <Pill label="Comment" active={job.comment} onToggle={() => onChange({ comment: !job.comment })} />
          <Pill label="Duet" active={job.duet} onToggle={() => onChange({ duet: !job.duet })} />
          <Pill label="Stitch" active={job.stitch} onToggle={() => onChange({ stitch: !job.stitch })} />
        </div>
      </td>

      <td className="status-cell">
        <span className={`status-pill ${job.status}`}>
          <span className="status-dot" aria-hidden="true" />
          {STATUS_LABEL[job.status]}
        </span>
        {job.error ? (
          <div className="row-error">
            {job.error}
            {screenshot ? (
              <button
                type="button"
                className="screenshot-link"
                aria-label={`Open failure screenshot ${baseName(screenshot)}`}
                onClick={() => void window.api.reveal(screenshot)}
              >
                {baseName(screenshot)}
              </button>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="remove-btn"
          aria-label="Remove row"
          disabled={job.status === 'running'}
          onClick={onRemove}
        >
          <TrashIcon />
        </button>
      </td>
    </tr>
  )
}
