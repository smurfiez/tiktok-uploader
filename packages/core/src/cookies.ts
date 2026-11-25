/**
 * Netscape cookies.txt reading and writing, ported from
 * src/tiktok_uploader/auth.py (get_cookies / save_cookies).
 */

export interface StoredCookie {
  name: string
  value: string
  domain?: string
  path?: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

const FIELDS = 7

/**
 * Parses a Netscape cookies file: domain, includeSubdomains, path, secure,
 * expiry, name, value, tab separated. `#HttpOnly_` prefixes mark HTTP-only rows.
 */
export function parseNetscape(text: string): StoredCookie[] {
  const cookies: StoredCookie[] = []

  for (const line of text.split(/\r?\n/)) {
    const fields = line.split('\t')
    if (fields.length < FIELDS) continue

    let domain = fields[0].trim()
    let httpOnly = false
    if (domain.startsWith('#HttpOnly_')) {
      httpOnly = true
      domain = domain.slice('#HttpOnly_'.length)
    } else if (domain.startsWith('#')) {
      // a comment, not a cookie
      continue
    }

    const cookie: StoredCookie = {
      name: fields[5].trim(),
      value: fields[6].trim(),
      domain,
      path: fields[2].trim()
    }
    if (httpOnly) cookie.httpOnly = true
    if (fields[3].trim().toUpperCase() === 'TRUE') cookie.secure = true

    const expiry = Number(fields[4].trim())
    if (Number.isFinite(expiry) && expiry > 0) cookie.expires = expiry

    if (cookie.name) cookies.push(cookie)
  }

  return cookies
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** Writes the Netscape header or nothing, matching what curl and the CLI expect. */
export function serializeNetscape(cookies: StoredCookie[]): string {
  const lines = ['# Netscape HTTP Cookie File']

  for (const cookie of cookies) {
    if (!cookie.domain) continue

    lines.push(
      [
        `${cookie.httpOnly ? '#HttpOnly_' : ''}${cookie.domain}`,
        cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE',
        cookie.path ?? '/',
        cookie.secure ? 'TRUE' : 'FALSE',
        cookie.expires ? String(cookie.expires) : '0',
        cookie.name,
        cookie.value
      ].join('\t')
    )
  }

  return lines.join('\n') + '\n'
}

export function sessionIdOf(cookies: StoredCookie[]): string | null {
  return cookies.find((cookie) => cookie.name === 'sessionid')?.value ?? null
}

/** Playwright only accepts a known `sameSite`, and calls expiry `expires`. */
export function toPlaywrightCookies(
  cookies: StoredCookie[]
): Array<Record<string, unknown>> {
  return cookies.map((cookie) => {
    const result: Record<string, unknown> = { ...cookie }
    if (!['Strict', 'Lax', 'None'].includes(String(result.sameSite))) {
      delete result.sameSite
    }
    return result
  })
}

/** A `sessionid=...` pasted from devtools is enough to sign in. */
export function sessionIdToCookies(sessionId: string): StoredCookie[] {
  const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  return [
    { name: 'sessionid', value: sessionId, domain: '.tiktok.com', path: '/', expires },
    { name: 'sessionid_ss', value: sessionId, domain: '.tiktok.com', path: '/', expires }
  ]
}

function normalizeSameSite(value: unknown): StoredCookie['sameSite'] | undefined {
  if (typeof value !== 'string') return undefined
  switch (value.trim().toLowerCase()) {
    case 'strict':
      return 'Strict'
    case 'lax':
      return 'Lax'
    case 'none':
    case 'no_restriction':
      return 'None'
    default:
      return undefined
  }
}

function isTikTokDomain(domain: string | undefined): boolean {
  if (!domain) return false
  const clean = domain.trim().toLowerCase().replace(/^\./, '')
  return clean === 'tiktok.com' || clean.endsWith('.tiktok.com')
}

/**
 * Parses JSON cookie arrays exported by Chrome extensions (Cookie-Editor,
 * EditThisCookie, Chrome DevTools / Playwright). Filters to tiktok.com if mixed.
 */
export function parseJsonCookies(text: string): StoredCookie[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const parsed: StoredCookie[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    if (!name) continue

    const value = typeof item.value === 'string' ? item.value : String(item.value ?? '')
    const domain =
      typeof item.domain === 'string' && item.domain.trim() ? item.domain.trim() : '.tiktok.com'
    const path =
      typeof item.path === 'string' && item.path.trim() ? item.path.trim() : '/'

    const cookie: StoredCookie = { name, value, domain, path }
    const rawExpiry = item.expires ?? item.expirationDate
    const expiry = Number(rawExpiry)
    if (Number.isFinite(expiry) && expiry > 0) cookie.expires = Math.floor(expiry)
    if (item.httpOnly) cookie.httpOnly = true
    if (item.secure) cookie.secure = true
    const sameSite = normalizeSameSite(item.sameSite)
    if (sameSite) cookie.sameSite = sameSite

    parsed.push(cookie)
  }

  const tiktokOnly = parsed.filter((cookie) => isTikTokDomain(cookie.domain))
  return tiktokOnly.length > 0 ? tiktokOnly : parsed
}

/**
 * Parses a raw `Cookie:` request header or `name=value; ...` string copied from
 * Chrome DevTools Network tab. Synthesizes `sessionid_ss` if only `sessionid` is present.
 */
export function parseCookieHeader(text: string): StoredCookie[] {
  const cleaned = text.trim().replace(/^cookie\s*:\s*/i, '')
  const expires = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  const cookies: StoredCookie[] = []

  for (const segment of cleaned.split(/[;\r\n]+/)) {
    const part = segment.trim()
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!name || /\s/.test(name)) continue
    cookies.push({ name, value, domain: '.tiktok.com', path: '/', secure: true, expires })
  }

  const sid = cookies.find((c) => c.name === 'sessionid' && c.value)?.value
  if (sid && !cookies.some((c) => c.name === 'sessionid_ss')) {
    cookies.push({
      name: 'sessionid_ss',
      value: sid,
      domain: '.tiktok.com',
      path: '/',
      secure: true,
      expires
    })
  }
  return cookies
}

/**
 * Auto-detects any supported Chrome cookie format:
 * 1. JSON cookie array (Cookie-Editor / EditThisCookie)
 * 2. Netscape cookies.txt (Get cookies.txt LOCALLY)
 * 3. Cookie header or `sessionid=...` pairs
 * 4. Bare `sessionid` token copied from Chrome DevTools -> Application -> Cookies
 */
export function parseCookieInput(text: string): StoredCookie[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) return parseJsonCookies(trimmed)

  const netscape = parseNetscape(trimmed)
  if (netscape.length > 0) return netscape

  if (trimmed.includes('=')) {
    const header = parseCookieHeader(trimmed)
    if (header.length > 0) return header
  }

  if (!/\s/.test(trimmed) && trimmed.length >= 8) {
    return sessionIdToCookies(trimmed)
  }

  return []
}
