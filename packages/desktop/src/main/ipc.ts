/**
 * Every renderer-facing IPC channel (PLAN §9). Core does the work; this module
 * only adapts dialogs, the signed-in cache, queue runs and power blocking.
 */

import { chmodSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { BrowserWindow, dialog, ipcMain, powerSaveBlocker, shell } from 'electron'

import {
  addAccount,
  assertSchedulable,
  autoCaption,
  buildStaggeredSchedule,
  cookiesPath,
  exportCookies,
  inspectAccount,
  listAccounts,
  listVideos,
  loadQueue,
  loadSettings,
  lockStatus,
  loginInteractive,
  parseNetscape,
  removeAccount,
  runQueue,
  saveQueue,
  serializeNetscape,
  setAccountLabel,
  SUPPORTED_VIDEO_TYPES
} from '@tiktok-uploader/core'
import type {
  Account,
  AccountSummary,
  Job,
  QueueEvent,
  StaggerRule
} from '@tiktok-uploader/core'

import { decryptedApiKey, loadSettingsView, updateSettings } from './store'

interface ActiveRun {
  stop: () => void
  blocker: number
}

const signedIn = new Map<string, boolean>()
const activeRuns = new Map<string, ActiveRun>()

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** `accounts:list` must not launch a browser, so status comes from this cache. */
const summarize = (account: Account): AccountSummary => {
  const lock = lockStatus(account.id)
  return {
    ...account,
    signedIn: signedIn.get(account.id) ?? false,
    locked: lock !== null,
    lockSource: lock?.source
  }
}

const send = (contents: Electron.WebContents, event: QueueEvent): void => {
  if (!contents.isDestroyed()) contents.send('queue:event', event)
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const showOpen = async (options: Electron.OpenDialogOptions) => {
    const window = getWindow()
    return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
  }

  const showSave = async (options: Electron.SaveDialogOptions) => {
    const window = getWindow()
    return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
  }

  ipcMain.handle('settings:get', () => loadSettingsView())
  ipcMain.handle(
    'settings:set',
    (_event, patch: Parameters<typeof updateSettings>[0]) => updateSettings(patch)
  )

  ipcMain.handle('accounts:list', () => listAccounts().map(summarize))

  ipcMain.handle('accounts:add', (_event, input: { id: string; label: string }) => {
    const account = addAccount(input.id, input.label)
    signedIn.set(account.id, signedIn.get(account.id) ?? false)
    return summarize(account)
  })

  ipcMain.handle('accounts:label', (_event, input: { id: string; label: string }) =>
    summarize(setAccountLabel(input.id, input.label))
  )

  ipcMain.handle('accounts:remove', (_event, accountId: string) => {
    try {
      removeAccount(accountId)
      signedIn.delete(accountId)
      return { ok: true }
    } catch (error) {
      console.error('accounts:remove failed', error)
      return { ok: false }
    }
  })

  ipcMain.handle('auth:status', async (_event, accountId: string) => {
    const status = await inspectAccount(accountId, {
      browserPath: loadSettings().browserPath,
      source: 'desktop'
    })
    signedIn.set(accountId, status.signedIn)
    return status
  })

  ipcMain.handle('auth:login', async (_event, accountId: string) => {
    try {
      // login is always headed: captcha, QR codes and 2FA need a human
      await loginInteractive({
        accountId,
        browserPath: loadSettings().browserPath,
        report: () => {}
      })
      signedIn.set(accountId, true)
      return { ok: true, message: 'Signed in' }
    } catch (error) {
      signedIn.set(accountId, false)
      return { ok: false, message: errorMessage(error) }
    }
  })

  ipcMain.handle('auth:import-cookies', async (_event, accountId: string) => {
    try {
      const picked = await showOpen({
        title: 'Import cookies.txt',
        properties: ['openFile'],
        filters: [{ name: 'Cookies', extensions: ['txt'] }]
      })
      const file = picked.filePaths[0]
      if (picked.canceled || !file) return { ok: false, message: 'Cancelled' }

      const cookies = parseNetscape(await readFile(file, 'utf8'))
      if (cookies.length === 0) return { ok: false, message: 'No cookies found in that file' }

      const target = cookiesPath(accountId)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, serializeNetscape(cookies), { encoding: 'utf8', mode: 0o600 })
      if (process.platform !== 'win32') chmodSync(target, 0o600)

      return { ok: true, message: `Imported ${cookies.length} cookies into "${accountId}"` }
    } catch (error) {
      return { ok: false, message: `Cookie import failed: ${errorMessage(error)}` }
    }
  })

  ipcMain.handle('auth:export-cookies', async (_event, accountId: string) => {
    try {
      const cookies = await exportCookies(accountId, loadSettings().browserPath)
      if (cookies.length === 0) return { ok: false }

      const saved = await showSave({
        title: 'Export cookies.txt',
        defaultPath: `cookies-${accountId}.txt`,
        filters: [{ name: 'Cookies', extensions: ['txt'] }]
      })
      if (saved.canceled || !saved.filePath) return { ok: false }

      await writeFile(saved.filePath, serializeNetscape(cookies), { encoding: 'utf8', mode: 0o600 })
      if (process.platform !== 'win32') chmodSync(saved.filePath, 0o600)

      return { ok: true, path: saved.filePath }
    } catch (error) {
      console.error('auth:export-cookies failed', error)
      return { ok: false }
    }
  })

  ipcMain.handle('videos:pick', async () => {
    const picked = await showOpen({
      title: 'Add videos',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Videos', extensions: [...SUPPORTED_VIDEO_TYPES] }]
    })
    return picked.canceled ? [] : picked.filePaths
  })

  ipcMain.handle('videos:pick-folder', async () => {
    const picked = await showOpen({ title: 'Add a folder', properties: ['openDirectory'] })
    return picked.canceled ? null : (picked.filePaths[0] ?? null)
  })

  ipcMain.handle('videos:list', (_event, directory: string) => listVideos(directory))

  ipcMain.handle('caption:suggest', (_event, videoPath: string) => {
    const settings = loadSettings()
    return autoCaption(videoPath, {
      endpoint: settings.captionEndpoint,
      model: settings.captionModel,
      apiKey: decryptedApiKey(),
      minHashtags: 3,
      maxHashtags: 6,
      maxLength: 2200,
      timeoutMs: 60_000
    })
  })

  ipcMain.handle('schedule:stagger', (_event, input: { count: number; rule: StaggerRule }) => {
    const now = new Date()
    const dates = buildStaggeredSchedule({ ...input.rule, count: input.count }, now)
    assertSchedulable(dates, now, loadSettings().maxScheduleDays)
    return dates.map((date) => date.toISOString())
  })

  ipcMain.handle('queue:load', (_event, accountId: string) => loadQueue(accountId))

  ipcMain.handle('queue:save', (_event, input: { accountId: string; jobs: Job[] }) => {
    try {
      saveQueue(input.accountId, input.jobs)
      return { ok: true }
    } catch (error) {
      console.error('queue:save failed', error)
      return { ok: false }
    }
  })

  ipcMain.handle(
    'queue:start',
    (event, input: { accountId: string; jobs: Job[]; headed?: boolean }) => {
      const { accountId, jobs, headed } = input

      if (activeRuns.has(accountId)) {
        return { started: false, error: `A run is already active for "${accountId}"` }
      }

      const lock = lockStatus(accountId)
      if (lock) {
        const text = `Account "${accountId}" is locked by ${lock.source} (pid ${lock.pid})`
        send(event.sender, { type: 'log', message: text })
        return { started: false, error: text }
      }

      // persist first so every transition runQueue makes lands on disk
      try {
        saveQueue(accountId, jobs)
      } catch (error) {
        return { started: false, error: `Could not save the queue: ${errorMessage(error)}` }
      }

      const settings = loadSettings()
      let shouldStop = false
      const blocker = powerSaveBlocker.start('prevent-app-suspension')
      activeRuns.set(accountId, { stop: () => { shouldStop = true }, blocker })

      void runQueue({
        accountId,
        jobs,
        headed,
        browserPath: settings.browserPath,
        maxScheduleDays: settings.maxScheduleDays,
        shouldStop: () => shouldStop,
        onEvent: (queueEvent) => send(event.sender, queueEvent)
      })
        .then((result) => {
          if (result.lockBusy) {
            send(event.sender, {
              type: 'log',
              message: `Account "${accountId}" is locked by another process`
            })
          }
        })
        .catch((error) => {
          send(event.sender, { type: 'log', message: `Queue failed: ${errorMessage(error)}` })
        })
        .finally(() => {
          activeRuns.delete(accountId)
          if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker)
        })

      return { started: true }
    }
  )

  ipcMain.handle('queue:stop', (_event, accountId: string) => {
    const run = activeRuns.get(accountId)
    run?.stop()
    return { stopped: Boolean(run) }
  })

  ipcMain.handle('shell:reveal', (_event, path: string) => {
    shell.showItemInFolder(path)
  })
}

/** Quit path: release every power blocker and ask in-flight runs to stop. */
export function dispose(): void {
  for (const run of activeRuns.values()) {
    run.stop()
    if (powerSaveBlocker.isStarted(run.blocker)) powerSaveBlocker.stop(run.blocker)
  }
  activeRuns.clear()
}
