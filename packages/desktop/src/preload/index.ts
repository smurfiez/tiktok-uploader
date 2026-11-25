import { contextBridge, ipcRenderer, webUtils } from 'electron'

import type { IpcRendererEvent } from 'electron'

import type { Job, QueueEvent, Settings, StaggerRule } from '@tiktok-uploader/core'

import type { TiktokApi } from './index.d'

const api: TiktokApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch)
  },
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: (input: { id: string; label: string }) => ipcRenderer.invoke('accounts:add', input),
    label: (input: { id: string; label: string }) => ipcRenderer.invoke('accounts:label', input),
    remove: (accountId: string) => ipcRenderer.invoke('accounts:remove', accountId)
  },
  auth: {
    status: (accountId: string) => ipcRenderer.invoke('auth:status', accountId),
    login: (accountId: string) => ipcRenderer.invoke('auth:login', accountId),
    importCookies: (accountId: string) => ipcRenderer.invoke('auth:import-cookies', accountId),
    exportCookies: (accountId: string) => ipcRenderer.invoke('auth:export-cookies', accountId)
  },
  videos: {
    pick: () => ipcRenderer.invoke('videos:pick'),
    pickFolder: () => ipcRenderer.invoke('videos:pick-folder'),
    list: (directory: string) => ipcRenderer.invoke('videos:list', directory)
  },
  schedule: {
    stagger: (count: number, rule: StaggerRule) =>
      ipcRenderer.invoke('schedule:stagger', { count, rule })
  },
  queue: {
    load: (accountId: string) => ipcRenderer.invoke('queue:load', accountId),
    save: (accountId: string, jobs: Job[]) =>
      ipcRenderer.invoke('queue:save', { accountId, jobs }),
    start: (input: { accountId: string; jobs: Job[]; headed?: boolean }) =>
      ipcRenderer.invoke('queue:start', input),
    stop: (accountId: string) => ipcRenderer.invoke('queue:stop', accountId)
  },
  events: {
    onQueue: (callback: (event: QueueEvent) => void) => {
      const listener = (_event: IpcRendererEvent, payload: QueueEvent): void => callback(payload)
      ipcRenderer.on('queue:event', listener)
      return () => {
        ipcRenderer.removeListener('queue:event', listener)
      }
    }
  },
  files: {
    getPathForFile: (file: File) => webUtils.getPathForFile(file)
  },
  reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path)
}

contextBridge.exposeInMainWorld('api', api)
