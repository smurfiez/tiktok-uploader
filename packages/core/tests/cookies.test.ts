import { describe, expect, it } from 'vitest'

import {
  parseCookieHeader,
  parseCookieInput,
  parseJsonCookies,
  parseNetscape,
  serializeNetscape,
  sessionIdToCookies,
  sessionIdOf,
  toPlaywrightCookies
} from '../src/cookies'
import type { StoredCookie } from '../src/cookies'

const HEADER = '# Netscape HTTP Cookie File\n'

describe('parseNetscape', () => {
  it('parses plain and #HttpOnly_ rows', () => {
    const text =
      HEADER +
      '.tiktok.com\tTRUE\t/\tTRUE\t1767225600\tsessionid\tabc123\n' +
      '#HttpOnly_.tiktok.com\tTRUE\t/\tTRUE\t1767225600\tttwid\tdef456\n'

    const cookies = parseNetscape(text)

    expect(cookies).toHaveLength(2)
    expect(cookies[0]).toEqual({
      name: 'sessionid',
      value: 'abc123',
      domain: '.tiktok.com',
      path: '/',
      secure: true,
      expires: 1767225600
    })
    expect(cookies[0].httpOnly).toBeUndefined()
    expect(cookies[1].httpOnly).toBe(true)
    expect(cookies[1].domain).toBe('.tiktok.com')
    expect(cookies[1].name).toBe('ttwid')
  })

  it('skips comments and malformed rows with fewer than seven fields', () => {
    const text = [
      HEADER.trimEnd(),
      '# a comment\tshould\tbe\tignored\t0\tx\ty',
      '.tiktok.com\tTRUE\t/',
      '.tiktok.com\tTRUE\t/\tFALSE\t0\tok\tvalue'
    ].join('\n')

    expect(parseNetscape(text)).toEqual([
      { name: 'ok', value: 'value', domain: '.tiktok.com', path: '/' }
    ])
  })

  it('leaves secure unset when the flag is FALSE', () => {
    const [cookie] = parseNetscape('.tiktok.com\tFALSE\t/\tFALSE\t0\tn\tv\n')
    expect(cookie.secure).toBeUndefined()
  })

  it('omits zero, negative and non-numeric expiries', () => {
    const rows = [
      '.tiktok.com\tTRUE\t/\tFALSE\t0\ta\t1',
      '.tiktok.com\tTRUE\t/\tFALSE\t-5\tb\t2',
      '.tiktok.com\tTRUE\t/\tFALSE\tnope\tc\t3'
    ].join('\n')

    const cookies = parseNetscape(rows)
    expect(cookies.map((cookie) => cookie.expires)).toEqual([undefined, undefined, undefined])
  })

  it('drops rows with an empty name', () => {
    expect(parseNetscape('.tiktok.com\tTRUE\t/\tFALSE\t0\t\tvalue')).toEqual([])
  })
})

describe('serializeNetscape', () => {
  it('writes the header and the include-subdomain flag', () => {
    const text = serializeNetscape([
      { name: 'a', value: '1', domain: '.tiktok.com', path: '/' }
    ])

    expect(text.startsWith(HEADER)).toBe(true)
    expect(text.split('\n')[1]).toBe('.tiktok.com\tTRUE\t/\tFALSE\t0\ta\t1')
  })

  it('prefixes httpOnly rows and uses FALSE for bare domains', () => {
    const text = serializeNetscape([
      { name: 'b', value: '2', domain: 'tiktok.com', path: '/', httpOnly: true }
    ])

    expect(text.split('\n')[1]).toBe('#HttpOnly_tiktok.com\tFALSE\t/\tFALSE\t0\tb\t2')
  })

  it('round-trips through parseNetscape', () => {
    const cookies: StoredCookie[] = [
      {
        name: 'sessionid',
        value: 'abc',
        domain: '.tiktok.com',
        path: '/',
        secure: true,
        httpOnly: true,
        expires: 1767225600
      },
      { name: 'ttwid', value: 'def', domain: '.tiktok.com', path: '/en' }
    ]

    expect(parseNetscape(serializeNetscape(cookies))).toEqual(cookies)
  })

  it('skips cookies without a domain', () => {
    const text = serializeNetscape([{ name: 'n', value: 'v' }])
    expect(text.trim()).toBe(HEADER.trim())
  })
})

describe('sessionIdOf', () => {
  it('finds the sessionid value', () => {
    const cookies = parseNetscape(
      '.tiktok.com\tTRUE\t/\tTRUE\t0\tsessionid\tsecret\n.tiktok.com\tTRUE\t/\tFALSE\t0\tx\ty'
    )
    expect(sessionIdOf(cookies)).toBe('secret')
  })

  it('returns null when it is absent', () => {
    expect(sessionIdOf([{ name: 'x', value: 'y' }])).toBeNull()
  })
})

describe('toPlaywrightCookies', () => {
  it('keeps a valid sameSite and drops an invalid one', () => {
    const result = toPlaywrightCookies([
      { name: 'a', value: '1', sameSite: 'Lax' },
      { name: 'b', value: '2', sameSite: 'Weird' as StoredCookie['sameSite'] }
    ])

    expect(result[0].sameSite).toBe('Lax')
    expect('sameSite' in result[1]).toBe(false)
    expect(result[0].name).toBe('a')
  })

  it('does not mutate the input cookies', () => {
    const cookies: StoredCookie[] = [
      { name: 'b', value: '2', sameSite: 'Nope' as StoredCookie['sameSite'] }
    ]
    toPlaywrightCookies(cookies)
    expect(cookies[0].sameSite).toBe('Nope')
  })
})

describe('sessionIdToCookies', () => {
  it('builds sessionid and sessionid_ss cookies for tiktok.com', () => {
    const cookies = sessionIdToCookies('abc')
    expect(cookies.map((cookie) => cookie.name)).toEqual(['sessionid', 'sessionid_ss'])
    expect(cookies.every((cookie) => cookie.domain === '.tiktok.com')).toBe(true)
    expect(cookies.every((cookie) => (cookie.expires ?? 0) > Math.floor(Date.now() / 1000))).toBe(
      true
    )
  })
})

describe('parseJsonCookies', () => {
  it('parses a Cookie-Editor export', () => {
    const text = JSON.stringify([
      {
        domain: '.tiktok.com',
        expirationDate: 1767225600.75,
        httpOnly: true,
        name: 'sessionid',
        path: '/',
        secure: true,
        sameSite: 'no_restriction',
        value: 'abc'
      },
      { domain: '.tiktok.com', name: 'ttwid', sameSite: 'lax', value: 'def' },
      { domain: 'tiktok.com', name: 'odd', sameSite: 'strict', value: 'ghi' },
      { domain: '.tiktok.com', name: 'plain', sameSite: 'unspecified', value: 'jkl' }
    ])

    const cookies = parseJsonCookies(text)

    expect(cookies).toEqual([
      {
        name: 'sessionid',
        value: 'abc',
        domain: '.tiktok.com',
        path: '/',
        secure: true,
        httpOnly: true,
        expires: 1767225600,
        sameSite: 'None'
      },
      { name: 'ttwid', value: 'def', domain: '.tiktok.com', path: '/', sameSite: 'Lax' },
      { name: 'odd', value: 'ghi', domain: 'tiktok.com', path: '/', sameSite: 'Strict' },
      { name: 'plain', value: 'jkl', domain: '.tiktok.com', path: '/' }
    ])
  })

  it('filters a mixed-domain export down to TikTok', () => {
    const text = JSON.stringify([
      { domain: '.google.com', name: 'SID', value: 'google' },
      { domain: '.tiktok.com', name: 'sessionid', value: 'tiktok' }
    ])

    expect(parseJsonCookies(text)).toEqual([
      { name: 'sessionid', value: 'tiktok', domain: '.tiktok.com', path: '/' }
    ])
  })

  it('returns an empty array for invalid or non-array JSON', () => {
    expect(parseJsonCookies('not json')).toEqual([])
    expect(parseJsonCookies('{"name":"sessionid"}')).toEqual([])
  })
})

describe('parseCookieHeader', () => {
  it('preserves = inside values and synthesizes sessionid_ss', () => {
    const cookies = parseCookieHeader('Cookie: a=1; sessionid=xyz123; token=a=b')

    expect(cookies.map((cookie) => cookie.name)).toEqual(['a', 'sessionid', 'token', 'sessionid_ss'])
    expect(cookies.find((cookie) => cookie.name === 'token')?.value).toBe('a=b')
    expect(cookies.find((cookie) => cookie.name === 'sessionid_ss')?.value).toBe('xyz123')
  })

  it('does not add sessionid_ss when it is already present', () => {
    const cookies = parseCookieHeader('sessionid=a; sessionid_ss=b')

    expect(cookies.map((cookie) => cookie.name)).toEqual(['sessionid', 'sessionid_ss'])
    expect(cookies[1].value).toBe('b')
  })
})

describe('parseCookieInput', () => {
  it('detects a JSON cookie array', () => {
    const text = JSON.stringify([{ domain: '.tiktok.com', name: 'sessionid', value: 'abc' }])
    expect(parseCookieInput(text)).toHaveLength(1)
  })

  it('detects a Netscape cookies.txt', () => {
    const text = HEADER + '.tiktok.com\tTRUE\t/\tTRUE\t0\tsessionid\tabc\n'
    expect(parseCookieInput(text)).toEqual([
      { name: 'sessionid', value: 'abc', domain: '.tiktok.com', path: '/', secure: true }
    ])
  })

  it('detects a Cookie header', () => {
    const cookies = parseCookieInput('Cookie: sessionid=abc12345')
    expect(cookies.map((cookie) => cookie.name)).toEqual(['sessionid', 'sessionid_ss'])
  })

  it('detects a bare sessionid token', () => {
    const cookies = parseCookieInput('0123456789abcdef')
    expect(cookies.map((cookie) => cookie.name)).toEqual(['sessionid', 'sessionid_ss'])
    expect(cookies[0].value).toBe('0123456789abcdef')
  })

  it('rejects empty and prose input', () => {
    expect(parseCookieInput('   ')).toEqual([])
    expect(parseCookieInput('hello world')).toEqual([])
  })
})
