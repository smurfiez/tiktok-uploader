import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

import type { VideoItem } from './types'
import { isSupportedVideo } from './uploader/upload'

/** `23-01-01_abcdefghijk_my dance.mp4` -> `my dance` */
const RENDER_PREFIX = /^\d{2}-\d{2}-\d{2}_[\w-]{11}_/

export function filenameTitle(videoPath: string): string {
  return basename(videoPath, extname(videoPath)).replace(RENDER_PREFIX, '').replace(/_/g, ' ').trim()
}

/** The `<video>.txt` sidecar title, or null when there is none. */
export function sidecarTitle(videoPath: string): string | null {
  const sidecar = videoPath.slice(0, videoPath.length - extname(videoPath).length) + '.txt'
  try {
    return readFileSync(sidecar, 'utf8').trim() || null
  } catch {
    return null
  }
}

/** Supported videos directly inside `directory`, oldest name first. */
export function listVideos(directory: string): VideoItem[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && isSupportedVideo(entry.name))
    .map((entry) => {
      const path = join(directory, entry.name)
      const stats = statSync(path)
      return { path, title: filenameTitle(path), size: stats.size, mtimeMs: stats.mtimeMs }
    })
    .filter((item) => item.size > 0)
    .sort((a, b) => a.path.localeCompare(b.path))
}

export { isSupportedVideo, RENDER_PREFIX }
