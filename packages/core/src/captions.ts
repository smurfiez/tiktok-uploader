/**
 * Port of src/tiktok_uploader/captions.py: rewrites a video's original title
 * into an English TikTok caption with hashtags, through any OpenAI-compatible
 * chat completions endpoint. Falls back to the title when the model fails.
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

/** renders are named YY-MM-DD_<11 character video id>_<title>.mp4 */
const RENDER_PREFIX = /^\d{2}-\d{2}-\d{2}_[\w-]{11}_/
const HASHTAG = /^[a-z0-9]+$/

export interface CaptionSettings {
  endpoint: string
  model: string
  apiKey: string
  minHashtags: number
  maxHashtags: number
  maxLength: number
  timeoutMs: number
}

const prompt = (title: string, settings: CaptionSettings): string => `You write captions for TikTok dance videos.
Rewrite the original title below into an English caption.

Rules:
- English only: translate anything that is not English. Keep song titles and artist
  names, romanized if needed (e.g. "Whistle - BLACKPINK").
- caption: one short, natural line without hashtags, @mentions or emojis.
- Never name the dancers, performers or channels in the video, in the caption or the
  hashtags. Only the song's artist may be named.
- hashtags: ${settings.minHashtags} to ${settings.maxHashtags} relevant, popular English hashtags, lowercase letters
  and digits only, without the # sign. Prefer the song, the artist and the dance style
  over generic tags.
- The caption plus the hashtags must fit in ${settings.maxLength} characters.

Reply with only JSON: {"caption": "...", "hashtags": ["...", "..."]}

Original title: ${title}`

/** The `<video>.txt` sidecar title, or null when there is none. */
export function sidecarTitle(videoPath: string): string | null {
  const sidecar = videoPath.slice(0, videoPath.length - extname(videoPath).length) + '.txt'
  try {
    return readFileSync(sidecar, 'utf8').trim() || null
  } catch {
    return null
  }
}

/**
 * The original title of a video: the sidecar <video>.txt if there is one,
 * otherwise the filename without the render prefix.
 */
export async function sourceTitle(videoPath: string): Promise<string> {
  const sidecar = sidecarTitle(videoPath)
  if (sidecar) return sidecar

  return basename(videoPath, extname(videoPath)).replace(RENDER_PREFIX, '').replace(/_/g, ' ').trim()
}

export async function rewriteCaption(
  title: string,
  settings: CaptionSettings
): Promise<string> {
  if (!settings.apiKey) {
    throw new Error('No caption model API key set')
  }

  const body = JSON.stringify({
    model: settings.model,
    messages: [{ role: 'user', content: prompt(title, settings) }],
    // the model reasons before answering, which counts against this limit
    max_tokens: 1500
  })

  // the endpoint occasionally answers with an empty message, so ask twice
  let lastError = new Error('no attempts made')
  for (let attempt = 0; attempt < 2; attempt++) {
    let message: { content?: string; refusal?: string }
    try {
      const response = await fetch(settings.endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json'
        },
        body,
        signal: AbortSignal.timeout(settings.timeoutMs)
      })
      if (!response.ok) {
        throw new Error(`caption endpoint returned ${response.status}`)
      }
      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string; refusal?: string } }>
      }
      message = json.choices?.[0]?.message ?? {}
    } catch (error) {
      throw new Error(`caption request failed: ${(error as Error).message}`)
    }

    try {
      return parseReply(message.content ?? '', settings.maxLength)
    } catch (error) {
      lastError = new Error(`${(error as Error).message} (refusal: ${message.refusal})`)
    }
  }

  throw lastError
}

/** Turns the model's JSON reply into "caption #tag1 #tag2" */
export function parseReply(reply: string, maxLength: number): string {
  const match = reply.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`model did not return JSON: ${reply.slice(0, 200)}`)

  let data: { caption?: unknown; hashtags?: unknown }
  try {
    data = JSON.parse(match[0])
  } catch {
    throw new Error(`model returned invalid JSON: ${reply.slice(0, 200)}`)
  }

  const caption = String(data.caption ?? '').trim()
  if (!caption) throw new Error('model returned an empty caption')

  const hashtags: string[] = []
  for (const raw of Array.isArray(data.hashtags) ? data.hashtags : []) {
    const tag = String(raw).trim().replace(/^#/, '').toLowerCase()
    if (HASHTAG.test(tag) && !hashtags.includes(tag)) hashtags.push(tag)
  }

  // drop trailing hashtags rather than cut the caption mid-word
  const withTags = (tags: string[]): string =>
    [caption, ...tags.map((tag) => `#${tag}`)].join(' ')

  const limited = hashtags.slice(0, Math.max(0, maxLength))
  while (limited.length > 0 && withTags(limited).length > maxLength) {
    limited.pop()
  }

  return withTags(limited)
}

/** A caption for the video, falling back to its original title */
export async function autoCaption(
  videoPath: string,
  settings: CaptionSettings
): Promise<{ caption: string; generated: boolean; error?: string }> {
  const title = await sourceTitle(videoPath)

  try {
    return { caption: await rewriteCaption(title, settings), generated: true }
  } catch (error) {
    return { caption: title, generated: false, error: (error as Error).message }
  }
}
