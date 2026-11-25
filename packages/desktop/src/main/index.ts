import { join } from 'node:path'

import { app, BrowserWindow, session } from 'electron'

import { dispose, registerIpc } from './ipc'

const rendererUrl = process.env.ELECTRON_RENDERER_URL
const BACKGROUND = '#111014'
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"

let window: BrowserWindow | null = null

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
    width: 1200,
    height: 820,
    minWidth: 940,
    minHeight: 640,
    backgroundColor: BACKGROUND,
    show: false,
    title: 'TikTok Uploader',
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
    applyCsp()
    registerIpc(() => window)
    window = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) window = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => dispose())
}
