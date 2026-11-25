/**
 * Port of src/tiktok_uploader/config.toml: paths, waits and Playwright selectors.
 * When TikTok changes its DOM, this is the only file that should need editing.
 */

export const PATHS = {
  main: 'https://www.tiktok.com/',
  login: 'https://www.tiktok.com/login',
  upload: 'https://www.tiktok.com/creator-center/upload?lang=en',
  content: 'https://www.tiktok.com/tiktokstudio/content'
} as const

/** Milliseconds, converted from the seconds in config.toml */
export const TIMING = {
  implicitWait: 30_000,
  explicitWait: 60_000,
  uploadingWait: 180_000,
  addHashtagWait: 5_000
} as const

export const SUPPORTED_VIDEO_TYPES = [
  'mp4',
  'mov',
  'avi',
  'wmv',
  'flv',
  'webm',
  'mkv',
  'm4v',
  '3gp',
  '3g2',
  'gif'
]

/** Feed truncation preview: warn above this */
export const MAX_DESCRIPTION_LENGTH = 150
/** TikTok's hard caption limit */
export const MAX_DESCRIPTION_HARD = 2200

export const SELECTORS = {
  challenge: [
    '#captcha-verify-container',
    'iframe[src*="captcha"]',
    'div[class*="captcha_verify"]',
    'div[class*="Captcha"]'
  ],
  root: '#root',
  description: "//div[@contenteditable='true']",
  uploadVideo: "//input[@type='file']",
  processConfirmation: "//div[contains(@class, 'resolution-label-text')]",

  cookiesBanner: 'tiktok-cookie-banner',
  cookiesBannerButton: 'div.button-wrapper',

  splitWindow: "//button[./div[text()='Not now']]",
  onboardingTourButton: "//div[contains(@class, 'react-joyride__tooltip')]//button",

  mentionBox: "//div[contains(@class, 'mention-list-popover')]",
  mentionBoxUserId: "//span[contains(@class, 'user-id')]",

  comment: "//label[.='Comment']/following-sibling::div/input",
  duet: "//label[.='Duet']/following-sibling::div/input",
  stitch: "//label[.='Stitch']/following-sibling::div/input",

  post: "//button[@data-e2e='post_video_button']",
  saveDraft: "//button[@data-e2e='save_draft_button']",
  showMore: "//*[text()='Show more']",
  aiLabelSwitch:
    "//div[@data-e2e='aigc_container']//div[contains(@class, 'Switch__content')]",
  aiLabelConfirm: "//div[@role='dialog']//button[.='Turn on']",
  postNow: "//button[.//div[text()='Post now']]",
  postConfirmation:
    "//div[contains(text(), 'Your video has been uploaded') or contains(text(), '视频已发布') or contains(text(), 'Video published')]",

  visibilityContainer:
    "//div[@data-e2e='video_visibility_container']//button[@role='combobox']",

  schedule: {
    switch: "//label[.//input[@name='postSchedule' and @value='schedule']]",
    datePicker:
      "//div[contains(@class, 'scheduled-picker')]//div[@role='combobox' and @aria-label='Select date']",
    calendar: "//div[contains(@class, 'DatePicker__panel')]",
    calendarMonth: "//button[contains(@class, 'DatePicker__titleMonth')]",
    calendarValidDays:
      "//button[contains(@class, 'DatePicker__day') and not(@disabled)]",
    calendarArrows: "//button[@aria-label='Previous month' or @aria-label='Next month']",
    timePicker:
      "//div[contains(@class, 'scheduled-picker')]//div[@role='combobox' and @aria-label='Select time']",
    timePickerText:
      "//div[contains(@class, 'scheduled-picker')]//div[@role='combobox' and @aria-label='Select time']",
    timePickerContainer: "//div[contains(@class, 'TimePicker__panel')]",
    timepickerHours:
      "//div[contains(@class, 'TimePicker__panel')]//div[@role='listbox' and @aria-label='Hours']//button[@role='option']",
    timepickerMinutes:
      "//div[contains(@class, 'TimePicker__panel')]//div[@role='listbox' and @aria-label='Minutes']//button[@role='option']"
  },

  library: {
    apiUrlPatterns: [
      '/api/post/item_list',
      '/aweme/v1/creator/item/list',
      '/tiktok/studio/api',
      '/item_list',
      '/item/list',
      '/creator/item'
    ],
    row: '[data-e2e="post-row"], [data-e2e="video-row"], table tbody tr, [class*="video-item"], [class*="post-item"]',
    videoLink: 'a[href*="/video/"]',
    thumbnail: 'img[src]'
  }
} as const
