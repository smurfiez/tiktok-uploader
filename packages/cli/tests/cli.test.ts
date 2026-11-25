import { describe, expect, it } from 'vitest'

import { ExitCode, resolveExitCode } from '../src/exitCodes'
import { formatEvent, toNdjson } from '../src/format'

describe('toNdjson', () => {
  it('writes one line with an ISO timestamp', () => {
    const line = toNdjson({ event: 'batch_start', total: 3 })

    expect(line.endsWith('\n')).toBe(true)
    expect(line.trimEnd()).not.toContain('\n')

    const parsed = JSON.parse(line) as { ts: string; event: string; total: number }
    expect(parsed).toMatchObject({ event: 'batch_start', total: 3 })
    expect(parsed.ts).toBe(new Date(parsed.ts).toISOString())
  })

  it('keeps an explicit ts when the event carries one', () => {
    const parsed = JSON.parse(toNdjson({ ts: '2026-12-01T10:00:00.000Z', event: 'x' })) as {
      ts: string
    }
    expect(parsed.ts).toBe('2026-12-01T10:00:00.000Z')
  })
})

describe('formatEvent', () => {
  it('names the event and lists its fields', () => {
    expect(formatEvent({ event: 'job_failed', jobId: '1', error: 'boom' })).toBe(
      'job_failed jobId=1 error=boom'
    )
  })

  it('drops empty fields and prints a bare name', () => {
    expect(formatEvent({ event: 'batch_done', done: 2, error: undefined })).toBe('batch_done done=2')
    expect(formatEvent({ event: 'plain' })).toBe('plain')
  })

  it('serialises non-string values', () => {
    expect(formatEvent({ event: 'plan', files: ['a.mp4'] })).toBe('plan files=["a.mp4"]')
  })
})

describe('resolveExitCode', () => {
  it('exposes the documented codes', () => {
    expect(ExitCode.Ok).toBe(0)
    expect(ExitCode.Unexpected).toBe(1)
    expect(ExitCode.Usage).toBe(2)
    expect(ExitCode.Auth).toBe(3)
    expect(ExitCode.LockBusy).toBe(4)
    expect(ExitCode.Partial).toBe(5)
    expect(ExitCode.AllFailed).toBe(6)
  })

  it('returns 0 when nothing failed', () => {
    expect(resolveExitCode({ total: 3, done: 3, failed: 0, authRequired: false, lockBusy: false })).toBe(
      ExitCode.Ok
    )
    expect(resolveExitCode({ total: 0, done: 0, failed: 0, authRequired: false, lockBusy: false })).toBe(
      ExitCode.Ok
    )
  })

  it('returns 3 for an expired or blocked session', () => {
    expect(resolveExitCode({ total: 2, done: 1, failed: 1, authRequired: true, lockBusy: false })).toBe(
      ExitCode.Auth
    )
  })

  it('returns 4 when the account lock is busy', () => {
    expect(resolveExitCode({ total: 2, done: 0, failed: 0, authRequired: false, lockBusy: true })).toBe(
      ExitCode.LockBusy
    )
  })

  it('returns 5 on a partial failure', () => {
    expect(resolveExitCode({ total: 2, done: 1, failed: 1, authRequired: false, lockBusy: false })).toBe(
      ExitCode.Partial
    )
  })

  it('returns 6 when every attempted job failed', () => {
    expect(resolveExitCode({ total: 2, done: 0, failed: 2, authRequired: false, lockBusy: false })).toBe(
      ExitCode.AllFailed
    )
  })
})
