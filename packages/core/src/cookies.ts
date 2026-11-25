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
