import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { accountDir } from '../src/paths'
import { createJob, loadQueue, saveQueue } from '../src/queue'
import type { Settings } from '../src/types'

let home: string
let previousHome: string | undefined

const settings: Settings = {
  defaultAccount: 'main',
  headless: true,
  browserPath: '',
  maxScheduleDays: 10,
  visibility: 'friends',
  aiLabel: false
}

beforeEach(() => {
  previousHome = process.env.TIKTOK_UPLOADER_HOME
  home = mkdtempSync(join(tmpdir(), 'tiktok-queue-'))
  process.env.TIKTOK_UPLOADER_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.TIKTOK_UPLOADER_HOME
  else process.env.TIKTOK_UPLOADER_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

describe('loadQueue', () => {
  it('returns [] when the file is missing', () => {
    expect(loadQueue('main')).toEqual([])
  })
})

describe('saveQueue', () => {
  it('round-trips jobs through queue.json', () => {
    const jobs = [
      createJob({ videoPath: '/tmp/a.mp4', description: 'first' }, settings),
      createJob({ videoPath: '/tmp/b.mp4', schedule: '2026-12-01T18:00:00.000Z' }, settings)
    ]

    saveQueue('main', jobs)

    expect(loadQueue('main')).toEqual(jobs)
  })

  it('writes atomically and leaves no .tmp file behind', () => {
    saveQueue('main', [createJob({ videoPath: '/tmp/a.mp4' }, settings)])

    expect(readdirSync(accountDir('main'))).toEqual(['queue.json'])
  })

  it('overwrites an existing queue', () => {
    saveQueue('main', [createJob({ videoPath: '/tmp/a.mp4' }, settings)])
    saveQueue('main', [])

    expect(loadQueue('main')).toEqual([])
  })
})

describe('createJob', () => {
  it('applies defaults and starts pending', () => {
    const job = createJob({ videoPath: '/tmp/clip.mp4' }, settings)

    expect(job.videoPath).toBe('/tmp/clip.mp4')
    expect(job.description).toBe('')
    expect(job.schedule).toBeNull()
    expect(job.visibility).toBe('friends')
    expect(job.draft).toBe(false)
    expect(job.aiLabel).toBe(false)
    expect(job.comment).toBe(true)
    expect(job.duet).toBe(true)
    expect(job.stitch).toBe(true)
    expect(job.status).toBe('pending')
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('honours explicit overrides', () => {
    const job = createJob(
      {
        videoPath: '/tmp/clip.mp4',
        description: 'caption',
        schedule: '2026-12-01T18:00:00.000Z',
        visibility: 'private',
        draft: true,
        aiLabel: true
      },
      settings
    )

    expect(job.description).toBe('caption')
    expect(job.schedule).toBe('2026-12-01T18:00:00.000Z')
    expect(job.visibility).toBe('private')
    expect(job.draft).toBe(true)
    expect(job.aiLabel).toBe(true)
  })

  it('honours comment/duet/stitch overrides', () => {
    const job = createJob(
      { videoPath: '/tmp/clip.mp4', comment: false, duet: false, stitch: false },
      settings
    )
    expect(job.comment).toBe(false)
    expect(job.duet).toBe(false)
    expect(job.stitch).toBe(false)
  })
})
