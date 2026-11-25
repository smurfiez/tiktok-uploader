import { useEffect, useState } from 'react'
import type { StaggerRule } from '@tiktok-uploader/core'
import { errText, formatWhen, localInput } from '../utils'
import { Modal } from './Modal'

const PRESETS = ['6h', '12h', '1d', '2d']

export interface BulkModalProps {
  count: number
  /** Validate against this account's schedule horizon instead of the global one */
  accountId?: string
  /** Pre-fill from the account's bulk preset defaults */
  defaultEvery?: string
  defaultJitter?: string
  defaultWindow?: string
  onClose: () => void
  onApply: (timestamps: string[]) => void
}

export function BulkModal({
  count,
  accountId,
  defaultEvery,
  defaultJitter,
  defaultWindow,
  onClose,
  onApply
}: BulkModalProps) {
  const [start, setStart] = useState(() => localInput(new Date(Date.now() + 60 * 60 * 1000)))
  const [every, setEvery] = useState(defaultEvery?.trim() || '12h')
  const [jitter, setJitter] = useState(defaultJitter?.trim() || '')
  const [quiet, setQuiet] = useState(defaultWindow?.trim() || '')
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
        .stagger(count, rule, accountId)
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
  }, [start, every, jitter, quiet, count, accountId])

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
      <div className="kv-grid">
        <label htmlFor="bulk-start">Start</label>
        <input id="bulk-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        <label htmlFor="bulk-every">Every</label>
        <input id="bulk-every" type="text" value={every} placeholder="12h" onChange={(e) => setEvery(e.target.value)} />
        <label htmlFor="bulk-jitter">Jitter (optional)</label>
        <input id="bulk-jitter" type="text" value={jitter} placeholder="15m" onChange={(e) => setJitter(e.target.value)} />
        <label htmlFor="bulk-window">Quiet window (optional)</label>
        <input
          id="bulk-window"
          type="text"
          value={quiet}
          placeholder="09:00-21:00"
          onChange={(e) => setQuiet(e.target.value)}
        />
      </div>

      <div className="preset-row">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="preset-chip"
            aria-pressed={every.trim() === preset}
            onClick={() => setEvery(preset)}
          >
            {preset}
          </button>
        ))}
      </div>

      <p className="hint">{count} schedulable row(s). Drafts and private rows are skipped.</p>
      {error ? <div className="alert error">{error}</div> : null}

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
