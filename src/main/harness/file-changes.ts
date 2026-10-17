import { promises as fs } from 'node:fs'
import path from 'node:path'
import { glob } from 'tinyglobby'
import type { ToolDiff } from '../../shared/types'

// Bound shell observation independently of command output. Never use HEAD as the
// baseline: it would attribute pre-existing user changes to the agent.
const MAX_FILES = 2000
const MAX_BYTES = 8_000_000
const MAX_FILE_BYTES = 100_000

/** Direct write/edit tools already hold full contents; never silently discard them. */
export function toolDiff(
  path: string,
  before: string,
  after: string,
  beforeExists = true
): ToolDiff | undefined {
  return before === after && beforeExists
    ? undefined
    : { path, before, after, beforeExists, afterExists: true }
}

export async function snapshotToolFiles(cwd: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  const files = await glob('**/*', {
    cwd,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**']
  })
  let bytes = 0
  for (const file of files.sort().slice(0, MAX_FILES)) {
    try {
      const abs = path.join(cwd, file)
      const stat = await fs.lstat(abs)
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue
      if (bytes + stat.size > MAX_BYTES) break
      const content = await fs.readFile(abs)
      bytes += content.length
      if (content.includes(0)) continue
      snapshot.set(file, new TextDecoder('utf-8', { fatal: true }).decode(content))
    } catch {
      // A concurrent delete or an unreadable file must not fail the command.
    }
  }
  return snapshot
}

export function diffToolFiles(before: Map<string, string>, after: Map<string, string>): ToolDiff[] {
  const diffs: ToolDiff[] = []
  // Missing entries are not necessarily deletions (size/read/budget limits).
  // Confirm existence separately in observeToolFiles before emitting deletes.
  for (const [file, content] of after) {
    const previous = before.get(file)
    if (previous !== undefined && previous !== content) {
      diffs.push({
        path: file,
        before: previous,
        after: content,
        beforeExists: true,
        afterExists: true
      })
    }
  }
  return diffs
}

export async function observeToolFiles<T>(
  cwd: string,
  run: () => Promise<T>
): Promise<{ result: T; diffs: ToolDiff[] }> {
  const before = await snapshotToolFiles(cwd).catch(() => new Map<string, string>())
  // Keep the inventory distinct from content eligibility, so an unreadable or
  // oversized pre-existing file is never mistaken for a new file.
  const inventory = await glob('**/*', {
    cwd,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/out/**']
  })
    .then((files) => new Set(files))
    .catch(() => null)
  const result = await run()
  const after = await snapshotToolFiles(cwd).catch(() => new Map<string, string>())
  const diffs = diffToolFiles(before, after)
  if (inventory) {
    for (const [file, content] of after) {
      if (!inventory.has(file))
        diffs.push({
          path: file,
          before: '',
          after: content,
          beforeExists: false,
          afterExists: true
        })
    }
    for (const [file, content] of before) {
      try {
        await fs.lstat(path.join(cwd, file))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          diffs.push({
            path: file,
            before: content,
            after: '',
            beforeExists: true,
            afterExists: false
          })
        }
      }
    }
  }
  return { result, diffs }
}
