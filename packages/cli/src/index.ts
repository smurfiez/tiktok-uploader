#!/usr/bin/env node
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { Command, CommanderError } from 'commander'

import {
  AuthError,
  LockBusyError,
  MAX_DESCRIPTION_HARD,
  MAX_DESCRIPTION_LENGTH,
  PATHS,
  SELECTORS,
  acquireLock,
  addAccount,
  assertAccountId,
  assertSchedulable,
  autoCaption,
  sidecarTitle,
  browserProfileDir,
  buildStaggeredSchedule,
  captionApiKey,
  checkSession,
  cookiesPath,
  createJob,
  ensureDataDir,
  exportCookies,
  inspectAccount,
  isSupportedVideo,
  launchContext,
  listAccounts,
  listVideos,
  loadQueue,
  loadSettings,
  loginInteractive,
  parseNetscape,
  releaseLock,
  removeAccount,
  removeQueueFile,
  runQueue,
  saveQueue,
  serializeNetscape,
  setAccountLabel
} from '@tiktok-uploader/core'
import type { CaptionSettings, Job, QueueEvent, Settings, Visibility } from '@tiktok-uploader/core'

import { ExitCode, resolveExitCode } from './exitCodes'
import { createReporter } from './format'
import type { CliReporter } from './format'

const { version } = require('../package.json') as { version: string }

class UsageError extends Error {}

const VISIBILITIES: Visibility[] = ['everyone', 'friends', 'private']

const program = new Command()
program
  .name('tiktok-up')
  .description('Upload and schedule TikTok videos from the terminal')
  .version(version)
  .showHelpAfterError()
  .exitOverride()

const sub = (parent: Command, name: string, description: string): Command =>
  parent.command(name).description(description).exitOverride()

const resolveAccount = (value?: string): string => {
  const id = value?.trim() || loadSettings().defaultAccount
  try {
    return assertAccountId(id)
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
}

const reporterFor = (options: { json?: boolean }): CliReporter =>
  createReporter({ json: Boolean(options.json) })

const showError = (error: unknown): void => {
  if (error instanceof UsageError) {
    process.stderr.write(`error: ${error.message}\n`)
    process.exitCode = ExitCode.Usage
    return
  }
  if (error instanceof AuthError) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = ExitCode.Auth
    return
  }
  if (error instanceof LockBusyError) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = ExitCode.LockBusy
    return
  }
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = ExitCode.Unexpected
}

const guard =
  <Args extends unknown[]>(action: (...args: Args) => Promise<void>) =>
  async (...args: Args): Promise<void> => {
    try {
      await action(...args)
    } catch (error) {
      showError(error)
    }
  }

/* ---------------------------------------------------------------- accounts */

const accounts = sub(program, 'accounts', 'Manage account profiles')

sub(accounts, 'list', 'List accounts')
  .option('--json', 'NDJSON output')
  .action(
    guard(async (options: { json?: boolean }) => {
      const reporter = reporterFor(options)
      const list = listAccounts()

      if (options.json) {
        reporter.event({ event: 'accounts', accounts: list })
        return
      }
      if (list.length === 0) {
        reporter.log('No accounts. Add one: tiktok-up accounts add main')
        return
      }
      for (const account of list) reporter.log(`${account.id}\t${account.label}`)
    })
  )

sub(accounts, 'add', 'Add an account')
  .argument('<id>', 'account id')
  .option('--label <label>', 'human-readable label')
  .action(
    guard(async (id: string, options: { label?: string }) => {
      const account = addAccount(id, options.label)
      process.stdout.write(`Account "${account.id}" ready (${account.label})\n`)
    })
  )

sub(accounts, 'label', 'Change an account\'s display label (the id stays the same)')
  .argument('<id>', 'account id')
  .argument('<label>', 'human-readable label')
  .action(
    guard(async (id: string, label: string) => {
      const account = setAccountLabel(id, label)
      process.stdout.write(`Account "${account.id}" is now labeled "${account.label}"\n`)
    })
  )

sub(accounts, 'remove', 'Remove an account and its profile')
  .argument('<id>', 'account id')
  .action(
    guard(async (id: string) => {
      removeAccount(id)
      process.stdout.write(`Account "${id}" removed\n`)
    })
  )

/* ------------------------------------------------------------------- login */

sub(program, 'login', 'Sign in to TikTok in a headed browser')
  .option('--account <id>', 'account id (defaults to settings.defaultAccount)')
  .action(
    guard(async (options: { account?: string }) => {
      const accountId = resolveAccount(options.account)
      const settings = loadSettings()
      await loginInteractive({
        accountId,
        browserPath: settings.browserPath,
        report: (message) => process.stdout.write(message + '\n')
      })
    })
  )

/* -------------------------------------------------------------------- auth */

const auth = sub(program, 'auth', 'Session status')

sub(auth, 'status', 'Check whether an account is signed in')
  .option('--account <id>', 'account id (defaults to settings.defaultAccount)')
  .option('--json', 'NDJSON output')
  .action(
    guard(async (options: { account?: string; json?: boolean }) => {
      const accountId = resolveAccount(options.account)
      const reporter = reporterFor(options)
      const status = await inspectAccount(accountId, { browserPath: loadSettings().browserPath })

      if (options.json) {
        reporter.event({ event: 'auth_status', account: accountId, ...status })
      } else {
        reporter.log(status.message)
      }
      if (!status.signedIn) process.exitCode = ExitCode.Auth
    })
  )

/* ----------------------------------------------------------------- cookies */

const cookies = sub(program, 'cookies', 'Import or export Netscape cookies.txt')

sub(cookies, 'import', 'Load cookies.txt into the account profile')
  .argument('<file>', 'Netscape cookies file')
  .option('--account <id>', 'account id (defaults to settings.defaultAccount)')
  .action(
    guard(async (file: string, options: { account?: string }) => {
      const accountId = resolveAccount(options.account)
      const source = resolve(file)
      if (!existsSync(source)) throw new UsageError(`No cookies file at ${source}`)

      const parsed = parseNetscape(readFileSync(source, 'utf8'))
      if (parsed.length === 0) {
        throw new UsageError(`${source} contains no cookies; export it as Netscape format`)
      }

      const target = cookiesPath(accountId)
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      writeFileSync(target, serializeNetscape(parsed), { encoding: 'utf8', mode: 0o600 })
      if (process.platform !== 'win32') chmodSync(target, 0o600)

      process.stdout.write(`Imported ${parsed.length} cookies into "${accountId}" (${target})\n`)
    })
  )

sub(cookies, 'export', 'Write the account cookies to a Netscape file')
  .argument('<file>', 'destination path')
  .option('--account <id>', 'account id (defaults to settings.defaultAccount)')
  .action(
    guard(async (file: string, options: { account?: string }) => {
      const accountId = resolveAccount(options.account)
      const stored = await exportCookies(accountId, loadSettings().browserPath)
      const target = resolve(file)

      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, serializeNetscape(stored), { encoding: 'utf8', mode: 0o600 })
      if (process.platform !== 'win32') chmodSync(target, 0o600)

      process.stdout.write(`Exported ${stored.length} cookies from "${accountId}" to ${target}\n`)
    })
  )

/* ------------------------------------------------------------------ upload */

interface UploadOptions {
  account?: string
  start?: string
  every?: string
  jitter?: string
  window?: string
  visibility?: string
  draft?: boolean
  aiLabel?: boolean
  autoCaption?: boolean
  headed?: boolean
  dryRun?: boolean
  json?: boolean
  maxScheduleDays?: number
}

const expandPaths = (args: string[]): string[] => {
  const files: string[] = []

  for (const arg of args) {
    const path = resolve(arg)
    if (!existsSync(path)) throw new UsageError(`No such file or directory: ${arg}`)

    if (statSync(path).isDirectory()) {
      const videos = listVideos(path)
      if (videos.length === 0) throw new UsageError(`No supported videos in ${arg}`)
      files.push(...videos.map((video) => video.path))
      continue
    }

    if (!isSupportedVideo(path)) {
      throw new UsageError(`Unsupported video type: ${arg} (mp4, mov, webm, mkv, ...)`)
    }
    files.push(path)
  }

  return files
}

const captionSettings = (settings: Settings): CaptionSettings => ({
  endpoint: settings.captionEndpoint,
  model: settings.captionModel,
  apiKey: captionApiKey(),
  minHashtags: 3,
  maxHashtags: 6,
  maxLength: MAX_DESCRIPTION_HARD,
  timeoutMs: 60_000
})

const checkCaption = (description: string, reporter: CliReporter): void => {
  if (description.length > MAX_DESCRIPTION_HARD) {
    throw new UsageError(
      `Caption is ${description.length} characters; TikTok's hard limit is ${MAX_DESCRIPTION_HARD}`
    )
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    reporter.log(
      `Warning: caption is ${description.length} characters; the feed truncates above ${MAX_DESCRIPTION_LENGTH}`
    )
  }
}

const buildJobs = async (
  files: string[],
  options: UploadOptions,
  reporter: CliReporter
): Promise<{ jobs: Job[]; settings: Settings }> => {
  const settings = loadSettings()
  const visibility = (options.visibility ?? settings.visibility) as Visibility
  if (!VISIBILITIES.includes(visibility)) {
    throw new UsageError(`Invalid visibility "${visibility}": use everyone, friends or private`)
  }

  const scheduling = Boolean(options.start || options.every)
  if (scheduling) {
    if (!options.start || !options.every) {
      throw new UsageError('--start and --every must be used together to schedule')
    }
    if (options.draft) throw new UsageError('Draft uploads cannot be scheduled')
    if (visibility === 'private') throw new UsageError('Private ("Only me") uploads cannot be scheduled')
  }

  const maxScheduleDays = options.maxScheduleDays ?? settings.maxScheduleDays
  if (!Number.isInteger(maxScheduleDays) || maxScheduleDays < 1 || maxScheduleDays > 30) {
    throw new UsageError('--max-schedule-days must be a whole number between 1 and 30')
  }

  let dates: Date[] = []
  if (scheduling) {
    try {
      dates = buildStaggeredSchedule({
        start: options.start as string,
        every: options.every as string,
        count: files.length,
        jitter: options.jitter,
        window: options.window
      })
      assertSchedulable(dates, new Date(), maxScheduleDays)
    } catch (error) {
      throw new UsageError((error as Error).message)
    }
  }

  const jobs: Job[] = []
  for (let index = 0; index < files.length; index++) {
    let description = sidecarTitle(files[index]) ?? ''
    if (options.autoCaption) {
      const generated = await autoCaption(files[index], captionSettings(settings))
      description = generated.caption
      if (!generated.generated) {
        reporter.log(`Warning: caption fallback for ${files[index]}: ${generated.error}`)
      }
    }
    checkCaption(description, reporter)

    jobs.push(
      createJob(
        {
          videoPath: files[index],
          description,
          schedule: dates[index] ? dates[index].toISOString() : null,
          visibility,
          draft: Boolean(options.draft),
          aiLabel: options.aiLabel ?? settings.aiLabel
        },
        settings
      )
    )
  }

  return { jobs, settings }
}

interface BatchOptions {
  headed?: boolean
  maxScheduleDays?: number
}

const emitQueueEvent = (event: QueueEvent, jobs: Job[], reporter: CliReporter): void => {
  const job = 'jobId' in event ? jobs.find((candidate) => candidate.id === event.jobId) : undefined

  if (event.type === 'log') {
    reporter.log(event.message)
    return
  }
  if (event.type === 'auth-required') {
    reporter.event({ event: 'auth_required', message: event.message })
    return
  }
  if (event.type === 'queue-done') {
    reporter.event({ event: 'batch_done', done: event.done, failed: event.failed, skipped: event.skipped })
    return
  }
  if (event.type === 'job-stage') {
    reporter.event({ event: 'job_stage', jobId: event.jobId, file: job?.videoPath, stage: event.stage })
    return
  }

  const name = event.status === 'done' ? 'job_done' : event.status === 'failed' ? 'job_failed' : 'job_status'
  reporter.event({
    event: name,
    jobId: event.jobId,
    file: job?.videoPath,
    status: event.status,
    ...(job?.schedule ? { scheduledAt: job.schedule } : {}),
    ...(event.error ? { error: event.error } : {}),
    ...(event.screenshot ? { screenshot: event.screenshot } : {})
  })
}

const runBatch = async (
  accountId: string,
  jobs: Job[],
  options: BatchOptions,
  reporter: CliReporter
): Promise<void> => {
  saveQueue(accountId, jobs)
  reporter.event({ event: 'batch_start', account: accountId, total: jobs.length, headless: !options.headed })

  const result = await runQueue({
    accountId,
    jobs,
    headed: options.headed,
    maxScheduleDays: options.maxScheduleDays,
    onEvent: (event) => emitQueueEvent(event, jobs, reporter)
  })

  saveQueue(accountId, jobs)
  const total = result.done + result.failed + result.skipped
  process.exitCode = resolveExitCode({ total, ...result })
}

sub(program, 'upload', 'Upload or schedule videos')
  .argument('<paths...>', 'video files or directories')
  .option('--account <id>', 'account id (defaults to settings.defaultAccount)')
  .option('--start <when>', 'first slot: ISO, "2026-12-01 18:00" or "tomorrow 18:00"')
  .option('--every <duration>', 'spacing between slots: 12h, 1d, 2d')
  .option('--jitter <duration>', 'random offset per slot, e.g. 15m')
  .option('--window <hh:mm-hh:mm>', 'allowed posting hours, e.g. 09:00-21:00')
  .option('--visibility <level>', 'everyone, friends or private')
  .option('--draft', 'save as a draft instead of posting')
  .option('--ai-label', 'mark the video as AI-generated')
  .option('--no-ai-label', 'do not mark the video as AI-generated')
  .option('--auto-caption', 'generate captions with the caption model')
  .option('--headed', 'show the browser window')
  .option('--dry-run', 'print the resolved plan without launching a browser')
  .option('--json', 'NDJSON output')
  .option('--max-schedule-days <days>', 'maximum scheduling horizon', Number)
  .action(
    guard(async (paths: string[], options: UploadOptions) => {
      const accountId = resolveAccount(options.account)
      const reporter = reporterFor(options)
      const files = expandPaths(paths)
      const { jobs, settings } = await buildJobs(files, options, reporter)

      if (options.dryRun) {
        if (options.json) {
          reporter.event({
            event: 'plan',
            account: accountId,
            total: jobs.length,
            visibility: jobs[0]?.visibility,
            draft: jobs[0]?.draft,
            jobs: jobs.map((job) => ({
              file: job.videoPath,
              schedule: job.schedule,
              visibility: job.visibility,
              draft: job.draft
            }))
          })
        } else {
          reporter.log(`Plan for "${accountId}": ${jobs.length} video(s)`)
          for (const job of jobs) {
            reporter.log(`  ${job.videoPath} -> ${job.schedule ?? 'post now'} (${job.visibility}${job.draft ? ', draft' : ''})`)
          }
        }
        return
      }

      await runBatch(
        accountId,
        jobs,
        { headed: options.headed, maxScheduleDays: options.maxScheduleDays ?? settings.maxScheduleDays },
        reporter
      )
    })
  )

/* ------------------------------------------------------------------- queue */

const queue = sub(program, 'queue', 'Inspect and recover the persisted queue')

sub(queue, 'status', 'Show queued jobs')
  .option('--account <id>', 'account id (defaults to settings.defaultAccount)')
  .option('--json', 'NDJSON output')
  .action(
    guard(async (options: { account?: string; json?: boolean }) => {
      const accountId = resolveAccount(options.account)
      const reporter = reporterFor(options)
      const jobs = loadQueue(accountId)

      if (options.json) {
        reporter.event({ event: 'queue', account: accountId, total: jobs.length, jobs })
        return
      }
      if (jobs.length === 0) {
        reporter.log(`Queue for "${accountId}" is empty`)
        return
      }
      for (const job of jobs) {
        reporter.log(
          `${job.status}\t${job.videoPath}\t${job.schedule ?? 'post now'}${job.error ? `\t${job.error}` : ''}`
        )
      }
    })
  )

sub(queue, 'retry-failed', 'Reset failed jobs to pending and run the queue')
  .option('--account <id>', 'account id (defaults to settings.defaultAccount)')
  .option('--headed', 'show the browser window')
  .option('--json', 'NDJSON output')
  .action(
    guard(async (options: { account?: string; headed?: boolean; json?: boolean }) => {
      const accountId = resolveAccount(options.account)
      const reporter = reporterFor(options)
      const jobs = loadQueue(accountId)
      const failed = jobs.filter((job) => job.status === 'failed')

      if (failed.length === 0) {
        reporter.log(`No failed jobs for "${accountId}"`)
        return
      }
      for (const job of failed) {
        job.status = 'pending'
        delete job.error
        delete job.screenshot
      }

      await runBatch(
        accountId,
        jobs,
        { headed: options.headed, maxScheduleDays: loadSettings().maxScheduleDays },
        reporter
      )
    })
  )

sub(queue, 'clear', 'Delete the queue')
  .option('--account <id>', 'account id (defaults to settings.defaultAccount)')
  .option('--completed-only', 'keep pending and failed jobs')
  .action(
    guard(async (options: { account?: string; completedOnly?: boolean }) => {
      const accountId = resolveAccount(options.account)

      if (options.completedOnly) {
        const kept = loadQueue(accountId).filter((job) => job.status !== 'done' && job.status !== 'skipped')
        saveQueue(accountId, kept)
        process.stdout.write(`Kept ${kept.length} job(s) for "${accountId}"\n`)
        return
      }

      removeQueueFile(accountId)
      process.stdout.write(`Cleared the queue for "${accountId}"\n`)
    })
  )

/* ------------------------------------------------------------------ doctor */

sub(program, 'doctor', 'Check browser, session and TikTok selectors')
  .option('--account <id>', 'account id (defaults to settings.defaultAccount)')
  .option('--json', 'NDJSON output')
  .action(
    guard(async (options: { account?: string; json?: boolean }) => {
      const accountId = resolveAccount(options.account)
      const reporter = reporterFor(options)
      const settings = loadSettings()
      const failed: string[] = []

      const check = (name: string, ok: boolean, message: string): void => {
        if (!ok) failed.push(name)
        reporter.event({ event: 'doctor', check: name, ok, message })
      }

      try {
        const probe = resolve(ensureDataDir(), `.write-probe-${process.pid}`)
        writeFileSync(probe, 'ok')
        rmSync(probe, { force: true })
        check('data-dir', true, `${ensureDataDir()} is writable`)
      } catch (error) {
        check('data-dir', false, (error as Error).message)
      }

      let signedIn = false
      let sessionChecked = false
      let browser: Awaited<ReturnType<typeof launchContext>> | undefined

      acquireLock(accountId, 'doctor')
      try {
        browser = await launchContext({
          userDataDir: browserProfileDir(accountId),
          headless: true,
          browserPath: settings.browserPath
        })
        check('browser', true, 'Browser launched headless')

        signedIn = await checkSession(browser.page)
        sessionChecked = true
        check(
          'session',
          signedIn,
          signedIn ? 'Signed in' : `Not signed in. Run: tiktok-up login --account ${accountId}`
        )

        await browser.page.goto(PATHS.upload, { waitUntil: 'domcontentloaded' })
        const roots = await browser.page.locator(SELECTORS.root).count()
        check('selectors', roots > 0, `${SELECTORS.root} ${roots > 0 ? 'found' : 'missing'} on the upload page`)
      } catch (error) {
        if (!sessionChecked) check('browser', false, (error as Error).message)
      } finally {
        await browser?.close().catch(() => {})
        releaseLock(accountId)
      }

      reporter.event({ event: 'doctor_done', ok: failed.length === 0, failed })
      if (sessionChecked && !signedIn) process.exitCode = ExitCode.Auth
      else if (failed.length > 0) process.exitCode = ExitCode.Unexpected
    })
  )

/* -------------------------------------------------------------------- main */

const main = async (): Promise<void> => {
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode === 0 ? ExitCode.Ok : ExitCode.Usage
      return
    }
    showError(error)
  }
}

void main()
