export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const DURATION = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i
const UNIT_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** `30s`, `15m`, `12h`, `2d` (and spaced variants) to milliseconds. */
export function parseDuration(value: string): number {
  const match = DURATION.exec(value.trim())
  if (!match) throw new Error(`Invalid duration "${value}": use e.g. 30s, 15m, 12h, 1d`)

  const ms = Number(match[1]) * UNIT_MS[match[2].toLowerCase()]
  if (!Number.isFinite(ms) || ms <= 0) throw new Error(`Invalid duration "${value}"`)
  return ms
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

export const timestampSlug = (date = new Date()): string =>
  date.toISOString().replace(/[:.]/g, '-')
