/**
 * Prototype: drive Electron's own Chromium over CDP instead of launching the
 * user's Chrome. Enabled with TIKTOK_UPLOADER_ELECTRON=1 (or `electron: true`).
 *
 * Everything above this file (`upload.ts`, `auth.ts`, `library.ts`) is
 * unchanged: Playwright is now a CDP client rather than a launcher.
 *
 * shortcut: the UA is spoofed in the Electron main, but client hints
 * (navigator.userAgentData) still lack the "Google Chrome" brand, so TikTok can
 * tell this is not stock Chrome; revisit if the upload page misbehaves.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import { sleep } from '../utils'
import type { LaunchedContext, LaunchContextOptions } from './browser'

const START_TIMEOUT_MS = 20_000

/**
 * A throwaway Electron app: one hidden window, stock-Chrome UA. Written at
 * runtime so the build has no extra asset to copy.
 */
export const ELECTRON_MAIN_SCRIPT = `
const { app, BrowserWindow } = require('electron')

app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled')
app.userAgentFallback = app.userAgentFallback
  .replace(/ Electron\\/[\\d.]+/i, '')
  .replace(/\\s+/g, ' ')

app.whenReady().then(() => {
  if (process.env.TIKTOK_UPLOADER_ELECTRON_HEADED !== '1' && app.dock) app.dock.hide()

  const win = new BrowserWindow({
    show: process.env.TIKTOK_UPLOADER_ELECTRON_HEADED === '1',
    width: 1280,
    height: 720,
    webPreferences: { backgroundThrottling: false }
  })
  win.loadURL('about:blank')
})

app.on('window-all-closed', () => app.quit())
`

/** `require('electron')` is the binary path in Node, the API in a main process. */
function electronBinary(): string {
  const explicit = process.env.ELECTRON_PATH?.trim()
  if (explicit) return explicit

  try {
    const resolved: unknown = require('electron')
    if (typeof resolved === 'string' && resolved) return resolved
  } catch {
    // fall through to the error below
  }

  throw new Error(
    'Electron not found: install it or point ELECTRON_PATH at the Electron binary'
  )
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => (port ? resolve(port) : reject(new Error('could not reserve a port'))))
    })
  })
}

async function waitForDevTools(port: number, child: ChildProcess, stderr: () => string): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Electron exited with code ${child.exitCode}: ${stderr().trim()}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return
    } catch {
      // not listening yet
    }
    await sleep(300)
  }

  throw new Error(`Electron did not open its DevTools port within ${START_TIMEOUT_MS}ms`)
}

export async function launchElectronContext(
  options: LaunchContextOptions
): Promise<LaunchedContext> {
  const binary = electronBinary()
  const script = join(tmpdir(), 'tiktok-uploader-electron-main.cjs')
  writeFileSync(script, ELECTRON_MAIN_SCRIPT, 'utf8')

  const port = await freePort()
  const child = spawn(
    binary,
    [
      `--user-data-dir=${options.userDataDir}`,
      `--remote-debugging-port=${port}`,
      '--no-first-run',
      '--no-default-browser-check',
      script
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        TIKTOK_UPLOADER_ELECTRON_HEADED: options.headless ? '0' : '1'
      }
    }
  )

  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    // Electron chatter is only useful for the startup failure message
    if (stderr.length < 8_000) stderr += chunk.toString()
  })

  const kill = (): void => {
    if (child.exitCode === null && !child.killed) child.kill()
  }

  try {
    await waitForDevTools(port, child, () => stderr)

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    if (!context) throw new Error('Electron opened no browser context')

    const page = context.pages()[0] ?? (await context.newPage())

    return {
      context,
      page,
      close: async () => {
        await browser.close().catch(() => {})
        kill()
      }
    }
  } catch (error) {
    kill()
    throw error
  }
}
