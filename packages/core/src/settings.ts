import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { dataDir, settingsPath } from './paths'
import type { Settings } from './types'

export const DEFAULT_SETTINGS: Settings = {
  defaultAccount: 'main',
  headless: true,
  browserPath: '',
  maxScheduleDays: 10,
  visibility: 'everyone',
  aiLabel: true,
  theme: 'system'
}

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<Settings>
    return { ...DEFAULT_SETTINGS, ...stored }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const settings = { ...loadSettings(), ...patch }
  mkdirSync(dirname(settingsPath()), { recursive: true, mode: 0o700 })
  writeFileSync(settingsPath(), JSON.stringify(settings, null, 2) + '\n', 'utf8')
  return settings
}

export const ensureDataDir = (): string => {
  const dir = dataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}
