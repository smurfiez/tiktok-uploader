import { Modal } from './Modal'

export interface ConfirmDialogProps {
  title: string
  description: string
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      size="sm"
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? 'btn danger' : 'btn primary'}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p>{description}</p>
    </Modal>
  )
}
