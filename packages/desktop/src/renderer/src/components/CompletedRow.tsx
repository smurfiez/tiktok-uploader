import type { Job } from '@tiktok-uploader/core'
import { STATUS_LABEL, VISIBILITIES, baseName, fileExt, formatWhen } from '../utils'
import { FilmIcon, RefreshIcon, TrashIcon } from './Icons'

export interface CompletedRowProps {
  job: Job
  onRequeue: () => void
  onRemove: () => void
}

export function CompletedRow({ job, onRequeue, onRemove }: CompletedRowProps) {
  const visibility = VISIBILITIES.find((item) => item.value === job.visibility)?.label ?? job.visibility

  return (
    <tr className="job-row completed-row">
      <td className="video-cell">
        <span className="video-thumb">
          <FilmIcon />
        </span>
        <strong title={job.videoPath}>{baseName(job.videoPath)}</strong>
        <span className="ext-tag">{fileExt(job.videoPath)}</span>
      </td>

      <td className="caption-cell">
        <div
          className="caption-readonly"
          title={job.description}
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {job.description || <span className="hint">No caption</span>}
        </div>
      </td>

      <td className="schedule-cell">
        <span className="hint">{formatWhen(job.schedule)}</span>
      </td>

      <td className="settings-cell">
        <span className="badge">{visibility}</span>
        {job.draft ? <span className="badge warn">Draft</span> : null}
        {job.aiLabel ? <span className="badge ok">AI</span> : null}
      </td>

      <td className="status-cell">
        <span className={`status-pill ${job.status}`}>
          <span className="status-dot" aria-hidden="true" />
          {STATUS_LABEL[job.status]}
        </span>
        <button type="button" className="btn ghost sm" title="Re-queue" aria-label="Re-queue" onClick={onRequeue}>
          <RefreshIcon />
        </button>
        <button type="button" className="remove-btn" title="Remove" aria-label="Remove" onClick={onRemove}>
          <TrashIcon />
        </button>
      </td>
    </tr>
  )
}
