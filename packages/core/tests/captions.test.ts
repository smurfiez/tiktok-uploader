import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { autoCaption, parseReply, sourceTitle } from '../src/captions'
import type { CaptionSettings } from '../src/captions'

const dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tiktok-captions-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('sourceTitle', () => {
  it('uses the sidecar .txt when present', async () => {
    const dir = await tempDir()
    const video = join(dir, '23-01-01_abcdefghijk_my_dance.mp4')
    await writeFile(video, '')
    await writeFile(join(dir, '23-01-01_abcdefghijk_my_dance.txt'), '  Original Title  \n')

    expect(await sourceTitle(video)).toBe('Original Title')
  })

  it('falls back to the filename without the render prefix and underscores', async () => {
    const dir = await tempDir()
    const video = join(dir, '23-01-01_abcdefghijk_my_dance_clip.mp4')

    expect(await sourceTitle(video)).toBe('my dance clip')
  })

  it('ignores an empty sidecar', async () => {
    const dir = await tempDir()
    const video = join(dir, 'plain_name.mov')
    await writeFile(join(dir, 'plain_name.txt'), '   \n')

    expect(await sourceTitle(video)).toBe('plain name')
  })
})

describe('parseReply', () => {
  it('parses JSON wrapped in prose and fences', () => {
    const reply = 'Sure:\n```json\n{"caption": "A dance", "hashtags": ["dance"]}\n```'
    expect(parseReply(reply, 100)).toBe('A dance #dance')
  })

  it('strips the # sign and lowercases hashtags', () => {
    expect(parseReply('{"caption":"Hi","hashtags":["#Dance","Kpop"]}', 100)).toBe(
      'Hi #dance #kpop'
    )
  })

  it('dedupes hashtags', () => {
    expect(parseReply('{"caption":"Hi","hashtags":["dance","Dance","#dance","kpop"]}', 100)).toBe(
      'Hi #dance #kpop'
    )
  })

  it('drops hashtags that are not lowercase letters and digits', () => {
    expect(parseReply('{"caption":"Hi","hashtags":["ok1","two words","bad!","ok1"]}', 100)).toBe(
      'Hi #ok1'
    )
  })

  it('drops trailing hashtags to fit maxLength', () => {
    const reply = '{"caption":"Hello","hashtags":["one","two","three"]}'
    expect(parseReply(reply, 15)).toBe('Hello #one #two')
    expect(parseReply(reply, 21)).toBe('Hello #one #two')
    expect(parseReply(reply, 22)).toBe('Hello #one #two #three')
  })

  it('keeps the caption even when it alone exceeds maxLength', () => {
    expect(parseReply('{"caption":"Hello","hashtags":["one"]}', 3)).toBe('Hello')
  })

  it('throws when there is no JSON', () => {
    expect(() => parseReply('no json here', 100)).toThrow(/did not return JSON/)
  })

  it('throws on invalid JSON', () => {
    expect(() => parseReply('{"caption":}', 100)).toThrow(/invalid JSON/)
  })

  it('throws on an empty caption', () => {
    expect(() => parseReply('{"caption":"   ","hashtags":["x"]}', 100)).toThrow(
      /empty caption/
    )
  })
})

describe('autoCaption', () => {
  it('falls back to the title when no API key is set, without any network call', async () => {
    const dir = await tempDir()
    const video = join(dir, '23-01-01_abcdefghijk_fallback_title.mp4')
    const settings: CaptionSettings = {
      endpoint: 'http://127.0.0.1:9/never-called',
      model: 'test-model',
      apiKey: '',
      minHashtags: 1,
      maxHashtags: 3,
      maxLength: 100,
      timeoutMs: 50
    }

    const result = await autoCaption(video, settings)

    expect(result.generated).toBe(false)
    expect(result.caption).toBe('fallback title')
    expect(result.error).toMatch(/No caption model API key set/)
  })
})
