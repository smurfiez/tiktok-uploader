/**
 * Read-only mirror of the account's TikTok Studio content page.
 *
 * The DOM changes constantly and TikTok's Studio API routes get renamed, so the
 * sync intercepts JSON responses for the item list, falls back to scraping the
 * rendered rows, and caches thumbnails as data URIs (the renderer keeps
 * `img-src 'self' data:`).
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { Response } from 'playwright-core'

import { browserProfileDir, libraryPath } from '../paths'
import { acquireLock, LockBusyError, releaseLock, updateAccount } from '../profiles'
import { PATHS, SELECTORS } from '../selectors'
import type { AccountLibrary, RemoteVideoStatus, TikTokVideo, Visibility } from '../types'
import { sleep } from '../utils'
import { assertSignedIn, AuthError, ensureAuthenticated } from './auth'
import { launchContext } from './browser'

export interface RawLibraryItem extends Omit<TikTokVideo, 'thumbnailDataUrl'> {
  coverUrl?: string
}

export interface SyncLibraryResult {
  ok: boolean
  library?: AccountLibrary
  locked?: boolean
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

const ITEM_KEYS = ['itemList', 'items', 'aweme_list', 'item_info_list', 'video_list', 'list']

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
  const coverUrl =
    asText(video?.cover) ??
    asText(video?.originCover) ??
    asText(video?.dynamicCover) ??
    asText(entry.cover_url) ??
    asText(entry.coverUrl) ??
    asText(entry.cover) ??
    asText(entry.thumbnail)

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

const stripCover = ({ coverUrl: _cover, ...item }: RawLibraryItem): TikTokVideo => item

export async function syncAccountLibrary(
  accountId: string,
  options: { browserPath?: string; source?: string; maxItems?: number } = {}
): Promise<SyncLibraryResult> {
  const maxItems = options.maxItems ?? 40

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
  let handle: string | undefined

  const collect = async (response: Response): Promise<void> => {
    try {
      if (response.status() !== 200) return
      const url = response.url()
      if (!matchesLibraryApi(url)) return
      if (!(response.headers()['content-type'] ?? '').includes('json')) return

      const parsed = parseCreatorApiPayload(await response.json())
      handle ??= parsed.handle
      for (const item of parsed.items) {
        if (!captured.has(item.id)) captured.set(item.id, item)
      }
    } catch {
      // a malformed or already-consumed response is not fatal
    }
  }

  try {
    await ensureAuthenticated({ context, page, accountId, report: () => {} })
    page.on('response', (response) => void collect(response))

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
              found.push({
                id: match[1],
                caption: (row.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
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

    const selected = [...captured.values()].slice(0, maxItems)
    const items: TikTokVideo[] = []

    for (let index = 0; index < selected.length; index += 5) {
      const batch = selected.slice(index, index + 5)
      const settled = await Promise.allSettled(
        batch.map(async (item): Promise<TikTokVideo> => {
          const { coverUrl, ...rest } = item
          if (!coverUrl?.startsWith('https://')) return rest

          const response = await context.request.get(coverUrl, { timeout: 5_000 })
          if (!response.ok()) return rest

          const body = await response.body()
          // 260 KB keeps library.json small enough to load instantly
          if (body.byteLength === 0 || body.byteLength > 260_000) return rest

          const mime = (response.headers()['content-type'] ?? 'image/jpeg').split(';')[0]
          return { ...rest, thumbnailDataUrl: `data:${mime};base64,${body.toString('base64')}` }
        })
      )

      settled.forEach((result, position) => {
        items.push(result.status === 'fulfilled' ? result.value : stripCover(batch[position]))
      })
    }

    const library: AccountLibrary = {
      fetchedAt: new Date().toISOString(),
      ...(handle ? { handle } : {}),
      items
    }
    saveLibrary(accountId, library)

    updateAccount(accountId, {
      ...(handle ? { handle } : {}),
      lastSignedIn: true,
      lastCheckedAt: new Date().toISOString()
    })

    return {
      ok: true,
      library,
      message: `Synced ${items.length} video${items.length === 1 ? '' : 's'} from TikTok`
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
