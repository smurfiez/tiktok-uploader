/**
 * Launches the user's own Chromium through Playwright's persistent context, so
 * cookies, localStorage and device tokens survive between runs. No bundled
 * browser, no spoofed user agent: `playwright-core` reports nothing about
 * itself, and the UA/TLS fingerprint matches the real binary.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type BrowserContext, type Page } from 'playwright-core'

import { TIMING } from '../selectors'

export class BrowserNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BrowserNotFoundError'
  }
}

export interface LaunchContextOptions {
  userDataDir: string
  headless: boolean
  /** Explicit binary; falls back to CHROME_PATH, Brave, Chrome, Edge */
  browserPath?: string
}

export interface LaunchedContext {
  context: BrowserContext
  page: Page
  close: () => Promise<void>
}

function braveBinary(): string | undefined {
  const candidates =
    process.platform === 'darwin'
      ? ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser']
      : process.platform === 'win32'
        ? [
            join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')
          ]
        : ['/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave']

  return candidates.find((candidate) => existsSync(candidate))
}

export async function launchContext(options: LaunchContextOptions): Promise<LaunchedContext> {
  const explicit = process.env.CHROME_PATH?.trim() || options.browserPath?.trim()
  const brave = explicit ? undefined : braveBinary()

  const candidates: Array<{ executablePath?: string; channel?: 'chrome' | 'msedge' }> = []
  if (explicit) candidates.push({ executablePath: explicit })
  else {
    if (brave) candidates.push({ executablePath: brave })
    candidates.push({ channel: 'chrome' }, { channel: 'msedge' })
  }

  const errors: string[] = []
  for (const candidate of candidates) {
    try {
      const context = await chromium.launchPersistentContext(options.userDataDir, {
        headless: options.headless,
        viewport: { width: 1280, height: 720 },
        locale: 'en-US',
        args: ['--disable-blink-features=AutomationControlled'],
        ...candidate
      })

      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
      })

      const page = context.pages()[0] ?? (await context.newPage())
      page.setDefaultTimeout(TIMING.implicitWait)

      return { context, page, close: () => context.close() }
    } catch (error) {
      errors.push(`${candidate.executablePath ?? candidate.channel}: ${(error as Error).message}`)
    }
  }

  throw new BrowserNotFoundError(
    `Could not start a Chromium browser (${errors.join('; ')}). ` +
      'Install Chrome, Edge or Brave, or set CHROME_PATH to its binary'
  )
}
