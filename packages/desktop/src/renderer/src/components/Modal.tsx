import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { CloseIcon } from './Icons'

export interface ModalProps {
  title: string
  subtitle?: string
  size?: 'sm' | 'md' | 'lg'
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ title, subtitle, size = 'md', onClose, children, footer }: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = dialog.current
    // Children mount first, so an autoFocus input already owns focus.
    if (node && !node.contains(document.activeElement)) node.focus()
  }, [])

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
      <div
        ref={dialog}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="modal-close" aria-label="Close dialog" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>
  )
}
