import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const backendPath = resolve(process.cwd(), '../backend/app/api/far.py')
const source = readFileSync(backendPath, 'utf8')

describe('FAR lifecycle and history backend golden contract', () => {
  it('keeps archive lifecycle separate from editable FAR content and historical restores', () => {
    expect(source).toContain('"version", "is_deleted"')
    expect(source).toContain("if k == 'is_deleted':\n            continue")
    expect(source).toContain('"is_deleted": bool(mode.is_deleted)')
  })

  it('supports inclusive lifecycle reads and explicit idempotent archive/restore routes', () => {
    expect(source).toContain('include_deleted: bool = False')
    expect(source).toContain('if not include_deleted:')
    expect(source).toContain('@router.post("/modes/{mode_id}/restore")')
    expect(source).toContain('@router.post("/modes/bulk-restore")')
    expect(source).toContain('"Archived failure vector"')
    expect(source).toContain('"Restored failure vector"')
    expect(source).not.toContain('@router.delete("/modes/{mode_id}/purge")')
  })

  it('records lifecycle versions and returns structured history deltas', () => {
    expect(source).toContain('build_far_history_delta')
    expect(source).toContain('"previous_version"')
    expect(source).toContain('"changed_fields"')
    expect(source).toContain('"changed_labels"')
    expect(source).toContain('"change_type": change_type')
  })

  it('remains valid Python', () => {
    const result = spawnSync('python3', ['-c', 'import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())', backendPath], { encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
  })
})
