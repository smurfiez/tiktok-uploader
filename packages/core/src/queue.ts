/**
 * Persisted, serial, per-account upload queue. One browser context, one page,
 * one job at a time. Every status transition is written to
 * `profiles/<accountId>/queue.json` so a crash or quit resumes cleanly.
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { browserProfileDir, failuresDir, queuePath } from './paths'
import { acquireLock, releaseLock } from './profiles'
import { isValidSchedule, MIN_LEAD_MINUTES } from './schedule'
import { loadSettings } from './settings'
import type { Job, QueueEvent } from './types'
import { timestampSlug } from './utils'
import { AuthError, ensureAuthenticated } from './uploader/auth'
import { launchContext } from './uploader/browser'
import { uploadVideo } from './uploader/upload'

export function loadQueue(accountId: string): Job[] {
  try {
    const parsed = JSON.parse(readFileSync(queuePath(accountId), 'utf8'))
    return Array.isArray(parsed) ? (parsed as Job[]) : []
  } catch {
    return []
  }
}

/** Atomic: a crash mid-write leaves the previous queue readable. */
export function saveQueue(accountId: string, jobs: Job[]): void {
  const file = queuePath(accountId)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })

  const temporary = `${file}.tmp`
  writeFileSync(temporary, JSON.stringify(jobs, null, 2) + '\n', 'utf8')
  renameSync(temporary, file)
}

export interface NewJobInput {
  videoPath: string
  description?: string
  schedule?: string | null
  visibility?: Job['visibility']
  draft?: boolean
  aiLabel?: boolean
  comment?: boolean
  duet?: boolean
  stitch?: boolean
}

export function createJob(input: NewJobInput, settings = loadSettings()): Job {
  return {
    id: randomUUID(),
    videoPath: input.videoPath,
    description: input.description ?? '',
    schedule: input.schedule ?? null,
    visibility: input.visibility ?? settings.visibility,
    draft: input.draft ?? false,
    aiLabel: input.aiLabel ?? settings.aiLabel,
    comment: input.comment ?? true,
    duet: input.duet ?? true,
    stitch: input.stitch ?? true,
    status: 'pending'
  }
}

export interface RunQueueOptions {
  accountId: string
  jobs: Job[]
  headed?: boolean
  browserPath?: string
  maxScheduleDays?: number
  onEvent?: (event: QueueEvent) => void
  shouldStop?: () => boolean
  /** Persist after every transition (default true) */
  persist?: boolean
}

export interface RunQueueResult {
  done: number
  failed: number
  skipped: number
  authRequired: boolean
  lockBusy: boolean
}

/**
 * Runs every pending or failed job serially. On a captcha or expired session it
 * stops the batch (a headless run cannot solve it), leaving the rest pending.
 */
export async function runQueue(options: RunQueueOptions): Promise<RunQueueResult> {
  const settings = loadSettings()
  const persist = options.persist !== false
  const emit = (event: QueueEvent): void =>
    options.onEvent?.({ ...event, accountId: event.accountId ?? options.accountId })
  const report = (message: string, jobId?: string): void => emit({ type: 'log', message, jobId })

  const result: RunQueueResult = {
    done: 0,
    failed: 0,
    skipped: 0,
    authRequired: false,
    lockBusy: false
  }

  try {
    acquireLock(options.accountId, 'queue')
  } catch (error) {
    result.lockBusy = true
    report((error as Error).message)
    return result
  }

  const save = (): void => {
    if (persist) saveQueue(options.accountId, options.jobs)
  }

  const setStatus = (job: Job, status: Job['status'], extra: Partial<Job> = {}): void => {
    job.status = status
    Object.assign(job, extra)
    save()
    emit({
      type: 'job-status',
      jobId: job.id,
      status,
      ...(extra.error ? { error: extra.error } : {}),
      ...(extra.screenshot ? { screenshot: extra.screenshot } : {})
    })
  }

  let launched: Awaited<ReturnType<typeof launchContext>>
  try {
    launched = await launchContext({
      userDataDir: browserProfileDir(options.accountId),
      headless: !options.headed,
      browserPath: options.browserPath ?? settings.browserPath
    })
  } catch (error) {
    // the browser never started, so nothing else will release the lock
    releaseLock(options.accountId)
    throw error
  }

  const relaunch = async (): Promise<void> => {
    await launched.close().catch(() => {})
    launched = await launchContext({
      userDataDir: browserProfileDir(options.accountId),
      headless: !options.headed,
      browserPath: options.browserPath ?? settings.browserPath
    })
    await ensureAuthenticated({
      context: launched.context,
      page: launched.page,
      accountId: options.accountId,
      report
    })
  }

  try {
    await ensureAuthenticated({
      context: launched.context,
      page: launched.page,
      accountId: options.accountId,
      report
    })
  } catch (error) {
    if (error instanceof AuthError) {
      result.authRequired = true
      emit({ type: 'auth-required', message: error.message })
      await launched.close().catch(() => {})
      releaseLock(options.accountId)
      return result
    }
    await launched.close().catch(() => {})
    releaseLock(options.accountId)
    throw error
  }

  const maxDays = options.maxScheduleDays ?? settings.maxScheduleDays
  let relaunched = false

  try {
    for (const job of options.jobs) {
      if (job.status === 'done' || job.status === 'skipped') continue

      if (options.shouldStop?.()) {
        setStatus(job, 'skipped')
        result.skipped++
        continue
      }

      // a long batch can drift past an early slot; TikTok needs 20 minutes of lead
      if (job.schedule && !isValidSchedule(new Date(job.schedule), new Date(), maxDays)) {
        setStatus(job, 'failed', {
          error: `Slot ${job.schedule} is no longer ${MIN_LEAD_MINUTES} minutes ahead, inside ${maxDays} days, on a 5-minute mark`
        })
        result.failed++
        continue
      }

      emit({ type: 'job-stage', jobId: job.id, stage: 'starting' })
      setStatus(job, 'running', { error: undefined, screenshot: undefined })

      try {
        await uploadVideo(
          launched.page,
          {
            videoPath: job.videoPath,
            description: job.description,
            schedule: job.schedule ? new Date(job.schedule) : null,
            visibility: job.visibility,
            draft: job.draft,
            aiLabel: job.aiLabel,
            comment: job.comment,
            duet: job.duet,
            stitch: job.stitch
          },
          (stage) => emit({ type: 'job-stage', jobId: job.id, stage })
        )

        setStatus(job, 'done')
        result.done++
      } catch (error) {
        const message = (error as Error).message
        const screenshot = await captureFailure(launched.page, options.accountId, job.id)
        setStatus(job, 'failed', { error: message, ...(screenshot ? { screenshot } : {}) })
        result.failed++

        // a dead browser is recoverable once; a captcha is not
        if (!relaunched && launched.page.isClosed()) {
          relaunched = true
          report('The browser died; relaunching once')
          try {
            await relaunch()
          } catch (relaunchError) {
            if (relaunchError instanceof AuthError) {
              result.authRequired = true
              emit({ type: 'auth-required', message: relaunchError.message })
              break
            }
          }
        }

        if (error instanceof AuthError) {
          result.authRequired = true
          emit({ type: 'auth-required', message })
          break
        }
      }
    }
  } finally {
    if (options.shouldStop?.()) {
      for (const job of options.jobs) {
        if (job.status === 'pending') {
          job.status = 'skipped'
          result.skipped++
          emit({ type: 'job-status', jobId: job.id, status: 'skipped' })
        }
      }
      save()
    }

    releaseLock(options.accountId)
    await Promise.race([launched.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))])
  }

  emit({ type: 'queue-done', ...result })
  return result
}

async function captureFailure(
  page: import('playwright-core').Page,
  accountId: string,
  jobId: string
): Promise<string | undefined> {
  try {
    if (page.isClosed()) return undefined
    const path = `${failuresDir(accountId)}/${timestampSlug()}-${jobId}.png`
    mkdirSync(dirname(path), { recursive: true })
    await page.screenshot({ path, fullPage: true })
    return path
  } catch {
    return undefined
  }
}

/** Best-effort title for a video: sidecar `.txt`, then the filename. */
export function removeQueueFile(accountId: string): void {
  try {
    unlinkSync(queuePath(accountId))
  } catch {
    // already gone
  }
}
