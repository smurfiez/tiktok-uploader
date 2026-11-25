/**
 * Port of src/tiktok_uploader/upload.py: fills TikTok's upload form.
 *
 * The step order mirrors `complete_upload_form` so behaviour matches the Python
 * package, including its fallbacks. Custom covers and product links are not
 * ported yet; every other field is.
 */

import type { Locator, Page } from 'playwright-core'
import { errors } from 'playwright-core'

import {
  MAX_DESCRIPTION_HARD,
  PATHS,
  SELECTORS,
  SUPPORTED_VIDEO_TYPES,
  TIMING
} from '../selectors'
import {
  calendarSteps,
  monthNumber,
  monthNumberFromShort,
  partsInZone
} from '../schedule'
import type { Visibility } from '../types'
import { sleep } from '../utils'
import { assertSignedIn } from './auth'

export interface UploadJob {
  videoPath: string
  description: string
  schedule: Date | null
  visibility: Visibility
  draft: boolean
  aiLabel: boolean
  comment: boolean
  duet: boolean
  stitch: boolean
}

export type Reporter = (stage: string) => void

export class UploadError extends Error {}

export async function uploadVideo(
  page: Page,
  job: UploadJob,
  report: Reporter
): Promise<void> {
  if (job.description.length > MAX_DESCRIPTION_HARD) {
    throw new UploadError(`Caption is ${job.description.length} characters; TikTok allows ${MAX_DESCRIPTION_HARD}`)
  }

  await goToUpload(page, report)
  await removeCookiesBanner(page)

  await setVideo(page, job.videoPath, report)
  await removeSplitWindow(page)
  await dismissOnboardingTour(page)
  await setInteractivity(page, job)

  await setDescription(page, job.description, report)
  if (job.visibility !== 'everyone') {
    await setVisibility(page, job.visibility, report)
  }
  await setAiLabel(page, job.aiLabel, report)

  if (job.schedule) {
    await setSchedule(page, job.schedule, report)
  }

  if (job.draft) {
    await saveDraft(page, report)
  } else {
    await postVideo(page, report)
  }
}

async function goToUpload(page: Page, report: Reporter): Promise<void> {
  report('Opening the upload page')

  if (page.url() === PATHS.upload) {
    await page.reload()
    page.on('dialog', (dialog) => dialog.accept())
  } else {
    await page.goto(PATHS.upload)
  }

  await page.waitForSelector(SELECTORS.root, { timeout: TIMING.explicitWait })
  await assertSignedIn(page, 'the upload page')
}

async function removeCookiesBanner(page: Page): Promise<void> {
  const button = page
    .locator(`${SELECTORS.cookiesBanner} >> ${SELECTORS.cookiesBannerButton} >> button`)
    .first()

  try {
    if (await button.isVisible({ timeout: 5000 })) {
      await button.click()
    }
  } catch {
    await page
      .evaluate((selector) => document.querySelector(selector)?.remove(), SELECTORS.cookiesBanner)
      .catch(() => {})
  }
}

async function setVideo(page: Page, videoPath: string, report: Reporter): Promise<void> {
  report('Uploading the video file')

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.locator(SELECTORS.uploadVideo).first().setInputFiles(videoPath)

      // a resolution label appears once TikTok has read the file
      await page
        .locator(SELECTORS.processConfirmation)
        .first()
        .waitFor({ state: 'attached', timeout: TIMING.explicitWait })
      return
    } catch (error) {
      if (error instanceof errors.TimeoutError) continue
      throw new UploadError((error as Error).message)
    }
  }

  throw new UploadError('TikTok did not accept the video file')
}

async function removeSplitWindow(page: Page): Promise<void> {
  const window = page.locator(SELECTORS.splitWindow).first()

  if (await window.isVisible({ timeout: TIMING.implicitWait }).catch(() => false)) {
    await window.click()
  }
}

async function dismissOnboardingTour(page: Page): Promise<void> {
  // the tour can have several steps, each dismissed by its own button
  for (let step = 0; step < 5; step++) {
    const button = page.locator(SELECTORS.onboardingTourButton).first()

    if (!(await button.isVisible({ timeout: TIMING.implicitWait }).catch(() => false))) {
      return
    }
    await button.click().catch(() => {})
  }

  await page
    .evaluate(() => document.getElementById('react-joyride-portal')?.remove())
    .catch(() => {})
}

async function setInteractivity(page: Page, job: UploadJob): Promise<void> {
  const toggles: Array<[string, boolean]> = [
    [SELECTORS.comment, job.comment],
    [SELECTORS.stitch, job.stitch],
    [SELECTORS.duet, job.duet]
  ]

  for (const [selector, wanted] of toggles) {
    try {
      const box = page.locator(selector).first()
      const checked = await box.isChecked()
      if (checked !== wanted) await box.click()
    } catch {
      // the toggles are optional in the form, as in the Python package
    }
  }
}

async function setDescription(page: Page, description: string, report: Reporter): Promise<void> {
  if (!description) return
  report('Writing the caption')

  const field = page.locator(SELECTORS.description).first()

  try {
    await field.waitFor({ state: 'visible', timeout: TIMING.implicitWait })
    await field.click()
    await clear(field)
    await field.click()
    await sleep(1000)

    for (const word of description.split(' ')) {
      if (!word) continue

      if (word.startsWith('#')) {
        await field.pressSequentially(word, { delay: 50 })
        await sleep(500)
        await pickHashtag(page, field, word)
      } else if (word.startsWith('@')) {
        await field.pressSequentially(word)
        await sleep(1000)
        await pickMention(page, field, word)
      } else {
        await field.pressSequentially(`${word} `)
      }
    }
  } catch (error) {
    console.warn('Falling back to filling the caption directly:', error)
    await clear(field)
    await field.fill(description)
  }
}

async function pickHashtag(page: Page, field: Locator, word: string): Promise<void> {
  const mentionBox = page.locator(SELECTORS.mentionBox)

  try {
    await mentionBox.first().waitFor({ state: 'visible', timeout: TIMING.addHashtagWait })

    // pressing Enter inserts a line break instead of picking the suggestion,
    // so click the hashtag that matches exactly
    await mentionBox
      .getByText(word, { exact: true })
      .first()
      .click({ timeout: TIMING.addHashtagWait })
  } catch {
    await field.pressSequentially(' ')
  }
}

async function pickMention(page: Page, field: Locator, word: string): Promise<void> {
  const userIds = page.locator(SELECTORS.mentionBoxUserId)

  try {
    await userIds.first().waitFor({ state: 'visible', timeout: 5000 })

    const target = word.slice(1).toLowerCase()
    const count = await userIds.count()

    for (let index = 0; index < count; index++) {
      const candidate = userIds.nth(index)
      if (!(await candidate.isVisible())) continue

      const text = (await candidate.innerText()).split(' ')[0]
      if (text.toLowerCase() !== target) continue

      for (let press = 0; press < index; press++) {
        await field.press('ArrowDown')
      }
      await field.press('Enter')
      return
    }

    await field.pressSequentially(' ')
  } catch {
    await field.pressSequentially(' ')
  }
}

async function clear(locator: Locator): Promise<void> {
  await locator.press('ControlOrMeta+A')
  await locator.press('Backspace')
}

async function setVisibility(
  page: Page,
  visibility: Visibility,
  report: Reporter
): Promise<void> {
  report(`Setting visibility to ${visibility.replace('_', ' ')}`)

  const labels: Record<Visibility, string> = {
    everyone: 'Everyone',
    friends: 'Friends',
    private: 'Only you'
  }

  try {
    await page.locator(SELECTORS.visibilityContainer).first().click()
    await sleep(1500)

    const option = page.locator(
      `//div[@role='option' and contains(., '${labels[visibility]}')]`
    )
    await option.first().scrollIntoViewIfNeeded()
    await sleep(500)
    await option.first().click()
  } catch (error) {
    // as in the Python package, a failed visibility change does not stop the upload
    console.warn('Could not set visibility:', error)
  }
}

async function setAiLabel(page: Page, aiLabel: boolean, report: Reporter): Promise<void> {
  report(`Turning the AI-generated label ${aiLabel ? 'on' : 'off'}`)
  const wanted = aiLabel ? 'checked' : 'unchecked'

  try {
    const showMore = page.locator(SELECTORS.showMore).first()
    if (await showMore.isVisible().catch(() => false)) {
      await showMore.click()
    }

    const toggle = page.locator(SELECTORS.aiLabelSwitch).first()
    if ((await toggle.getAttribute('data-state')) === wanted) return

    await toggle.click()
    if (aiLabel) {
      // turning the label on asks for confirmation first
      await page.locator(SELECTORS.aiLabelConfirm).first().click()
    }

    for (let attempt = 0; attempt < 10; attempt++) {
      if ((await toggle.getAttribute('data-state')) === wanted) return
      await sleep(500)
    }

    throw new Error(`the switch did not change to ${wanted}`)
  } catch (error) {
    // posting realistic AI content unlabeled risks removal, so do not post at all
    throw new UploadError(
      `Failed to set the AI-generated content label: ${(error as Error).message}`
    )
  }
}

async function setSchedule(page: Page, schedule: Date, report: Reporter): Promise<void> {
  report('Scheduling the post')

  try {
    const timeZone = await page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone
    )
    const { month, day, hour, minute } = partsInZone(schedule, timeZone)

    await page.locator(SELECTORS.schedule.switch).first().click()
    await pickDate(page, month, day)
    await pickTime(page, hour, minute)
  } catch (error) {
    throw new UploadError(`Failed to set the schedule: ${(error as Error).message}`)
  }
}

async function pickDate(page: Page, month: number, day: number): Promise<void> {
  await page.locator(SELECTORS.schedule.datePicker).first().click()
  await page.locator(SELECTORS.schedule.calendar).first().waitFor({ state: 'visible' })

  const shown = monthNumber(
    await page.locator(SELECTORS.schedule.calendarMonth).first().innerText()
  )
  if (shown === 0) throw new Error('Could not read the calendar month')

  const steps = calendarSteps(shown, month)
  const arrows = page.locator(SELECTORS.schedule.calendarArrows)

  if (steps === -1) {
    await arrows.first().click()
  } else {
    for (let step = 0; step < steps; step++) await arrows.last().click()
  }

  const days = page.locator(SELECTORS.schedule.calendarValidDays)
  const count = await days.count()
  let picked = false

  for (let index = 0; index < count; index++) {
    const candidate = days.nth(index)
    if (Number(await candidate.innerText()) !== day) continue

    await candidate.click()
    picked = true
    break
  }

  if (!picked) throw new Error(`Day ${day} is not selectable in the calendar`)
  await verifyDate(page, month, day)
}

async function verifyDate(page: Page, month: number, day: number): Promise<void> {
  const selected = await page.locator(SELECTORS.schedule.datePicker).first().innerText()
  const match = selected.match(/([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/)
  if (!match) throw new Error(`Could not read the date picker value: ${selected}`)

  const pickedMonth = monthNumberFromShort(match[1])
  const pickedDay = Number(match[2])

  if (pickedMonth !== month || pickedDay !== day) {
    throw new Error(`Date picker shows ${pickedMonth}-${pickedDay}, expected ${month}-${day}`)
  }
}

async function pickTime(page: Page, hour: number, minute: number): Promise<void> {
  const picker = page.locator(SELECTORS.schedule.timePicker).first()
  await picker.click()
  await page
    .locator(SELECTORS.schedule.timePickerContainer)
    .first()
    .waitFor({ state: 'visible' })

  const hours = page.locator(SELECTORS.schedule.timepickerHours)
  const minutes = page.locator(SELECTORS.schedule.timepickerMinutes)

  // TikTok lists minutes in steps of five
  await hours.nth(hour).scrollIntoViewIfNeeded()
  await sleep(500)
  await hours.nth(hour).click()

  await minutes.nth(Math.floor(minute / 5)).scrollIntoViewIfNeeded()
  await sleep(500)
  await minutes.nth(Math.floor(minute / 5)).click()

  await picker.click()
  await sleep(500)

  await verifyTime(page, hour, minute)
}

async function verifyTime(page: Page, hour: number, minute: number): Promise<void> {
  const selected = await page
    .locator(SELECTORS.schedule.timePickerText)
    .first()
    .innerText()
  const match = selected.match(/(\d{1,2}):(\d{2})/)
  if (!match) throw new Error(`Could not read the time picker value: ${selected}`)

  if (Number(match[1]) !== hour || Number(match[2]) !== minute) {
    throw new Error(
      `Time picker shows ${match[1]}:${match[2]}, expected ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
    )
  }
}

async function postVideo(page: Page, report: Reporter): Promise<void> {
  report('Posting')

  await assertSignedIn(page, 'the post button')

  const post = page.locator(SELECTORS.post).first()
  try {
    // the button stays disabled until the video has finished processing
    for (let attempt = 0; attempt < TIMING.uploadingWait / 2000; attempt++) {
      if ((await post.getAttribute('data-disabled')) === 'false') break
      await sleep(2000)
    }

    await post.scrollIntoViewIfNeeded()
    await post.click()
  } catch {
    await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('.TUXButton--primary')
      button?.click()
    })
  }

  await page
    .locator(SELECTORS.postNow)
    .first()
    .click({ timeout: 5000 })
    .catch(() => {})

  await page
    .locator(SELECTORS.postConfirmation)
    .first()
    .waitFor({ state: 'attached', timeout: TIMING.explicitWait })
}

async function saveDraft(page: Page, report: Reporter): Promise<void> {
  report('Saving as a draft')

  const draft = page.locator(SELECTORS.saveDraft).first()

  // the button stays disabled until the video has finished uploading
  for (let attempt = 0; attempt < TIMING.uploadingWait / 2000; attempt++) {
    if ((await draft.getAttribute('data-disabled')) !== 'true') break
    await sleep(2000)
  }

  await draft.scrollIntoViewIfNeeded()
  await draft.click()

  // the upload form closes once the draft is saved
  await draft.waitFor({ state: 'detached', timeout: TIMING.explicitWait })
}

export const isSupportedVideo = (path: string): boolean => {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension !== undefined && (SUPPORTED_VIDEO_TYPES as readonly string[]).includes(extension)
}
