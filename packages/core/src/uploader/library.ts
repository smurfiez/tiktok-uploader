/**
 * Read-only mirror of the account's TikTok Studio content page.
 *
 * The DOM changes constantly and TikTok's Studio API routes get renamed, so the
 * sync intercepts JSON responses for the item list, falls back to scraping the
 * rendered rows, and caches thumbnails as data URIs (the renderer keeps
 * `img-src 'self' data:`).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { Response } from 'playwright-core'

import { browserProfileDir, coversDir, libraryPath } from '../paths'
import { acquireLock, listAccounts, LockBusyError, releaseLock, updateAccount } from '../profiles'
import { PATHS, SELECTORS } from '../selectors'
import type { AccountLibrary, RemoteVideoStatus, TikTokVideo, Visibility } from '../types'
import { sleep } from '../utils'
import { assertSignedIn, AuthError, ensureAuthenticated } from './auth'
import { launchContext } from './browser'

export interface RawLibraryItem extends TikTokVideo {}

export interface SyncLibraryResult {
  ok: boolean
  library?: AccountLibrary
  locked?: boolean
  /** More videos exist on TikTok beyond what this sync fetched. */
  hasMore?: boolean
  message: string
}

export function loadLibrary(accountId: string): AccountLibrary | null {
  try {
    const parsed = JSON.parse(readFileSync(libraryPath(accountId), 'utf8')) as AccountLibrary
    return Array.isArray(parsed?.items) ? parsed : null
  } catch {
    return null
  }
}

/** Atomic: a crash mid-write leaves the previous library readable. */
export function saveLibrary(accountId: string, library: AccountLibrary): void {
  const file = libraryPath(accountId)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })

  const temporary = `${file}.tmp`
  writeFileSync(temporary, JSON.stringify(library, null, 2) + '\n', 'utf8')
  renameSync(temporary, file)
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asText = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value.trim() || undefined
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

const asNumber = (value: unknown): number | undefined => {
  const num = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof num === 'number' && Number.isFinite(num) ? num : undefined
}

const ITEM_KEYS = ['itemList', 'item_list', 'items', 'aweme_list', 'item_info_list', 'video_list', 'list']

function findItemArray(payload: unknown): unknown[] {
  if (!isRecord(payload)) return []
  for (const key of ITEM_KEYS) {
    if (Array.isArray(payload[key])) return payload[key] as unknown[]
  }
  if (isRecord(payload.data)) {
    for (const key of ITEM_KEYS) {
      if (Array.isArray(payload.data[key])) return payload.data[key] as unknown[]
    }
  }
  return []
}

const toIso = (raw: number | undefined): string | undefined => {
  if (!raw || raw <= 0) return undefined
  return new Date(raw < 1e12 ? raw * 1000 : raw).toISOString()
}

function toVisibility(value: unknown): Visibility | undefined {
  if (value === true) return 'private'
  if (value === false) return 'everyone'
  if (typeof value === 'number') {
    if (value === 2) return 'private'
    if (value === 1) return 'friends'
    if (value === 0) return 'everyone'
    return undefined
  }
  if (typeof value !== 'string') return undefined

  const text = value.trim().toUpperCase()
  if (text === 'PRIVATE' || text === 'SELF_ONLY' || text === '2') return 'private'
  if (text === 'FRIENDS' || text === 'MUTUAL_FOLLOW_FRIENDS' || text === '1') return 'friends'
  if (text === 'EVERYONE' || text === 'PUBLIC' || text === 'PUBLIC_TO_EVERYONE' || text === '0') {
    return 'everyone'
  }
  return undefined
}

/** Private beats friends beats everyone, so a stray `false` flag cannot hide a real setting. */
function readVisibility(entry: Json): Visibility | 'unknown' {
  const status = isRecord(entry.status) ? entry.status : undefined
  const found = [
    entry.privateItem,
    entry.is_private,
    entry.visibility,
    entry.privacy_level,
    status?.private_status
  ]
    .map(toVisibility)
    .filter((value): value is Visibility => value !== undefined)

  if (found.includes('private')) return 'private'
  if (found.includes('friends')) return 'friends'
  if (found.includes('everyone')) return 'everyone'
  return 'unknown'
}

function readStatus(
  entry: Json,
  scheduledAt?: string,
  visibility: Visibility | 'unknown' = 'unknown'
): RemoteVideoStatus {
  const status = entry.status
  const statusText = typeof status === 'string' ? status.toLowerCase() : undefined
  const statusType = typeof entry.status_type === 'string' ? entry.status_type.toLowerCase() : undefined
  const scheduled =
    entry.is_scheduled === true ||
    statusText === 'scheduled' ||
    statusType === 'scheduled' ||
    (Boolean(scheduledAt) && new Date(scheduledAt as string).getTime() > Date.now())

  if (scheduled) return 'scheduled'
  if (entry.is_draft === true || statusText === 'draft') return 'draft'
  if (visibility === 'private') return 'private'
  if (statusText === 'processing' || entry.is_processing === true) return 'processing'
  return 'published'
}

function readStats(entry: Json): Pick<TikTokVideo, 'views' | 'likes' | 'comments' | 'shares'> {
  const stats: Json = [entry.stats, entry.statistics, entry.metrics].find(isRecord) ?? entry
  const pick = (keys: string[]): number | undefined => {
    for (const key of keys) {
      const value = asNumber(stats[key])
      if (value !== undefined) return value
    }
    return undefined
  }

  const views = pick(['playCount', 'play_count', 'view_count', 'views'])
  const likes = pick(['diggCount', 'digg_count', 'like_count', 'likes'])
  const comments = pick(['commentCount', 'comment_count', 'comments'])
  const shares = pick(['shareCount', 'share_count', 'shares'])

  return {
    ...(views !== undefined ? { views } : {}),
    ...(likes !== undefined ? { likes } : {}),
    ...(comments !== undefined ? { comments } : {}),
    ...(shares !== undefined ? { shares } : {})
  }
}

function readHandle(entry: Json): string | undefined {
  const author = isRecord(entry.author) ? entry.author : undefined
  const creator = isRecord(entry.creator) ? entry.creator : undefined
  return (
    asText(author?.uniqueId) ??
    asText(author?.unique_id) ??
    asText(entry.uniqueId) ??
    asText(creator?.uniqueId)
  )
}

function parseEntry(entry: Json): RawLibraryItem | null {
  const id = String(entry.id ?? entry.item_id ?? entry.itemId ?? entry.aweme_id ?? '').trim()
  if (!id) return null

  const handle = readHandle(entry)

  const video = isRecord(entry.video) ? entry.video : undefined
  // Studio sends cover_url as a list of signed URLs
  const coverCandidates = [
    video?.cover,
    video?.originCover,
    video?.dynamicCover,
    entry.cover_url,
    entry.coverUrl,
    entry.cover,
    entry.thumbnail
  ]
  const coverUrl = coverCandidates
    .map((candidate) => (Array.isArray(candidate) ? candidate[0] : candidate))
    .map(asText)
    .find(Boolean)

  const createdAt = toIso(asNumber(entry.createTime ?? entry.create_time ?? entry.post_time))
  const scheduledAt = toIso(asNumber(entry.scheduleTime ?? entry.schedule_time))
  const visibility = readVisibility(entry)
  const status = readStatus(entry, scheduledAt, visibility)

  const rawDuration = asNumber(video?.duration) ?? asNumber(entry.duration) ?? 0
  const durationSec =
    rawDuration > 0
      ? Math.round(rawDuration > 10_000 ? rawDuration / 1000 : rawDuration)
      : undefined

  const shared = asText(entry.share_url) ?? asText(entry.url)
  const url =
    shared && shared.startsWith('https://www.tiktok.com/')
      ? shared
      : handle
        ? `https://www.tiktok.com/@${handle}/video/${id}`
        : PATHS.content

  return {
    id,
    caption: String(entry.desc ?? entry.title ?? entry.caption ?? '').trim(),
    url,
    status,
    visibility,
    ...(createdAt ? { createdAt } : {}),
    ...(scheduledAt ? { scheduledAt } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(coverUrl ? { coverUrl } : {}),
    ...readStats(entry)
  }
}

/** Normalizes any of TikTok's creator list payload shapes into flat items. */
export function parseCreatorApiPayload(payload: unknown): { handle?: string; items: RawLibraryItem[] } {
  const items: RawLibraryItem[] = []
  let handle: string | undefined

  for (const entry of findItemArray(payload)) {
    if (!isRecord(entry)) continue
    const parsed = parseEntry(entry)
    if (!parsed) continue
    handle ??= readHandle(entry)
    items.push(parsed)
  }

  return { ...(handle ? { handle } : {}), items }
}

const matchesLibraryApi = (url: string): boolean =>
  SELECTORS.library.apiUrlPatterns.some((pattern) => url.includes(pattern))

/** Akamai's block page renders as a "successful" navigation with zero rows. */
export const isBlockedPage = (title: string, body: string): boolean =>
  /access denied|you don't have permission to access/i.test(`${title} ${body}`)

export async function syncAccountLibrary(
  accountId: string,
  options: { browserPath?: string; source?: string; maxItems?: number } = {}
): Promise<SyncLibraryResult> {
  // Studio's first item_list page asks for size=50; keep it whole
  const maxItems = options.maxItems ?? 50

  try {
    acquireLock(accountId, options.source ?? 'library-sync')
  } catch (error) {
    if (error instanceof LockBusyError) {
      return { ok: false, locked: true, message: error.message }
    }
    throw error
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
    return { ok: false, message: (error as Error).message }
  }

  const { context, page, close } = launched
  const captured = new Map<string, RawLibraryItem>()
  /** API rows carry no author, so link them to the account's known handle. */
  const knownHandle = listAccounts().find((account) => account.id === accountId)?.handle
  let handle: string | undefined
  let nextCursor: number | undefined
  let hasMorePages = false
  let listRequest: { url: string; body: string } | undefined

  const ingest = (payload: unknown): void => {
    const parsed = parseCreatorApiPayload(payload)
    handle ??= parsed.handle

    const record = payload as Record<string, unknown> | null
    if (record && Array.isArray(record.item_list)) {
      if (typeof record.cursor === 'number') nextCursor = record.cursor
      hasMorePages = record.has_more === true
    }

    for (const item of parsed.items) {
      if (captured.has(item.id)) continue
      captured.set(
        item.id,
        item.url === PATHS.content && knownHandle
          ? { ...item, url: `https://www.tiktok.com/@${knownHandle}/video/${item.id}` }
          : item
      )
    }
  }

  const collect = async (response: Response): Promise<void> => {
    try {
      if (response.status() !== 200) return
      const url = response.url()
      if (!matchesLibraryApi(url)) return
      if (!(response.headers()['content-type'] ?? '').includes('json')) return

      ingest(await response.json())
    } catch {
      // a malformed or already-consumed response is not fatal
    }
  }

  try {
    await ensureAuthenticated({ context, page, accountId, report: () => {} })
    page.on('response', (response) => void collect(response))
    page.on('request', (request) => {
      if (request.method() === 'POST' && matchesLibraryApi(request.url())) {
        const body = request.postData()
        if (body) listRequest = { url: request.url(), body }
      }
    })

    await page.goto(PATHS.content, { waitUntil: 'domcontentloaded' })

    const pageText = await page
      .evaluate(() => ({ title: document.title, body: document.body?.innerText ?? '' }))
      .catch(() => null)
    if (pageText && isBlockedPage(pageText.title, pageText.body)) {
      // an Akamai block page has no rows, so without this the sync would
      // overwrite the cache with an empty library and report success
      return {
        ok: false,
        message:
          'TikTok refused the request (Access Denied) — this network is being rate-limited. Wait a few minutes, then sync again.'
      }
    }

    await assertSignedIn(page, 'TikTok Studio content')

    const startedAt = Date.now()
    const deadline = startedAt + 12_000
    let settleUntil: number | undefined
    while (Date.now() < deadline) {
      if (captured.size > 0) {
        // secondary item-list pages settle shortly after the first response
        settleUntil ??= Date.now() + 1_500
        if (Date.now() >= settleUntil) break
      } else if (
        Date.now() - startedAt >= 3_500 &&
        (await page.locator(SELECTORS.library.videoLink).count().catch(() => 0)) > 0
      ) {
        // only fall back to DOM once real video links are rendered AND the API had time to fire
        break
      }
      await sleep(500)
    }

    if (captured.size === 0) {
      const scraped = await page
        .evaluate(
          (sel: { row: string; videoLink: string; thumbnail: string }) => {
            const found: Array<{ id: string; caption: string; url: string; coverUrl?: string }> = []
            for (const row of Array.from(document.querySelectorAll(sel.row))) {
              const link = row.querySelector(sel.videoLink) as HTMLAnchorElement | null
              const image = row.querySelector(sel.thumbnail) as HTMLImageElement | null
              const href = link?.href ?? ''
              const match = href.match(/\/video\/(\d+)/)
              if (!match) continue
              // the caption anchor carries the post text; row text adds duration/stats
              const text = (link?.textContent ?? '').trim() || row.textContent || ''
              found.push({
                id: match[1],
                caption: text.replace(/\s+/g, ' ').trim().slice(0, 300),
                url: href,
                ...(image?.src ? { coverUrl: image.src } : {})
              })
            }
            return found
          },
          {
            row: SELECTORS.library.row,
            videoLink: SELECTORS.library.videoLink,
            thumbnail: SELECTORS.library.thumbnail
          }
        )
        .catch(() => [])

      for (const item of scraped) {
        if (!item.id || captured.has(item.id)) continue
        captured.set(item.id, {
          id: item.id,
          caption: item.caption,
          url: item.url,
          status: 'unknown',
          visibility: 'unknown',
          ...(item.coverUrl ? { coverUrl: item.coverUrl } : {})
        })
      }
    }

    // API rows carry no author; take the handle from the rendered post links
    const pageHandle = await page
      .evaluate(
        () =>
          (document.querySelector('a[href*="/@"]')?.getAttribute('href') ?? '').match(
            /\/@([^/?]+)/
          )?.[1]
      )
      .catch(() => undefined)
    handle ??= pageHandle ?? knownHandle
    if (handle) {
      for (const [id, item] of captured) {
        if (item.url === PATHS.content) {
          captured.set(id, { ...item, url: `https://www.tiktok.com/@${handle}/video/${id}` })
        }
      }
    }

    // "Load more": page the item_list endpoint until maxItems is reached
    let pages = 0
    while (hasMorePages && captured.size < maxItems && listRequest && pages < 10) {
      const body = JSON.parse(listRequest.body) as Record<string, unknown>
      body.cursor = nextCursor
      const response = await context.request.post(listRequest.url, { data: body }).catch(() => null)
      pages++
      if (!response?.ok()) break
      const before = captured.size
      ingest(await response.json().catch(() => null))
      if (captured.size === before) break
    }

    const selected = [...captured.values()].slice(0, maxItems)
    const items: TikTokVideo[] = selected

    // TikTok's CDN rejects requests without the browser session, so cache the
    // posters locally; the desktop serves them over tt-cover://
    const covers = coversDir(accountId)
    mkdirSync(covers, { recursive: true, mode: 0o700 })
    for (let index = 0; index < selected.length; index += 5) {
      await Promise.allSettled(
        selected.slice(index, index + 5).map(async (item) => {
          if (!item.coverUrl?.startsWith('https://')) return
          const response = await context.request.get(item.coverUrl, { timeout: 5_000 }).catch(() => null)
          if (!response?.ok()) return
          const body = await response.body()
          if (body.byteLength === 0 || body.byteLength > 260_000) return
          writeFileSync(join(covers, `${item.id}.jpg`), body)
        })
      )
    }

    const more = hasMorePages || captured.size > items.length
    const savedHandle = handle ?? knownHandle
    const library: AccountLibrary = {
      fetchedAt: new Date().toISOString(),
      ...(savedHandle ? { handle: savedHandle } : {}),
      hasMore: more,
      items
    }
    saveLibrary(accountId, library)

    updateAccount(accountId, {
      ...(savedHandle ? { handle: savedHandle } : {}),
      lastSignedIn: true,
      lastCheckedAt: new Date().toISOString()
    })

    return {
      ok: true,
      library,
      hasMore: more,
      message: `Synced ${items.length} video${items.length === 1 ? '' : 's'} from TikTok${more ? ' — more available' : ''}`
    }
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, message: error.message }
    return { ok: false, message: (error as Error).message }
  } finally {
    releaseLock(accountId)
    // closing a chromium context can hang; never keep the lock for it
    await Promise.race([close().catch(() => {}), sleep(5_000)])
  }
}
