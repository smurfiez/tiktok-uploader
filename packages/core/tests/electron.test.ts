import { Script } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { ELECTRON_MAIN_SCRIPT } from '../src/uploader/electron'

describe('ELECTRON_MAIN_SCRIPT', () => {
  // a typo here only shows up as a silent spawn failure, so keep it parseable
  it('is valid JavaScript', () => {
    expect(() => new Script(ELECTRON_MAIN_SCRIPT)).not.toThrow()
  })
})
