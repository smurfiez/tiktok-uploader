import { useState } from 'react'
import type { AccountSummary } from '@tiktok-uploader/core'
import { detectCookieFormat, errText } from '../utils'
import { CookieIcon } from './Icons'
import { Modal } from './Modal'

type ImportCookiesResult = Awaited<ReturnType<typeof window.api.auth.importCookiesText>>

interface Feedback {
  tone: 'ok' | 'error'
  text: string
}

export interface ImportCookiesModalProps {
  account: AccountSummary
  onClose: () => void
  onImported: (result: { signedIn: boolean; message: string }) => void
}

export function ImportCookiesModal({ account, onClose, onImported }: ImportCookiesModalProps) {
  const { id: accountId } = account
  const [tab, setTab] = useState<'devtools' | 'extension'>('devtools')
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const format = detectCookieFormat(raw)

  function report(result: ImportCookiesResult) {
    setFeedback({ tone: result.ok ? 'ok' : 'error', text: result.message })
    if (result.ok) onImported({ signedIn: result.signedIn ?? true, message: result.message })
  }

  async function fromFile() {
    setBusy(true)
    setFeedback(null)
    try {
      const result = await window.api.auth.importCookies(accountId)
      if (!result.canceled) report(result)
    } catch (e) {
      setFeedback({ tone: 'error', text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    if (!raw.trim() || busy) return
    setBusy(true)
    setFeedback(null)
    try {
      report(await window.api.auth.importCookiesText({ accountId, text: raw }))
    } catch (e) {
      setFeedback({ tone: 'error', text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Import Cookies from Chrome"
      subtitle={`Account: ${account.label}`}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={() => void fromFile()} disabled={busy}>
            <CookieIcon />
            Import from File (.txt / .json)
          </button>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => void verify()}
            disabled={!raw.trim() || busy}
          >
            {busy ? 'Verifying…' : 'Import & Verify'}
          </button>
        </>
      }
    >
      <div className="tabs" role="tablist" aria-label="Import method">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'devtools'}
          className={tab === 'devtools' ? 'tab active' : 'tab'}
          onClick={() => setTab('devtools')}
        >
          Chrome DevTools
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'extension'}
          className={tab === 'extension' ? 'tab active' : 'tab'}
          onClick={() => setTab('extension')}
        >
          Chrome Extension
        </button>
      </div>

      <div className="steps-card">
        <p className="hint">
          {tab === 'devtools' ? 'Fastest · No Extension' : 'JSON or .txt export'}
        </p>
        {tab === 'devtools' ? (
          <ol className="steps-list">
            <li>
              Open <strong>tiktok.com</strong> in Google Chrome and make sure you are signed in.
            </li>
            <li>
              Press <kbd className="kbd">Cmd</kbd> + <kbd className="kbd">Option</kbd> +{' '}
              <kbd className="kbd">I</kbd> (Mac) or <kbd className="kbd">F12</kbd> (Windows / Linux) to
              open DevTools.
            </li>
            <li>
              Select the <strong>Application</strong> tab at the top (click <code>»</code> if it isn't
              visible).
            </li>
            <li>
              In the left sidebar, expand <strong>Cookies</strong> and click{' '}
              <strong>https://www.tiktok.com</strong>.
            </li>
            <li>
              Find the cookie named{' '}
              <strong>
                <code>sessionid</code>
              </strong>
              , copy its <strong>Value</strong>, and paste it below.
            </li>
          </ol>
        ) : (
          <ol className="steps-list">
            <li>
              Install <strong>Cookie-Editor</strong> or <strong>Get cookies.txt LOCALLY</strong> from the
              Chrome Web Store.
            </li>
            <li>
              While logged in to <strong>tiktok.com</strong>, click the extension icon in Chrome's
              toolbar.
            </li>
            <li>
              Click <strong>Export</strong> → choose <strong>JSON</strong> (Cookie-Editor) or{' '}
              <strong>
                Netscape <code>.txt</code>
              </strong>{' '}
              (Get cookies.txt LOCALLY).
            </li>
            <li>
              Paste the exported cookies below, <strong>or</strong> click{' '}
              <strong>Import from File (.txt / .json)</strong>.
            </li>
          </ol>
        )}
      </div>

      <div className="field-label">
        <label htmlFor="cookie-text">Paste cookies</label>
        <span className="badge">{format ?? 'Unknown format'}</span>
      </div>
      <textarea
        id="cookie-text"
        className="textarea"
        rows={6}
        value={raw}
        spellCheck={false}
        placeholder="sessionid, Cookie: header, JSON array, or Netscape .txt"
        onChange={(e) => setRaw(e.target.value)}
      />
      <p className="hint">Stored locally on your computer with private permissions (0600).</p>

      {feedback ? (
        <div className={`alert ${feedback.tone}`} role="status">
          {feedback.text}
        </div>
      ) : null}
    </Modal>
  )
}
