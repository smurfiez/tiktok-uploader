import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

/** Paint the saved theme before React mounts so startup never flashes the wrong background. */
async function start(): Promise<void> {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  let theme = media.matches ? 'dark' : 'light'
  try {
    const saved = (await window.api.settings.get()).theme
    if (saved === 'dark' || saved === 'light') theme = saved
  } catch {
    // settings unreadable: the OS preference is a fine fallback
  }
  document.documentElement.dataset.theme = theme
  createRoot(root as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void start()
