import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PATHS } from '../src/selectors'
import type { AccountLibrary } from '../src/types'
import { loadLibrary, parseCreatorApiPayload, saveLibrary } from '../src/uploader/library'

const seconds = (date: Date): number => Math.floor(date.getTime() / 1000)
const inDays = (days: number): Date => new Date(Date.now() + days * 86_400_000)

describe('parseCreatorApiPayload', () => {
  it('reads a top-level itemList', () => {
    const parsed = parseCreatorApiPayload({
      itemList: [
        {
          id: '7311',
          desc: '  Hello world  ',
          author: { uniqueId: 'brand.main' },
          video: { cover: 'https://cdn.example/cover.jpg' }
        }
      ]
    })

    expect(parsed.handle).toBe('brand.main')
    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]).toMatchObject({
      id: '7311',
      caption: 'Hello world',
      coverUrl: 'https://cdn.example/cover.jpg',
      visibility: 'unknown',
      status: 'published',
      url: 'https://www.tiktok.com/@brand.main/video/7311'
    })
  })

  it('reads data.items and data.aweme_list nesting', () => {
    expect(parseCreatorApiPayload({ data: { items: [{ id: 'a' }] } }).items[0].id).toBe('a')
    expect(parseCreatorApiPayload({ data: { aweme_list: [{ aweme_id: 'b' }] } }).items[0].id).toBe('b')
    expect(
      parseCreatorApiPayload({ data: { item_info_list: [{ item_id: 'c' }] } }).items[0].id
    ).toBe('c')
  })

  it('falls back to an empty list when no array is present', () => {
    expect(parseCreatorApiPayload(null)).toEqual({ items: [] })
    expect(parseCreatorApiPayload({})).toEqual({ items: [] })
    expect(parseCreatorApiPayload({ data: { other: [] } })).toEqual({ items: [] })
  })

  it('skips entries without an id', () => {
    const parsed = parseCreatorApiPayload({ items: [{ desc: 'no id' }, { item_id: '7' }] })
    expect(parsed.items.map((item) => item.id)).toEqual(['7'])
  })

  it('treats a numeric id as text', () => {
    expect(parseCreatorApiPayload({ items: [{ id: 12345 }] }).items[0].id).toBe('12345')
  })

  it('converts unix seconds and keeps millisecond timestamps', () => {
    const created = new Date('2024-06-01T10:00:00.000Z')
    const fromSeconds = parseCreatorApiPayload({
      items: [{ id: 's', create_time: seconds(created) }]
    }).items[0]
    const fromMillis = parseCreatorApiPayload({
      items: [{ id: 'm', createTime: created.getTime() }]
    }).items[0]

    expect(fromSeconds.createdAt).toBe(created.toISOString())
    expect(fromMillis.createdAt).toBe(created.toISOString())
  })

  it('maps visibility values to private, friends, everyone and unknown', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ privateItem: true }, 'private'],
      [{ is_private: true }, 'private'],
      [{ visibility: 'SELF_ONLY' }, 'private'],
      [{ privacy_level: 2 }, 'private'],
      [{ status: { private_status: 2 } }, 'private'],
      [{ visibility: 'MUTUAL_FOLLOW_FRIENDS' }, 'friends'],
      [{ privacy_level: 1 }, 'friends'],
      [{ visibility: 'PUBLIC_TO_EVERYONE' }, 'everyone'],
      [{ privacy_level: 0 }, 'everyone'],
      [{ visibility: 'public' }, 'everyone'],
      [{}, 'unknown']
    ]

    for (const [extra, expected] of cases) {
      expect(parseCreatorApiPayload({ items: [{ id: 'x', ...extra }] }).items[0].visibility).toBe(
        expected
      )
    }
  })

  it('lets a real visibility setting win over a negative flag', () => {
    const item = parseCreatorApiPayload({
      items: [{ id: 'x', privateItem: false, visibility: 'friends' }]
    }).items[0]
    expect(item.visibility).toBe('friends')
  })

  it('derives scheduled, draft, private, processing and published statuses', () => {
    const statusOf = (entry: Record<string, unknown>): string =>
      parseCreatorApiPayload({ items: [{ id: 'x', ...entry }] }).items[0].status

    expect(statusOf({ schedule_time: seconds(inDays(2)) })).toBe('scheduled')
    expect(statusOf({ is_scheduled: true })).toBe('scheduled')
    expect(statusOf({ status: 'scheduled' })).toBe('scheduled')
    expect(statusOf({ is_draft: true })).toBe('draft')
    expect(statusOf({ status: 'draft' })).toBe('draft')
    expect(statusOf({ visibility: 'SELF_ONLY' })).toBe('private')
    expect(statusOf({ status: 'processing' })).toBe('processing')
    expect(statusOf({ is_processing: true })).toBe('processing')
    expect(statusOf({ desc: 'plain' })).toBe('published')
  })

  it('exposes the schedule timestamp', () => {
    const at = inDays(3)
    const item = parseCreatorApiPayload({
      items: [{ id: 'x', scheduleTime: at.getTime() }]
    }).items[0]

    expect(item.scheduledAt).toBe(at.toISOString())
    expect(item.status).toBe('scheduled')
  })

  it('reads stats from stats, statistics or the entry itself', () => {
    expect(
      parseCreatorApiPayload({
        items: [{ id: 'a', stats: { playCount: 10, diggCount: 5, commentCount: 2, shareCount: 1 } }]
      }).items[0]
    ).toMatchObject({ views: 10, likes: 5, comments: 2, shares: 1 })

    expect(
      parseCreatorApiPayload({
        items: [{ id: 'b', statistics: { play_count: 7, digg_count: 3, comment_count: 2, share_count: 1 } }]
      }).items[0]
    ).toMatchObject({ views: 7, likes: 3, comments: 2, shares: 1 })

    expect(
      parseCreatorApiPayload({
        items: [{ id: 'c', view_count: 9, like_count: 4, comments: 1, shares: 0 }]
      }).items[0]
    ).toMatchObject({ views: 9, likes: 4, comments: 1, shares: 0 })
  })

  it('rounds duration, treating values above 10 000 as milliseconds', () => {
    expect(parseCreatorApiPayload({ items: [{ id: 'a', video: { duration: 42 } }] }).items[0].durationSec).toBe(42)
    expect(parseCreatorApiPayload({ items: [{ id: 'b', duration: 42_600 }] }).items[0].durationSec).toBe(43)
    expect(parseCreatorApiPayload({ items: [{ id: 'c' }] }).items[0].durationSec).toBeUndefined()
  })

  it('prefers a TikTok share_url over the constructed url', () => {
    const item = parseCreatorApiPayload({
      items: [{ id: '1', share_url: 'https://www.tiktok.com/@a/video/1?is_from_webapp=1', author: { uniqueId: 'a' } }]
    }).items[0]
    expect(item.url).toBe('https://www.tiktok.com/@a/video/1?is_from_webapp=1')

    const foreign = parseCreatorApiPayload({
      items: [{ id: '2', share_url: 'https://evil.example/2', author: { uniqueId: 'a' } }]
    }).items[0]
    expect(foreign.url).toBe('https://www.tiktok.com/@a/video/2')
  })

  it('falls back to the studio content page when there is no handle', () => {
    expect(parseCreatorApiPayload({ items: [{ id: '1' }] }).items[0].url).toBe(PATHS.content)
  })
})

describe('library cache', () => {
  let home: string
  let previousHome: string | undefined

  beforeEach(() => {
    previousHome = process.env.TIKTOK_UPLOADER_HOME
    home = mkdtempSync(join(tmpdir(), 'tiktok-library-'))
    process.env.TIKTOK_UPLOADER_HOME = home
  })

  afterEach(() => {
    if (previousHome === undefined) delete process.env.TIKTOK_UPLOADER_HOME
    else process.env.TIKTOK_UPLOADER_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  })

  const library: AccountLibrary = {
    fetchedAt: '2026-01-01T00:00:00.000Z',
    handle: 'brand.main',
    items: [
      {
        id: '1',
        caption: 'First',
        url: 'https://www.tiktok.com/@brand.main/video/1',
        status: 'published',
        visibility: 'everyone',
        durationSec: 12,
        views: 300
      }
    ]
  }

  it('round-trips a library through the cache', () => {
    saveLibrary('main', library)
    expect(loadLibrary('main')).toEqual(library)
  })

  it('returns null when nothing has been synced yet', () => {
    expect(loadLibrary('main')).toBeNull()
  })

  it('returns null for a corrupt cache file', () => {
    saveLibrary('main', library)
    writeFileSync(join(home, 'profiles', 'main', 'library.json'), '{not json', 'utf8')
    expect(loadLibrary('main')).toBeNull()
  })
})
