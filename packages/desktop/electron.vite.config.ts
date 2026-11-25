import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { externalizeDepsPlugin } from 'electron-vite'
import { defineConfig } from 'electron-vite'

const core = resolve(__dirname, '../core/src/index.ts')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@tiktok-uploader/core'] })],
    resolve: { alias: { '@tiktok-uploader/core': core } }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@tiktok-uploader/core'] })],
    resolve: { alias: { '@tiktok-uploader/core': core } }
  },
  renderer: {
    plugins: [react()]
  }
})
