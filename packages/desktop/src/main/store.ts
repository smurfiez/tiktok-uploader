/**
 * Settings persisted by core, with the caption API key encrypted through
 * Electron's safeStorage. The renderer only ever sees `hasApiKey`.
 */

import { safeStorage } from 'electron'

import { loadSettings, saveSettings } from '@tiktok-uploader/core'
import type { Settings } from '@tiktok-uploader/core'

import type { SettingsView } from '../preload/index.d'

const envApiKey = (): string => process.env.MODEL_ACCESS_KEY?.trim() ?? ''

/** Only the ciphertext is stored, so the view replaces it with a flag. */
export function toSettingsView(settings: Settings): SettingsView {
  return {
    ...settings,
    captionApiKeyEncrypted: '',
    hasApiKey: settings.captionApiKeyEncrypted !== '' || envApiKey() !== ''
  }
}

function decrypt(stored: string): string {
  if (!stored) return ''
  try {
    if (!safeStorage.isEncryptionAvailable()) return ''
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return ''
  }
}

export function loadSettingsView(): SettingsView {
  return toSettingsView(loadSettings())
}

/** A plain key is encrypted here; `captionApiKeyEncrypted` from the renderer is ignored. */
export function updateSettings(
  patch: Partial<Settings> & { captionApiKey?: string }
): SettingsView {
  const { captionApiKey, ...rest } = patch
  delete rest.captionApiKeyEncrypted

  if (typeof captionApiKey === 'string') {
    const key = captionApiKey.trim()
    if (!key) {
      rest.captionApiKeyEncrypted = ''
    } else if (safeStorage.isEncryptionAvailable()) {
      rest.captionApiKeyEncrypted = safeStorage.encryptString(key).toString('base64')
    } else {
      throw new Error('This system cannot store the API key securely (safeStorage is unavailable)')
    }
  }

  return toSettingsView(saveSettings(rest))
}

/** MODEL_ACCESS_KEY wins, so cron and CLI runs behave the same as the app. */
export function decryptedApiKey(): string {
  return envApiKey() || decrypt(loadSettings().captionApiKeyEncrypted)
}
