import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { assertAccountId, lockPath } from '../src/paths'
import {
  acquireLock,
  addAccount,
  createAccount,
  generateAccountId,
  getAccount,
  listAccounts,
  LockBusyError,
  readLock,
  releaseLock,
  removeAccount,
  setAccountLabel
} from '../src/profiles'

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.TIKTOK_UPLOADER_HOME
  home = mkdtempSync(join(tmpdir(), 'tiktok-profiles-'))
  process.env.TIKTOK_UPLOADER_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.TIKTOK_UPLOADER_HOME
  else process.env.TIKTOK_UPLOADER_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

describe('accounts', () => {
  it('starts empty', () => {
    expect(listAccounts()).toEqual([])
  })

  it('adds, reads, lists and removes accounts', () => {
    const added = addAccount('main', ' Brand Main ')
    expect(added.id).toBe('main')
    expect(added.label).toBe('Brand Main')
    expect(added.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    addAccount('second')
    expect(listAccounts().map((account) => account.id)).toEqual(['main', 'second'])
    expect(getAccount('second').label).toBe('second')

    removeAccount('main')
    expect(listAccounts().map((account) => account.id)).toEqual(['second'])
    expect(() => getAccount('main')).toThrow(/No account "main"/)
  })

  it('updates only the label', () => {
    addAccount('main', 'Brand Main')
    expect(setAccountLabel('main', ' Renamed ').label).toBe('Renamed')
    expect(getAccount('main')).toMatchObject({ id: 'main', label: 'Renamed' })
    expect(setAccountLabel('main', '  ').label).toBe('main')
    expect(() => setAccountLabel('missing', 'x')).toThrow(/No account "missing"/)
  })

  it('is idempotent for an existing id', () => {
    addAccount('main', 'First')
    expect(addAccount('main', 'Second').label).toBe('First')
    expect(listAccounts()).toHaveLength(1)
  })

  it('removes the account directory too', () => {
    addAccount('main')
    acquireLock('main', 'test')
    removeAccount('main')
    expect(readLock('main')).toBeNull()
  })
})

describe('generateAccountId', () => {
  it('slugifies a label', () => {
    expect(generateAccountId('Brand Main!', [])).toBe('brand-main')
    expect(generateAccountId('  Brand  Main  ', [])).toBe('brand-main')
  })

  it('suffixes a colliding slug', () => {
    expect(generateAccountId('brand-main', ['brand-main'])).toBe('brand-main-2')
    expect(generateAccountId('brand-main', ['brand-main', 'brand-main-2'])).toBe('brand-main-3')
  })

  it('falls back to "account" for a non-ASCII label', () => {
    expect(generateAccountId('🚀', [])).toBe('account')
    expect(generateAccountId('🚀', ['account'])).toBe('account-2')
  })

  it('always produces an id that assertAccountId accepts', () => {
    const id = generateAccountId('  日本語 '.repeat(20), [])
    expect(() => assertAccountId(id)).not.toThrow()
  })
})

describe('createAccount', () => {
  it('creates an account from a label and avoids collisions', () => {
    const first = createAccount('Brand Main!')
    expect(first).toMatchObject({ id: 'brand-main', label: 'Brand Main!' })

    const second = createAccount('Brand Main!')
    expect(second.id).toBe('brand-main-2')
    expect(listAccounts().map((account) => account.id)).toEqual(['brand-main', 'brand-main-2'])
  })

  it('throws for a blank label', () => {
    expect(() => createAccount('   ')).toThrow('Account name is required')
  })
})

describe('assertAccountId', () => {
  it('rejects path traversal and unsafe ids', () => {
    expect(() => assertAccountId('../x')).toThrow(/Invalid account id/)
    expect(() => assertAccountId('a/b')).toThrow(/Invalid account id/)
    expect(() => assertAccountId('')).toThrow(/Invalid account id/)
    expect(() => assertAccountId('a'.repeat(65))).toThrow(/Invalid account id/)
  })

  it('accepts letters, digits, dot, dash and underscore', () => {
    expect(assertAccountId('brand-2.main_ok')).toBe('brand-2.main_ok')
  })
})

describe('acquireLock', () => {
  it('creates a lock owned by this process', () => {
    const info = acquireLock('main', 'queue')
    expect(info.pid).toBe(process.pid)
    expect(info.source).toBe('queue')
    expect(info.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    const stored = JSON.parse(readFileSync(lockPath('main'), 'utf8'))
    expect(stored.pid).toBe(process.pid)
    expect(readLock('main')?.pid).toBe(process.pid)
  })

  it('throws LockBusyError for a second acquisition by a live owner', () => {
    acquireLock('main', 'queue')
    expect(() => acquireLock('main', 'cli')).toThrow(LockBusyError)
    try {
      acquireLock('main', 'cli')
    } catch (error) {
      expect((error as LockBusyError).info.pid).toBe(process.pid)
      expect((error as LockBusyError).info.source).toBe('queue')
    }
  })

  it('throws LockBusyError when another live process holds the lock', () => {
    mkdirSync(join(home, 'profiles', 'main'), { recursive: true })
    writeFileSync(
      lockPath('main'),
      JSON.stringify({ pid: process.ppid, source: 'desktop', startedAt: new Date(0).toISOString() })
    )

    expect(() => acquireLock('main', 'queue')).toThrow(LockBusyError)
  })

  it('reclaims a lock left by a dead pid', () => {
    mkdirSync(join(home, 'profiles', 'main'), { recursive: true })
    writeFileSync(
      lockPath('main'),
      JSON.stringify({ pid: 999999, source: 'crashed', startedAt: new Date(0).toISOString() })
    )
    expect(readLock('main')).toBeNull()

    const info = acquireLock('main', 'queue')
    expect(info.pid).toBe(process.pid)
    expect(JSON.parse(readFileSync(lockPath('main'), 'utf8')).pid).toBe(process.pid)
  })
})

describe('releaseLock', () => {
  it('removes the owner lock', () => {
    acquireLock('main', 'test')
    releaseLock('main')
    expect(readLock('main')).toBeNull()
  })

  it('leaves a lock held by another pid alone', () => {
    mkdirSync(join(home, 'profiles', 'main'), { recursive: true })
    writeFileSync(
      lockPath('main'),
      JSON.stringify({ pid: process.ppid, source: 'desktop', startedAt: new Date(0).toISOString() })
    )

    releaseLock('main')

    expect(JSON.parse(readFileSync(lockPath('main'), 'utf8')).pid).toBe(process.ppid)
  })

  it('is a no-op when there is no lock', () => {
    expect(() => releaseLock('main')).not.toThrow()
  })
})
