import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * One data directory shared by the desktop app and the CLI, so a login in one
 * is a login in the other. TIKTOK_UPLOADER_HOME overrides it.
 */
export function dataDir(): string {
  const override = process.env.TIKTOK_UPLOADER_HOME?.trim()
  if (override) return override

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'tiktok-uploader')
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'tiktok-uploader')
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'tiktok-uploader')
}

export const settingsPath = (): string => join(dataDir(), 'settings.json')
export const accountsPath = (): string => join(dataDir(), 'accounts.json')

/** Account ids become directory names, so keep them to a safe alphabet. */
export function assertAccountId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`Invalid account id "${id}": use letters, digits, dot, dash or underscore`)
  }
  return id
}

export const accountDir = (id: string): string =>
  join(dataDir(), 'profiles', assertAccountId(id))

export const browserProfileDir = (id: string): string => join(accountDir(id), 'browser-profile')
export const cookiesPath = (id: string): string => join(accountDir(id), 'cookies.txt')
export const queuePath = (id: string): string => join(accountDir(id), 'queue.json')
export const libraryPath = (id: string): string => join(accountDir(id), 'library.json')
export const lockPath = (id: string): string => join(accountDir(id), 'account.lock')
export const failuresDir = (id: string): string => join(accountDir(id), 'failures')
