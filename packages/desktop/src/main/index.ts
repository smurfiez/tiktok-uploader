import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { app, BrowserWindow, nativeTheme, session } from 'electron'

import { loadSettings } from '@tiktok-uploader/core'

import type { ThemeMode } from '@tiktok-uploader/core'

import { dispose, registerIpc } from './ipc'

const rendererUrl = process.env.ELECTRON_RENDERER_URL
const iconPath = join(__dirname, '../../build/icon.png')
const LIGHT_BG = '#f5f6f8'
const DARK_BG = '#0f1014'
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"

let window: BrowserWindow | null = null

function resolveBg(theme?: ThemeMode): string {
  if (theme === 'light') return LIGHT_BG
  if (theme === 'dark') return DARK_BG
  return nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG
}

/** Only TikTok itself and the electron-vite dev server may be navigated to. */
function isAllowedTarget(raw: string): boolean {
  try {
    const target = new URL(raw)
    if (
      target.protocol === 'https:' &&
      (target.hostname === 'tiktok.com' || target.hostname.endsWith('.tiktok.com'))
    ) {
      return true
    }
    if (rendererUrl) {
      const dev = new URL(rendererUrl)
      return target.origin === dev.origin
    }
    return false
  } catch {
    return false
  }
}

function applyCsp(): void {
  if (rendererUrl) return // the dev server needs its own http/ws origins

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP]
      }
    })
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: resolveBg(loadSettings().theme),
    show: false,
    title: 'TikTok Uploader',
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => {
    window = null
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedTarget(url)) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const loaded = rendererUrl
    ? win.loadURL(rendererUrl)
    : win.loadFile(join(__dirname, '../renderer/index.html'))
  loaded.catch((error) => console.error('Failed to load the renderer', error))

  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(() => {
    nativeTheme.themeSource = loadSettings().theme ?? 'system'
    if (process.platform === 'darwin' && existsSync(iconPath)) app.dock?.setIcon(iconPath)
    applyCsp()
    registerIpc(() => window)
    window = createWindow()

    // keeps the window chrome in step with the OS while the theme is 'system'
    nativeTheme.on('updated', () => {
      if (loadSettings().theme !== 'system') return
      if (window && !window.isDestroyed()) window.setBackgroundColor(resolveBg('system'))
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) window = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => dispose())
}
