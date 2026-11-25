import { contextBridge, ipcRenderer, webUtils } from 'electron'

import type { IpcRendererEvent } from 'electron'

import type {
  AccountPatch,
  Job,
  QueueEvent,
  Settings,
  StaggerRule
} from '@tiktok-uploader/core'

import type { TiktokApi } from './index.d'

const api: TiktokApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch: Partial<Settings>) => ipcRenderer.invoke('settings:set', patch)
  },
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: (input: { id?: string; label: string }) => ipcRenderer.invoke('accounts:add', input),
    label: (input: { id: string; label: string }) => ipcRenderer.invoke('accounts:label', input),
    update: (input: { id: string; patch: AccountPatch }) =>
      ipcRenderer.invoke('accounts:update', input),
    remove: (accountId: string) => ipcRenderer.invoke('accounts:remove', accountId)
  },
  auth: {
    status: (accountId: string) => ipcRenderer.invoke('auth:status', accountId),
    login: (accountId: string) => ipcRenderer.invoke('auth:login', accountId),
    importCookies: (accountId: string) => ipcRenderer.invoke('auth:import-cookies', accountId),
    importCookiesText: (input: { accountId: string; text: string }) =>
      ipcRenderer.invoke('auth:import-cookies-text', input),
    exportCookies: (accountId: string) => ipcRenderer.invoke('auth:export-cookies', accountId)
  },
  videos: {
    pick: () => ipcRenderer.invoke('videos:pick'),
    pickFolder: () => ipcRenderer.invoke('videos:pick-folder'),
    list: (directory: string, options?: { recursive?: boolean }) =>
      ipcRenderer.invoke('videos:list', directory, options)
  },
  schedule: {
    stagger: (count: number, rule: StaggerRule) =>
      ipcRenderer.invoke('schedule:stagger', { count, rule })
  },
  queue: {
    load: (accountId: string) => ipcRenderer.invoke('queue:load', accountId),
    save: (accountId: string, jobs: Job[]) =>
      ipcRenderer.invoke('queue:save', { accountId, jobs }),
    append: (input: { accountId: string; jobs: Job[] }) => ipcRenderer.invoke('queue:append', input),
    start: (input: { accountId: string; jobs: Job[]; headed?: boolean }) =>
      ipcRenderer.invoke('queue:start', input),
    startAll: (input: { accountIds: string[]; headed?: boolean }) =>
      ipcRenderer.invoke('queue:start-all', input),
    stop: (accountId: string) => ipcRenderer.invoke('queue:stop', accountId)
  },
  library: {
    load: (accountId: string) => ipcRenderer.invoke('library:load', accountId),
    sync: (accountId: string) => ipcRenderer.invoke('library:sync', accountId)
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
  reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url)
}

contextBridge.exposeInMainWorld('api', api)
