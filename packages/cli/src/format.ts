/**
 * Two output modes: NDJSON on stdout for scripts, readable progress on stderr
 * for humans. Helpers stay pure so they can be unit-tested.
 */

export interface CliEvent {
  event: string
  [key: string]: unknown
}

export interface CliReporter {
  event: (event: CliEvent) => void
  log: (line: string) => void
}

/** One JSON object per line, stamped so a consumer can order a mixed log. */
export const toNdjson = (value: unknown): string =>
  JSON.stringify({ ts: new Date().toISOString(), ...(value as Record<string, unknown>) }) + '\n'

export const formatEvent = (event: CliEvent): string => {
  const { event: name, ...detail } = event
  const fields = Object.entries(detail)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)

  return fields.length > 0 ? `${name} ${fields.join(' ')}` : name
}

export const createReporter = (options: { json: boolean }): CliReporter => ({
  // json mode: stdout is NDJSON only; human mode: results on stdout, progress on stderr
  event: (event) => {
    const line = options.json ? toNdjson(event) : formatEvent(event) + '\n'
    const stream = options.json ? process.stdout : process.stderr
    stream.write(line)
  },
  log: (line) => (options.json ? process.stderr : process.stdout).write(line + '\n')
})
