import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { accountsPath, assertAccountId, failuresDir, lockPath } from './paths'
import type { Account, LockInfo } from './types'

export class LockBusyError extends Error {
  constructor(readonly info: LockInfo) {
    super(`Account is locked by ${info.source} (pid ${info.pid})`)
    this.name = 'LockBusyError'
  }
}

export function listAccounts(): Account[] {
  try {
    const parsed = JSON.parse(readFileSync(accountsPath(), 'utf8'))
    return Array.isArray(parsed) ? (parsed as Account[]) : []
  } catch {
    return []
  }
}

function writeAccounts(accounts: Account[]): void {
  mkdirSync(dirname(accountsPath()), { recursive: true, mode: 0o700 })
  writeFileSync(accountsPath(), JSON.stringify(accounts, null, 2) + '\n', 'utf8')
}

export function getAccount(id: string): Account {
  const account = listAccounts().find((candidate) => candidate.id === assertAccountId(id))
  if (!account) throw new Error(`No account "${id}". Run \`tiktok-up accounts add ${id}\``)
  return account
}

export function addAccount(id: string, label?: string): Account {
  assertAccountId(id)
  const accounts = listAccounts()
  const existing = accounts.find((account) => account.id === id)
  if (existing) return existing

  const account: Account = {
    id,
    label: label?.trim() || id,
    createdAt: new Date().toISOString()
  }
  writeAccounts([...accounts, account])
  return account
}

/** Only the display label changes; the id names the profile directory and stays fixed. */
export function setAccountLabel(id: string, label: string): Account {
  const accounts = listAccounts()
  const account = accounts.find((candidate) => candidate.id === assertAccountId(id))
  if (!account) throw new Error(`No account "${id}". Run \`tiktok-up accounts add ${id}\``)

  account.label = label.trim() || id
  writeAccounts(accounts)
  return account
}

export function removeAccount(id: string): void {
  const accounts = listAccounts().filter((account) => account.id !== assertAccountId(id))
  writeAccounts(accounts)
  rmSync(dirname(lockPath(id)), { recursive: true, force: true })
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to another user
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export function readLock(accountId: string): LockInfo | null {
  try {
    const info = JSON.parse(readFileSync(lockPath(accountId), 'utf8')) as LockInfo
    return isPidAlive(info.pid) ? info : null
  } catch {
    return null
  }
}

/**
 * Playwright cannot open the same browser profile from two processes, so each
 * account gets a PID lockfile created with O_EXCL. A dead owner's lock is
 * reclaimed; a live owner's lock raises LockBusyError.
 */
export function acquireLock(accountId: string, source: string): LockInfo {
  const file = lockPath(accountId)
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })

  const info: LockInfo = {
    pid: process.pid,
    source,
    startedAt: new Date().toISOString()
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(file, JSON.stringify(info), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
      return info
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error

      const existing = readLock(accountId)
      if (existing) throw new LockBusyError(existing)
      rmSync(file, { force: true })
    }
  }

  throw new Error(`Could not acquire the lock for account "${accountId}"`)
}

export function releaseLock(accountId: string): void {
  const info = readLock(accountId)
  // only the owner removes the lock, so a crashed process's lock still protects us
  if (!info || info.pid !== process.pid) return
  rmSync(lockPath(accountId), { force: true })
}

export const lockStatus = (accountId: string): LockInfo | null => {
  try {
    return readLock(accountId)
  } catch {
    return null
  }
}

export const ensureFailuresDir = (accountId: string): string => {
  const dir = failuresDir(accountId)
  mkdirSync(dir, { recursive: true })
  return dir
}

export const accountExists = (id: string): boolean =>
  existsSync(dirname(lockPath(id)))
