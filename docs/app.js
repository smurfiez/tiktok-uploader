/* ============================================================================
   Copy Buttons (modern-web-guidance: copy-button)
   ========================================================================== */
const copyTimers = new WeakMap()
let lastCopyMessage = ''

function reportCopy(button, ok) {
  const tip = button.nextElementSibling
  if (!tip) return
  clearTimeout(copyTimers.get(button))
  button.removeAttribute('data-copied')
  button.removeAttribute('data-failed')

  let message = ok ? 'Copied' : 'Copy failed'
  if (message === lastCopyMessage) message += '\u00A0'
  lastCopyMessage = message

  tip.textContent = ''
  void button.offsetWidth
  button.setAttribute(ok ? 'data-copied' : 'data-failed', '')
  requestAnimationFrame(() => {
    tip.textContent = message
  })

  copyTimers.set(
    button,
    setTimeout(() => {
      button.removeAttribute('data-copied')
      button.removeAttribute('data-failed')
      tip.textContent = ''
    }, 2000)
  )
}

function legacyCopy(text) {
  const previousFocus = document.activeElement
  const field = Object.assign(document.createElement('textarea'), { value: text })
  field.setAttribute('readonly', '')
  field.style.cssText = 'position:fixed;inset-block-start:0;opacity:0'
  document.body.append(field)
  field.select()
  try {
    return document.execCommand('copy')
  } finally {
    field.remove()
    previousFocus?.focus?.({ preventScroll: true })
  }
}

async function copy(button, target) {
  const text = target.matches('input, textarea') ? target.value : target.innerText.trim()
  if (!text) return
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else if (!legacyCopy(text)) {
      throw new Error('Copy failed')
    }
    reportCopy(button, true)
  } catch {
    if (legacyCopy(text)) {
      reportCopy(button, true)
    } else {
      reportCopy(button, false)
    }
  }
}

if ('CommandEvent' in window) {
  document.addEventListener(
    'command',
    (event) => {
      if (event.command === '--copy') copy(event.source, event.target)
    },
    true
  )
} else {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented) return
    const button = event.target.closest('button[command="--copy"]')
    if (!button) return
    const target = document.getElementById(button.getAttribute('commandfor') ?? '')
    if (target) void copy(button, target)
  })
}

/* ============================================================================
   Accessible Tabs (modern-web-guidance: tabs)
   ========================================================================== */
const hasFocusGroup = Object.hasOwn(HTMLElement.prototype, 'focusGroup')

function initTabs() {
  for (const container of document.querySelectorAll('.tabs')) {
    const tablist = container.querySelector('.tablist')
    if (!tablist) continue
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'))
    const panels = Array.from(container.querySelectorAll(':scope > .tab-panels > [role="tabpanel"]'))

    const selectTab = (selected, moveFocus = false) => {
      for (const tab of tabs) {
        const isSelected = tab === selected
        tab.setAttribute('aria-selected', String(isSelected))
        tab.toggleAttribute('focusgroupstart', isSelected)
        if (!hasFocusGroup) tab.tabIndex = isSelected ? 0 : -1
      }

      for (const panel of panels) {
        const isTarget = panel.getAttribute('aria-labelledby') === selected.id
        if (isTarget) {
          panel.hidden = false
          panel.tabIndex = 0
        } else {
          panel.setAttribute('hidden', 'until-found')
          panel.removeAttribute('tabindex')
        }
      }

      selected.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      if (moveFocus) selected.focus()
    }

    if (!hasFocusGroup) {
      for (const tab of tabs) {
        tab.tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1
      }
      tablist.addEventListener('keydown', (event) => {
        const current = tabs.indexOf(document.activeElement)
        if (current === -1) return
        let next = -1
        if (event.key === 'ArrowRight') next = (current + 1) % tabs.length
        else if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length
        else if (event.key === 'Home') next = 0
        else if (event.key === 'End') next = tabs.length - 1
        if (next === -1) return
        event.preventDefault()
        selectTab(tabs[next], true)
      })
    }

    tablist.addEventListener('click', (event) => {
      const tab = event.target.closest('[role="tab"]')
      if (tab && tabs.includes(tab)) selectTab(tab)
    })

    for (const panel of panels) {
      panel.addEventListener('beforematch', () => {
        const matchingTab = tabs.find((tab) => tab.id === panel.getAttribute('aria-labelledby'))
        if (matchingTab) selectTab(matchingTab)
      })
    }
  }
}

/* ============================================================================
   Exclusive <details name="faq"> fallback
   ========================================================================== */
if (!Object.hasOwn(HTMLDetailsElement.prototype, 'name')) {
  document.addEventListener(
    'toggle',
    (event) => {
      const details = event.target
      if (!(details instanceof HTMLDetailsElement) || !details.open || !details.hasAttribute('name')) return
      const name = CSS.escape(details.getAttribute('name') ?? '')
      for (const other of document.querySelectorAll(`details[name="${name}"]`)) {
        if (other !== details) other.open = false
      }
    },
    { capture: true }
  )
}

/* ============================================================================
   Scroll-Reveal IntersectionObserver Fallback
   ========================================================================== */
function initScrollRevealFallback() {
  if (
    CSS.supports('(animation-timeline: view()) and (animation-range: entry)') ||
    !window.matchMedia('(prefers-reduced-motion: no-preference)').matches
  ) {
    return
  }

  const targets = Array.from(document.querySelectorAll('.reveal'))
  for (const el of targets) {
    el.style.opacity = '0'
    el.style.transform = 'translateY(16px)'
    el.style.transition = 'opacity 0.4s ease, transform 0.4s ease'
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.style.opacity = '1'
        entry.target.style.transform = 'translateY(0)'
        observer.unobserve(entry.target)
      }
    },
    { threshold: 0.12 }
  )

  for (const el of targets) observer.observe(el)
}

/* ============================================================================
   Bulk Schedule Simulator (mirrors packages/core/src/schedule.ts)
   ========================================================================== */
const DURATION_MS = {
  '0m': 0,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '6h': 6 * 3_600_000,
  '12h': 12 * 3_600_000,
  '1d': 24 * 3_600_000,
  '2d': 48 * 3_600_000
}

function roundUpToFive(date) {
  const rounded = new Date(date)
  const remainder = rounded.getUTCMinutes() % 5
  if (remainder !== 0) {
    rounded.setUTCMinutes(rounded.getUTCMinutes() + (5 - remainder), 0, 0)
  } else {
    rounded.setUTCSeconds(0, 0)
  }
  return rounded
}

function parseWindow(windowStr) {
  const [s, e] = windowStr.split('-')
  const [sh, sm] = s.split(':').map(Number)
  const [eh, em] = e.split(':').map(Number)
  return { start: sh * 60 + sm, end: eh * 60 + em }
}

function pushIntoWindow(date, windowStr) {
  if (!windowStr) return date
  const { start, end } = parseWindow(windowStr)
  const minute = date.getHours() * 60 + date.getMinutes()
  const inside = start <= end ? minute >= start && minute <= end : minute >= start || minute <= end
  if (inside) return date

  const pushed = new Date(date)
  const outsideBeforeStart = start > end ? minute > end && minute < start : minute < start
  if (outsideBeforeStart) {
    pushed.setHours(Math.floor(start / 60), start % 60, 0, 0)
  } else {
    pushed.setDate(pushed.getDate() + 1)
    pushed.setHours(Math.floor(start / 60), start % 60, 0, 0)
  }
  return pushed
}

function initSimulator() {
  const countInput = document.getElementById('sim-count')
  const everySelect = document.getElementById('sim-every')
  const jitterSelect = document.getElementById('sim-jitter')
  const windowSelect = document.getElementById('sim-window')
  const regenButton = document.getElementById('sim-regen')
  const slotsList = document.getElementById('sim-slots')
  const summaryEl = document.getElementById('sim-summary')
  const cliCmdEl = document.getElementById('sim-cli-cmd')

  if (!countInput || !everySelect || !jitterSelect || !windowSelect || !slotsList || !summaryEl || !cliCmdEl) {
    return
  }

  const slotFmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })

  const render = () => {
    const rawCount = Number.parseInt(countInput.value, 10)
    const count = Number.isFinite(rawCount) ? Math.min(10, Math.max(1, rawCount)) : 5
    const every = everySelect.value
    const jitter = jitterSelect.value
    const win = windowSelect.value

    const now = new Date()
    const earliest = now.getTime() + 20 * 60_000
    const start = new Date(now)
    start.setDate(start.getDate() + 1)
    start.setHours(18, 0, 0, 0)

    const intervalMs = DURATION_MS[every] ?? DURATION_MS['12h']
    const jitterMs = DURATION_MS[jitter] ?? 0
    const tenDayLimit = now.getTime() + 10 * 24 * 3_600_000

    slotsList.replaceChildren()
    let needsStudio = false

    for (let i = 0; i < count; i++) {
      let ts = start.getTime() + i * intervalMs
      if (jitterMs > 0) ts += (Math.random() * 2 - 1) * jitterMs
      if (ts < earliest) ts = earliest

      let date = roundUpToFive(new Date(ts))
      const shifted = win ? pushIntoWindow(date, win) : date
      const wasPushed = shifted.getTime() !== date.getTime()
      date = shifted

      if (date.getTime() > tenDayLimit) needsStudio = true

      const li = document.createElement('li')
      li.className = 'sim-slot'

      const top = document.createElement('div')
      top.className = 'sim-slot-top'

      const idx = document.createElement('span')
      idx.className = 'sim-slot-idx'
      idx.textContent = `Slot ${String(i + 1).padStart(2, '0')}`
      top.append(idx)

      if (wasPushed) {
        const tag = document.createElement('span')
        tag.className = 'sim-slot-tag'
        tag.textContent = 'Window-shifted'
        top.append(tag)
      }

      const time = document.createElement('div')
      time.className = 'sim-slot-time'
      time.textContent = slotFmt.format(date)

      li.append(top, time)
      slotsList.append(li)
    }

    summaryEl.textContent = `${count} slot${count === 1 ? '' : 's'} · 5-min aligned · ${
      needsStudio ? 'Requires 30-day Studio horizon' : 'Within 10-day standard horizon'
    }`

    const parts = [
      'tiktok-up upload ./clips --account main',
      '--start "tomorrow 18:00"',
      `--every ${every}`
    ]
    if (jitter !== '0m') parts.push(`--jitter ${jitter}`)
    if (win) parts.push(`--window "${win}"`)
    if (needsStudio) parts.push('--max-schedule-days 30')
    cliCmdEl.textContent = parts.join(' ')
  }

  countInput.addEventListener('input', render)
  everySelect.addEventListener('change', render)
  jitterSelect.addEventListener('change', render)
  windowSelect.addEventListener('change', render)
  regenButton?.addEventListener('click', render)
  render()
}

initTabs()
initScrollRevealFallback()
initSimulator()
