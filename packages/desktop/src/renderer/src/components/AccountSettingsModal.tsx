import { useState } from 'react'
import type { AccountColor, AccountPatch, AccountSummary, Visibility } from '@tiktok-uploader/core'
import { VISIBILITIES, errText } from '../utils'
import { Modal } from './Modal'

const COLORS: AccountColor[] = ['red', 'teal', 'blue', 'amber', 'purple', 'green']

type RecursiveChoice = 'inherit' | 'yes' | 'no'
type AiChoice = 'inherit' | 'on' | 'off'
type HorizonChoice = 'inherit' | '10' | '30'

export interface AccountSettingsModalProps {
  account: AccountSummary
  onClose: () => void
  onSaved: (next: AccountSummary) => void
}

export function AccountSettingsModal({ account, onClose, onSaved }: AccountSettingsModalProps) {
  const defaults = account.defaults
  const [label, setLabel] = useState(account.label)
  const [group, setGroup] = useState(account.group ?? '')
  const [color, setColor] = useState<AccountColor | null>(account.color ?? null)
  const [folder, setFolder] = useState(account.sourceFolder ?? '')
  const [recursive, setRecursive] = useState<RecursiveChoice>(
    account.recursiveFolder === undefined ? 'inherit' : account.recursiveFolder ? 'yes' : 'no'
  )
  const [visibility, setVisibility] = useState<'inherit' | Visibility>(defaults?.visibility ?? 'inherit')
  const [aiLabel, setAiLabel] = useState<AiChoice>(
    defaults?.aiLabel === undefined ? 'inherit' : defaults.aiLabel ? 'on' : 'off'
  )
  const [horizon, setHorizon] = useState<HorizonChoice>(
    defaults?.maxScheduleDays === undefined ? 'inherit' : (String(defaults.maxScheduleDays) as HorizonChoice)
  )
  const [bulkEvery, setBulkEvery] = useState(defaults?.bulkEvery ?? '')
  const [bulkJitter, setBulkJitter] = useState(defaults?.bulkJitter ?? '')
  const [bulkWindow, setBulkWindow] = useState(defaults?.bulkWindow ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function browse() {
    try {
      const picked = await window.api.videos.pickFolder()
      if (picked) setFolder(picked)
    } catch (e) {
      setError(errText(e))
    }
  }

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const patch: AccountPatch = {
        label: label.trim() || account.label,
        group: group.trim(),
        color,
        sourceFolder: folder.trim() || null,
        recursiveFolder: recursive === 'inherit' ? null : recursive === 'yes',
        defaults: {
          visibility: visibility === 'inherit' ? undefined : visibility,
          aiLabel: aiLabel === 'inherit' ? undefined : aiLabel === 'on',
          maxScheduleDays: horizon === 'inherit' ? undefined : Number(horizon),
          bulkEvery: bulkEvery.trim() || undefined,
          bulkJitter: bulkJitter.trim() || undefined,
          bulkWindow: bulkWindow.trim() || undefined
        }
      }
      onSaved(await window.api.accounts.update({ id: account.id, patch }))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Account Settings"
      subtitle={account.handle ? `@${account.handle}` : undefined}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !label.trim()}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="acc-label">
          Account name
        </label>
        <input id="acc-label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="acc-group">
          Group / tag
        </label>
        <input
          id="acc-group"
          type="text"
          value={group}
          placeholder="Clients, Personal…"
          onChange={(e) => setGroup(e.target.value)}
        />
      </div>

      <div className="field">
        <span className="field-label">Color accent</span>
        <div className="color-swatches">
          <button
            type="button"
            className={`color-swatch none${color === null ? ' active' : ''}`}
            aria-pressed={color === null}
            title="None"
            aria-label="No color"
            onClick={() => setColor(null)}
          />
          {COLORS.map((name) => (
            <button
              key={name}
              type="button"
              className={`color-swatch ${name}${color === name ? ' active' : ''}`}
              aria-pressed={color === name}
              title={name}
              aria-label={name}
              onClick={() => setColor(name)}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="acc-folder">
          Linked source folder
        </label>
        <div className="field-row">
          <input
            id="acc-folder"
            type="text"
            value={folder}
            readOnly
            placeholder="No folder linked"
            title={folder || undefined}
          />
          <button type="button" className="btn" onClick={() => void browse()}>
            Browse
          </button>
          <button type="button" className="btn ghost" disabled={!folder} onClick={() => setFolder('')}>
            Clear
          </button>
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="acc-recursive">
          Include subfolders
        </label>
        <select
          id="acc-recursive"
          value={recursive}
          onChange={(e) => setRecursive(e.target.value as RecursiveChoice)}
        >
          <option value="inherit">Inherit global</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="acc-visibility">
          Default visibility
        </label>
        <select
          id="acc-visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as 'inherit' | Visibility)}
        >
          <option value="inherit">Inherit</option>
          {VISIBILITIES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="acc-ai">
          Default AI label
        </label>
        <select id="acc-ai" value={aiLabel} onChange={(e) => setAiLabel(e.target.value as AiChoice)}>
          <option value="inherit">Inherit</option>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="acc-horizon">
          Schedule horizon
        </label>
        <select
          id="acc-horizon"
          value={horizon}
          onChange={(e) => setHorizon(e.target.value as HorizonChoice)}
        >
          <option value="inherit">Inherit</option>
          <option value="10">10 days</option>
          <option value="30">30 days (TikTok Studio)</option>
        </select>
      </div>

      <div className="field">
        <span className="field-label">Default bulk schedule</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div className="field">
            <label className="field-label" htmlFor="acc-bulk-every">
              Default every
            </label>
            <input
              id="acc-bulk-every"
              type="text"
              value={bulkEvery}
              placeholder="e.g. 12h, 1d"
              onChange={(e) => setBulkEvery(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="acc-bulk-jitter">
              Default jitter
            </label>
            <input
              id="acc-bulk-jitter"
              type="text"
              value={bulkJitter}
              placeholder="e.g. 15m"
              onChange={(e) => setBulkJitter(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="acc-bulk-window">
              Default quiet window
            </label>
            <input
              id="acc-bulk-window"
              type="text"
              value={bulkWindow}
              placeholder="e.g. 09:00-21:00"
              onChange={(e) => setBulkWindow(e.target.value)}
            />
          </div>
        </div>
      </div>

      {error ? <div className="alert error">{error}</div> : null}
    </Modal>
  )
}
