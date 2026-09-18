import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

describe('check-form-contracts', () => {
  it('passes the dirty modal escape-dismiss guard', () => {
    expect(() => execFileSync(
      process.execPath,
      [path.join(process.cwd(), 'scripts/check-form-contracts.cjs')],
      { cwd: process.cwd(), stdio: 'pipe' },
    )).not.toThrow()
  })
})
