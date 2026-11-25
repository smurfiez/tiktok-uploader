/**
 * Every renderer-facing IPC channel (PLAN §9). Core does the work; this module
 * only adapts dialogs, the signed-in cache, queue runs and power blocking.
 */

import { chmodSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { BrowserWindow, dialog, ipcMain, nativeTheme, powerSaveBlocker, shell } from 'electron'

import {
  addAccount,
  applyImportedCookies,
  assertSchedulable,
  buildStaggeredSchedule,
  cookiesPath,
  createAccount,
  exportCookies,
  inspectAccount,
  listAccounts,
  listVideos,
  loadLibrary,
  loadQueue,
  loadSettings,
  lockStatus,
  loginInteractive,
  parseCookieInput,
  removeAccount,
  runQueue,
  saveQueue,
  saveSettings,
  serializeNetscape,
  sessionIdOf,
  setAccountLabel,
  SUPPORTED_VIDEO_TYPES,
  syncAccountLibrary,
  updateAccount
} from '@tiktok-uploader/core'
import type {
  Account,
  AccountPatch,
  AccountSummary,
  Job,
  QueueEvent,
  Settings,
  StaggerRule
} from '@tiktok-uploader/core'

interface ActiveRun {
  stop: () => void
  blocker: number
}

interface QueuedAccountRun {
  contents: Electron.WebContents
  accountId: string
  headed?: boolean
}

const signedIn = new Map<string, boolean>()
const activeRuns = new Map<string, ActiveRun>()
const pendingBatch: QueuedAccountRun[] = []

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** User-facing messages say the label; the internal id never leaves this module. */
const accountLabel = (accountId: string): string =>
  listAccounts().find((account) => account.id === accountId)?.label ?? 'Account'

/** Studio accounts may allow a longer horizon than the global default. */
const accountMaxDays = (accountId?: string): number => {
  const fallback = loadSettings().maxScheduleDays
  if (!accountId) return fallback
  return (
    listAccounts().find((account) => account.id === accountId)?.defaults?.maxScheduleDays ??
    fallback
  )
}

/** Filename-safe form of a label, for the export dialog default. */
const slugOfLabel = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'account'

/** `accounts:list` must not launch a browser: counts come from the local queue file. */
const summarize = (account: Account): AccountSummary => {
  const lock = lockStatus(account.id)
  const jobs = loadQueue(account.id)
  const runnable = jobs.filter((job) => job.status === 'pending' || job.status === 'failed')
  let nextSchedule: string | null = null
  for (const job of runnable) {
    if (!job.schedule) continue
    if (nextSchedule === null || Date.parse(job.schedule) < Date.parse(nextSchedule)) {
      nextSchedule = job.schedule
    }
  }

  return {
    ...account,
    signedIn: signedIn.has(account.id)
      ? Boolean(signedIn.get(account.id))
      : Boolean(account.lastSignedIn),
    locked: lock !== null,
    lockSource: lock?.source,
    running: activeRuns.has(account.id),
    pendingCount: jobs.filter((job) => job.status === 'pending' || job.status === 'running').length,
    scheduledCount: runnable.filter((job) => Boolean(job.schedule)).length,
    failedCount: jobs.filter((job) => job.status === 'failed').length,
    doneCount: jobs.filter((job) => job.status === 'done' || job.status === 'skipped').length,
    nextSchedule
  }
}

const send = (
  contents: Electron.WebContents,
  accountId: string,
  event: QueueEvent
): void => {
  if (!contents.isDestroyed()) contents.send('queue:event', { ...event, accountId })
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

  /** Write imported cookies to the account profile, then verify them for real. */
  async function saveAndVerifyCookies(
    accountId: string,
    rawText: string
  ): Promise<{ ok: boolean; signedIn: boolean; count: number; message: string }> {
    const cookies = parseCookieInput(rawText)
    if (cookies.length === 0) {
      return {
        ok: false,
        signedIn: false,
        count: 0,
        message:
          'No valid cookies detected. Paste your sessionid from Chrome DevTools, or a JSON / Netscape export.'
      }
    }
    if (!sessionIdOf(cookies)) {
      return {
        ok: false,
        signedIn: false,
        count: cookies.length,
        message:
          'No "sessionid" cookie found. Make sure you are logged in to tiktok.com in Chrome before exporting.'
      }
    }

    // verify first: a rejected import must never clobber a working cookies.txt
    const status = await applyImportedCookies(accountId, cookies, {
      browserPath: loadSettings().browserPath,
      source: 'desktop'
    })

    if (status.signedIn) {
      const target = cookiesPath(accountId)
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      await writeFile(target, serializeNetscape(cookies), { encoding: 'utf8', mode: 0o600 })
      if (process.platform !== 'win32') chmodSync(target, 0o600)
      signedIn.set(accountId, true)
      updateAccount(accountId, { lastSignedIn: true, lastCheckedAt: new Date().toISOString() })
    } else if (!status.restored && !status.locked) {
      signedIn.set(accountId, false)
      updateAccount(accountId, { lastSignedIn: false, lastCheckedAt: new Date().toISOString() })
    }

    return {
      ok: status.signedIn,
      signedIn: status.signedIn,
      count: cookies.length,
      message: status.message
    }
  }

  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', (_event, patch: Partial<Settings>) => {
    const next = saveSettings(patch)
    if (patch.theme) {
      nativeTheme.themeSource = next.theme ?? 'system'
      const win = getWindow()
      if (win && !win.isDestroyed()) {
        const dark =
          next.theme === 'dark' || (next.theme !== 'light' && nativeTheme.shouldUseDarkColors)
        win.setBackgroundColor(dark ? '#0f1014' : '#f5f6f8')
      }
    }
    return next
  })

  ipcMain.handle('accounts:list', () => listAccounts().map(summarize))

  ipcMain.handle('accounts:add', (_event, input: { id?: string; label: string }) => {
    const account = input.id?.trim()
      ? addAccount(input.id.trim(), input.label)
      : createAccount(input.label)
    signedIn.set(account.id, signedIn.get(account.id) ?? false)
    return summarize(account)
  })

  ipcMain.handle('accounts:label', (_event, input: { id: string; label: string }) =>
    summarize(setAccountLabel(input.id, input.label))
  )

  ipcMain.handle('accounts:update', (_event, input: { id: string; patch: AccountPatch }) =>
    summarize(updateAccount(input.id, input.patch))
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
    if (!status.locked) {
      updateAccount(accountId, {
        lastSignedIn: status.signedIn,
        lastCheckedAt: new Date().toISOString()
      })
    }
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
      updateAccount(accountId, { lastSignedIn: true, lastCheckedAt: new Date().toISOString() })
      return { ok: true, message: 'Signed in' }
    } catch (error) {
      signedIn.set(accountId, false)
      updateAccount(accountId, { lastSignedIn: false, lastCheckedAt: new Date().toISOString() })
      return { ok: false, message: errorMessage(error) }
    }
  })

  ipcMain.handle('auth:import-cookies', async (_event, accountId: string) => {
    try {
      const picked = await showOpen({
        title: 'Import Chrome cookies (.txt or .json)',
        properties: ['openFile'],
        filters: [{ name: 'Cookie files', extensions: ['txt', 'json'] }]
      })
      const file = picked.filePaths[0]
      if (picked.canceled || !file) return { ok: false, canceled: true, message: 'Cancelled' }
      return await saveAndVerifyCookies(accountId, await readFile(file, 'utf8'))
    } catch (error) {
      return { ok: false, message: `Cookie import failed: ${errorMessage(error)}` }
    }
  })

  ipcMain.handle(
    'auth:import-cookies-text',
    async (_event, input: { accountId: string; text: string }) => {
      try {
        return await saveAndVerifyCookies(input.accountId, input.text)
      } catch (error) {
        return { ok: false, message: `Cookie import failed: ${errorMessage(error)}` }
      }
    }
  )

  ipcMain.handle('auth:export-cookies', async (_event, accountId: string) => {
    try {
      const cookies = await exportCookies(accountId, loadSettings().browserPath)
      if (cookies.length === 0) return { ok: false }

      const saved = await showSave({
        title: 'Export cookies.txt',
        defaultPath: `cookies-${slugOfLabel(accountLabel(accountId))}.txt`,
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

  ipcMain.handle(
    'videos:list',
    (_event, directory: string, options?: { recursive?: boolean }) =>
      listVideos(directory, options)
  )

  ipcMain.handle(
    'schedule:stagger',
    (_event, input: { count: number; rule: StaggerRule; accountId?: string }) => {
      const now = new Date()
      const dates = buildStaggeredSchedule({ ...input.rule, count: input.count }, now)
      assertSchedulable(dates, now, accountMaxDays(input.accountId))
      return dates.map((date) => date.toISOString())
    }
  )

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

  /**
   * Shared run start: persist first, then run headless in the background and
   * clean up on settling. `queue:start` and `queue:start-all` both use it.
   */
  function startRun(
    contents: Electron.WebContents,
    accountId: string,
    jobs: Job[],
    headed?: boolean
  ): { started: boolean; error?: string } {
    if (activeRuns.has(accountId)) {
      return { started: false, error: `A run is already active for "${accountLabel(accountId)}"` }
    }

    const lock = lockStatus(accountId)
    if (lock) {
      const text = `Account "${accountLabel(accountId)}" is locked by ${lock.source} (pid ${lock.pid})`
      send(contents, accountId, { type: 'log', message: text })
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
    activeRuns.set(accountId, {
      stop: () => {
        shouldStop = true
      },
      blocker
    })

    void runQueue({
      accountId,
      jobs,
      headed,
      browserPath: settings.browserPath,
      maxScheduleDays: accountMaxDays(accountId),
      shouldStop: () => shouldStop,
      onEvent: (queueEvent) => send(contents, accountId, queueEvent)
    })
      .then((result) => {
        if (result.lockBusy) {
          send(contents, accountId, {
            type: 'log',
            message: `Account "${accountLabel(accountId)}" is locked by another process`
          })
        }
      })
      .catch((error) => {
        send(contents, accountId, { type: 'log', message: `Queue failed: ${errorMessage(error)}` })
        send(contents, accountId, { type: 'queue-done', done: 0, failed: 0, skipped: 0 })
      })
      .finally(() => {
        activeRuns.delete(accountId)
        if (powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker)
        drainPendingBatch()
      })

    return { started: true }
  }

  /** Start queued accounts as parallel slots free up. */
  function drainPendingBatch(): void {
    const cap = loadSettings().maxConcurrentAccounts ?? 2
    while (activeRuns.size < cap && pendingBatch.length > 0) {
      const next = pendingBatch.shift()
      if (!next || next.contents.isDestroyed()) continue
      if (activeRuns.has(next.accountId) || lockStatus(next.accountId) !== null) continue
      const jobs = loadQueue(next.accountId)
      if (!jobs.some(isRunnable)) continue
      startRun(next.contents, next.accountId, jobs, next.headed)
    }
  }

  const isRunnable = (job: Job): boolean => job.status === 'pending' || job.status === 'failed'

  ipcMain.handle('queue:append', (_event, input: { accountId: string; jobs: Job[] }) => {
    const existing = loadQueue(input.accountId)
    const known = new Set(existing.map((job) => job.videoPath))
    const added = input.jobs.filter((job) => {
      if (known.has(job.videoPath)) return false
      known.add(job.videoPath)
      return true
    })
    if (added.length > 0) saveQueue(input.accountId, [...existing, ...added])
    return { added: added.length, total: existing.length + added.length }
  })

  ipcMain.handle(
    'queue:start',
    (event, input: { accountId: string; jobs: Job[]; headed?: boolean }) =>
      startRun(event.sender, input.accountId, input.jobs, input.headed)
  )

  ipcMain.handle(
    'queue:start-all',
    (event, input: { accountIds: string[]; headed?: boolean }) => {
      const cap = loadSettings().maxConcurrentAccounts ?? 2
      const started: string[] = []
      const queued: string[] = []
      const skipped: string[] = []

      for (const accountId of input.accountIds) {
        const jobs = loadQueue(accountId)
        if (
          activeRuns.has(accountId) ||
          pendingBatch.some((item) => item.accountId === accountId) ||
          lockStatus(accountId) !== null ||
          !jobs.some(isRunnable)
        ) {
          skipped.push(accountId)
          continue
        }
        if (activeRuns.size < cap) {
          if (startRun(event.sender, accountId, jobs, input.headed).started) started.push(accountId)
          else skipped.push(accountId)
        } else {
          pendingBatch.push({ contents: event.sender, accountId, headed: input.headed })
          queued.push(accountId)
        }
      }

      return { started, queued, skipped }
    }
  )

  ipcMain.handle('queue:stop', (_event, accountId: string) => {
    const index = pendingBatch.findIndex((item) => item.accountId === accountId)
    if (index >= 0) pendingBatch.splice(index, 1)
    const run = activeRuns.get(accountId)
    run?.stop()
    return { stopped: Boolean(run) }
  })

  ipcMain.handle('library:load', (_event, accountId: string) => loadLibrary(accountId))

  ipcMain.handle('library:sync', async (_event, accountId: string) => {
    const result = await syncAccountLibrary(accountId, {
      browserPath: loadSettings().browserPath,
      source: 'desktop'
    })
    if (result.ok) {
      signedIn.set(accountId, true)
    } else if (!result.locked && /login|expired|signed in/i.test(result.message)) {
      signedIn.set(accountId, false)
      updateAccount(accountId, { lastSignedIn: false, lastCheckedAt: new Date().toISOString() })
    }
    return result
  })

  ipcMain.handle('shell:open-external', async (_event, rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl)
      if (
        parsed.protocol === 'https:' &&
        (parsed.hostname === 'tiktok.com' || parsed.hostname.endsWith('.tiktok.com'))
      ) {
        await shell.openExternal(parsed.toString())
        return { ok: true }
      }
      return { ok: false }
    } catch {
      return { ok: false }
    }
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
  pendingBatch.length = 0
}
