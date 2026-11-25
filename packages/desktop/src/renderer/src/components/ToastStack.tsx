import type { ToastItem } from '../utils'
import { AlertIcon, CheckIcon, CloseIcon, InfoIcon } from './Icons'

const TONE_ICON = {
  ok: CheckIcon,
  error: AlertIcon,
  info: InfoIcon
}

export interface ToastStackProps {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => {
        const Icon = TONE_ICON[toast.tone]
        return (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
            <Icon />
            <span>{toast.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(toast.id)}
            >
              <CloseIcon size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
