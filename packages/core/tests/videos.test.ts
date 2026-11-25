import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { filenameTitle, isSupportedVideo, listVideos, sidecarTitle } from '../src/videos'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tiktok-videos-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('filenameTitle', () => {
  it('strips the render prefix and turns underscores into spaces', () => {
    expect(filenameTitle('/tmp/23-01-01_abcdefghijk_my_dance_clip.mp4')).toBe('my dance clip')
  })

  it('keeps a filename without a render prefix', () => {
    expect(filenameTitle('/tmp/plain_video.mov')).toBe('plain video')
  })

  it('keeps dashes inside the title', () => {
    expect(filenameTitle('23-01-01_abcdefghijk_kpop-mix_2024.mp4')).toBe('kpop-mix 2024')
  })
})

describe('sidecarTitle', () => {
  it('uses the trimmed contents of the .txt sidecar', () => {
    const dir = tempDir()
    const video = join(dir, 'clip.mp4')
    writeFileSync(video, 'x')
    writeFileSync(join(dir, 'clip.txt'), '  Original Title  \n')

    expect(sidecarTitle(video)).toBe('Original Title')
  })

  it('returns null when the sidecar is missing or empty', () => {
    const dir = tempDir()
    expect(sidecarTitle(join(dir, 'plain.mov'))).toBeNull()

    const video = join(dir, 'empty.mp4')
    writeFileSync(join(dir, 'empty.txt'), '   \n')
    expect(sidecarTitle(video)).toBeNull()
  })
})

describe('listVideos', () => {
  it('returns only non-empty supported files, sorted by path', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'a.mp4'), 'x')
    writeFileSync(join(dir, 'c.webm'), 'zzz')
    writeFileSync(join(dir, 'b.mov'), 'yy')
    writeFileSync(join(dir, 'd.MP4'), 'wwww')
    writeFileSync(join(dir, 'notes.txt'), 'not a video')
    writeFileSync(join(dir, 'empty.mp4'), '')
    writeFileSync(join(dir, '.hidden.mp4'), 'x')

    const videos = listVideos(dir)

    expect(videos.map((video) => video.path)).toEqual([
      join(dir, 'a.mp4'),
      join(dir, 'b.mov'),
      join(dir, 'c.webm'),
      join(dir, 'd.MP4')
    ])
    expect(videos[0].title).toBe('a')
    expect(videos[0].size).toBe(1)
    expect(videos[0].mtimeMs).toBeGreaterThan(0)
  })

  it('returns an empty list for a directory without videos', () => {
    expect(listVideos(tempDir())).toEqual([])
  })
})

describe('isSupportedVideo', () => {
  it('rejects unsupported extensions', () => {
    expect(isSupportedVideo('clip.txt')).toBe(false)
    expect(isSupportedVideo('clip')).toBe(false)
  })

  it('accepts mp4 regardless of casing', () => {
    expect(isSupportedVideo('clip.mp4')).toBe(true)
    expect(isSupportedVideo('clip.MP4')).toBe(true)
    expect(isSupportedVideo('clip.mOv')).toBe(true)
  })
})
