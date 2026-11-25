import { readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
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

export interface ListVideosOptions {
  recursive?: boolean
}

/** Supported videos inside `directory` (direct children by default; set `recursive: true` for subfolders). */
export function listVideos(directory: string, options: ListVideosOptions = {}): VideoItem[] {
  const recursive = Boolean(options.recursive)
  const items: VideoItem[] = []
  const visited = new Set<string>()

  const walk = (dir: string): void => {
    let real: string
    try {
      real = realpathSync(dir)
    } catch {
      return
    }
    if (visited.has(real)) return
    visited.add(real)

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (recursive) walk(fullPath)
        continue
      }

      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(fullPath)
          if (stats.isDirectory()) {
            if (recursive) walk(fullPath)
            continue
          }
          if (stats.isFile() && isSupportedVideo(entry.name) && stats.size > 0) {
            items.push({
              path: fullPath,
              title: filenameTitle(fullPath),
              size: stats.size,
              mtimeMs: stats.mtimeMs
            })
          }
        } catch {
          // broken symlink or unreadable target
        }
        continue
      }

      if (!entry.isFile() || !isSupportedVideo(entry.name)) continue
      try {
        const stats = statSync(fullPath)
        if (stats.size > 0) {
          items.push({
            path: fullPath,
            title: filenameTitle(fullPath),
            size: stats.size,
            mtimeMs: stats.mtimeMs
          })
        }
      } catch {
        // skip unreadable file
      }
    }
  }

  walk(directory)
  return items.sort((a, b) => a.path.localeCompare(b.path))
}

export { isSupportedVideo, RENDER_PREFIX }
