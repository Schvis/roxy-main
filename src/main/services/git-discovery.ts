import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isScannableDir } from '../../shared/repos'

const SCAN_TTL_MS = 30_000
const MAX_SCAN_DIRECTORIES = 10_000
const scans = new Map<string, { at: number; roots: string[] }>()

/** Find Git markers without following symlinks or entering dependency/build folders. */
export async function discoverGitDirectories(root: string, force = false): Promise<string[]> {
  if (!root) return []
  const cached = scans.get(root)
  if (!force && cached && Date.now() - cached.at < SCAN_TTL_MS) return cached.roots

  const roots: string[] = []
  const queue = [path.resolve(root)]
  for (let index = 0; index < queue.length && index < MAX_SCAN_DIRECTORIES; index++) {
    const directory = queue[index]
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true })
      if (
        entries.some((entry) => entry.name === '.git' && (entry.isDirectory() || entry.isFile()))
      ) {
        roots.push(directory)
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (queue.length >= MAX_SCAN_DIRECTORIES) break
        if (entry.isDirectory() && isScannableDir(entry.name)) {
          queue.push(path.join(directory, entry.name))
        }
      }
    } catch {
      // Deleted or unreadable folders must not hide other repositories.
    }
  }
  if (scans.size >= 100) scans.delete(scans.keys().next().value!)
  scans.set(root, { at: Date.now(), roots })
  return roots
}
