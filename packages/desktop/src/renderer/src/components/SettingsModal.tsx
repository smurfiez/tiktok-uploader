import { useState } from 'react'
import type { Settings, ThemeMode, Visibility } from '@tiktok-uploader/core'
import { VISIBILITIES, errText } from '../utils'
import { MonitorIcon, MoonIcon, SunIcon } from './Icons'
import { Modal } from './Modal'
import { ToggleSwitch } from './ToggleSwitch'

const THEMES: { value: ThemeMode; label: string; icon: typeof SunIcon }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon }
]

export interface SettingsModalProps {
  settings: Settings
  onClose: () => void
  onSaved: (next: Settings) => void
}

export function SettingsModal({ settings, onClose, onSaved }: SettingsModalProps) {
  const [theme, setTheme] = useState<ThemeMode>(settings.theme ?? 'system')
  const [headless, setHeadless] = useState(settings.headless)
  const [browserPath, setBrowserPath] = useState(settings.browserPath)
  const [maxDays, setMaxDays] = useState(settings.maxScheduleDays)
  const [visibility, setVisibility] = useState<Visibility>(settings.visibility)
  const [aiLabel, setAiLabel] = useState(settings.aiLabel)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const patch: Partial<Settings> = {
        theme,
        headless,
        browserPath: browserPath.trim(),
        maxScheduleDays: maxDays,
        visibility,
        aiLabel
      }
      onSaved(await window.api.settings.set(patch))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="field">
        <span className="field-label">Appearance</span>
        <div className="segmented" role="group" aria-label="Theme">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              className={theme === value ? 'active' : undefined}
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Run headless</span>
        <ToggleSwitch checked={headless} onChange={setHeadless} label="Run headless" />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="set-browser">
          Browser path
        </label>
        <input
          id="set-browser"
          type="text"
          value={browserPath}
          placeholder="Auto-detect Chrome / Edge / Brave"
          onChange={(e) => setBrowserPath(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="set-days">
          Schedule horizon
        </label>
        <select id="set-days" value={maxDays} onChange={(e) => setMaxDays(Number(e.target.value))}>
          <option value={10}>10 days</option>
          <option value={30}>30 days</option>
        </select>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="set-visibility">
          Default visibility
        </label>
        <select
          id="set-visibility"
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
        >
          {VISIBILITIES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="field-label">Default AI label</span>
        <ToggleSwitch checked={aiLabel} onChange={setAiLabel} label="Default AI label" />
      </div>

      {error ? <div className="alert error">{error}</div> : null}
    </Modal>
  )
}
