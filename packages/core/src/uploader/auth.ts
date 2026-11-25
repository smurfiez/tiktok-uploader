/**
 * Session handling on top of a persistent browser profile.
 *
 * Primary auth: sign in once in a headed window, and the profile in
 * `profiles/<accountId>/browser-profile` keeps the session for headless runs.
 * Fallback: a legacy Netscape `cookies.txt` is injected into the profile once.
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import type { BrowserContext, Cookie, Page } from 'playwright-core'

import { parseNetscape, toPlaywrightCookies } from '../cookies'
import type { StoredCookie } from '../cookies'
import { browserProfileDir, cookiesPath } from '../paths'
import { acquireLock, LockBusyError, releaseLock } from '../profiles'
import { PATHS, SELECTORS } from '../selectors'
import type { AuthStatus } from '../types'
import { sleep } from '../utils'
import { launchContext } from './browser'

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

const LOGIN_TIMEOUT_MS = 10 * 60_000
/** Closing a chromium context can hang; never let that keep the lock. */
const CLOSE_TIMEOUT_MS = 5_000

const closeBrowser = async (close: () => Promise<void>): Promise<void> => {
  await Promise.race([close().catch(() => {}), sleep(CLOSE_TIMEOUT_MS)])
}

/** True once TikTok has stored a real session cookie in this profile. */
export async function checkSession(page: Page): Promise<boolean> {
  await page.goto(PATHS.main, { waitUntil: 'domcontentloaded' })
  const cookies = await page.context().cookies()
  return cookies.some((cookie) => cookie.name === 'sessionid' && cookie.value.length > 0)
}

/** Fails fast on a login redirect or a captcha overlay instead of a 60s selector timeout. */
export async function assertSignedIn(page: Page, where = 'this page'): Promise<void> {
  if (/\/login|\/signup/.test(page.url())) {
    throw new AuthError(`TikTok redirected ${where} to the login page; the session expired`)
  }

  const challenged = await page
    .evaluate(
      (selectors: string[]) =>
        selectors.some((selector) => document.querySelector(selector)) ||
        /verify to continue|securely verify/i.test(document.body?.innerText ?? ''),
      SELECTORS.challenge as unknown as string[]
    )
    .catch(() => false)

  if (challenged) {
    throw new AuthError(
      'Captcha challenge detected. Retry with --headed (or the Show browser toggle) and solve it once'
    )
  }
}

export interface EnsureAuthOptions {
  context: BrowserContext
  page: Page
  accountId: string
  report: (message: string) => void
}

export async function ensureAuthenticated(options: EnsureAuthOptions): Promise<void> {
  const { context, page, accountId, report } = options

  if (await checkSession(page)) {
    report('Signed in')
    return
  }

  const fallback = cookiesPath(accountId)
  if (existsSync(fallback)) {
    report('Injecting cookies.txt into the browser profile')
    const cookies = parseNetscape(await readFile(fallback, 'utf8'))
    if (cookies.length > 0) {
      await context.addCookies(toPlaywrightCookies(cookies) as unknown as Cookie[])
      if (await checkSession(page)) {
        report('Signed in with cookies.txt')
        return
      }
    }
  }

  throw new AuthError(
    `Account "${accountId}" is not signed in. Run: tiktok-up login --account ${accountId}`
  )
}

export interface LoginOptions {
  accountId: string
  browserPath?: string
  report: (message: string) => void
}

/**
 * Always headed: QR codes, 2FA and captchas need a human. The session lands in
 * the account's persistent profile, so later headless runs reuse it.
 */
export async function loginInteractive(options: LoginOptions): Promise<void> {
  const { accountId, browserPath, report } = options
  acquireLock(accountId, 'login')
  report('Opening a browser window: sign in to TikTok there')

  let launched: Awaited<ReturnType<typeof launchContext>>
  try {
    launched = await launchContext({
      userDataDir: browserProfileDir(accountId),
      headless: false,
      browserPath
    })
  } catch (error) {
    releaseLock(accountId)
    throw error
  }

  const { page, close } = launched
  try {
    await page.goto(PATHS.login, { waitUntil: 'domcontentloaded' })

    const deadline = Date.now() + LOGIN_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new AuthError('The login window was closed before signing in')

      const cookies = await page.context().cookies()
      if (cookies.some((cookie) => cookie.name === 'sessionid' && cookie.value)) {
        report('Signed in; the session is saved to this account')
        return
      }
      await sleep(1000)
    }

    throw new AuthError('Timed out waiting for the TikTok sign-in')
  } finally {
    releaseLock(accountId)
    await closeBrowser(close)
  }
}

export async function exportCookies(accountId: string, browserPath?: string): Promise<StoredCookie[]> {
  acquireLock(accountId, 'cookies-export')

  let launched: Awaited<ReturnType<typeof launchContext>>
  try {
    launched = await launchContext({
      userDataDir: browserProfileDir(accountId),
      headless: true,
      browserPath
    })
  } catch (error) {
    releaseLock(accountId)
    throw error
  }

  const { page, context, close } = launched
  try {
    await checkSession(page)
    return (await context.cookies()).map(toStoredCookie)
  } finally {
    releaseLock(accountId)
    await closeBrowser(close)
  }
}

/** One-shot session check for `auth status` and the desktop account chip. */
export async function inspectAccount(
  accountId: string,
  options: { browserPath?: string; source?: string } = {}
): Promise<AuthStatus> {
  try {
    acquireLock(accountId, options.source ?? 'auth-status')
  } catch (error) {
    return {
      signedIn: false,
      message: (error as Error).message,
      ...(error instanceof LockBusyError ? { locked: true } : {})
    }
  }

  let launched: Awaited<ReturnType<typeof launchContext>>
  try {
    launched = await launchContext({
      userDataDir: browserProfileDir(accountId),
      headless: true,
      browserPath: options.browserPath
    })
  } catch (error) {
    releaseLock(accountId)
    return { signedIn: false, message: (error as Error).message }
  }

  const { page, context, close } = launched
  try {
    let signedIn = await checkSession(page)
    if (!signedIn) {
      const fallback = cookiesPath(accountId)
      if (existsSync(fallback)) {
        const cookies = parseNetscape(await readFile(fallback, 'utf8'))
        if (cookies.length > 0) {
          await context.addCookies(toPlaywrightCookies(cookies) as unknown as Cookie[])
          signedIn = await checkSession(page)
        }
      }
    }
    return {
      signedIn,
      message: signedIn ? 'Signed in' : `Not signed in. Run: tiktok-up login --account ${accountId}`
    }
  } catch (error) {
    return { signedIn: false, message: (error as Error).message }
  } finally {
    releaseLock(accountId)
    await closeBrowser(close)
  }
}

/**
 * Replaces cookies in the account's persistent browser profile with imported cookies
 * and verifies immediately whether TikTok recognizes the session.
 */
export async function applyImportedCookies(
  accountId: string,
  cookies: StoredCookie[],
  options: { browserPath?: string; source?: string } = {}
): Promise<AuthStatus> {
  try {
    acquireLock(accountId, options.source ?? 'cookies-import')
  } catch (error) {
    return {
      signedIn: false,
      message: (error as Error).message,
      ...(error instanceof LockBusyError ? { locked: true } : {})
    }
  }

  let launched: Awaited<ReturnType<typeof launchContext>>
  try {
    launched = await launchContext({
      userDataDir: browserProfileDir(accountId),
      headless: true,
      browserPath: options.browserPath
    })
  } catch (error) {
    releaseLock(accountId)
    return { signedIn: false, message: (error as Error).message }
  }

  const { page, context, close } = launched
  try {
    const previous = await context.cookies()
    await context.clearCookies()
    await context.addCookies(toPlaywrightCookies(cookies) as unknown as Cookie[])
    const signedIn = await checkSession(page)
    let restored = false
    if (!signedIn && previous.length > 0) {
      try {
        await context.clearCookies()
        await context.addCookies(previous)
        restored = true
      } catch {
        restored = false
      }
    }
    return {
      signedIn,
      message: signedIn
        ? `Imported ${cookies.length} cookie(s) and verified sign-in`
        : `Imported ${cookies.length} cookie(s), but TikTok did not accept the session. Make sure you are signed in to tiktok.com in Chrome and copied a valid sessionid.${restored ? ' The previous session was kept.' : ''}`
    }
  } catch (error) {
    return { signedIn: false, message: (error as Error).message }
  } finally {
    releaseLock(accountId)
    await closeBrowser(close)
  }
}

export function toStoredCookie(cookie: Cookie): StoredCookie {
  const stored: StoredCookie = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path
  }
  if (cookie.expires && cookie.expires > 0) stored.expires = cookie.expires
  if (cookie.httpOnly) stored.httpOnly = true
  if (cookie.secure) stored.secure = true
  if (['Strict', 'Lax', 'None'].includes(cookie.sameSite)) {
    stored.sameSite = cookie.sameSite as StoredCookie['sameSite']
  }
  return stored
}

export { LockBusyError }
