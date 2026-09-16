import { constants, watch, type FSWatcher } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import {
  open,
  readdir,
  readFile,
  realpath,
  stat,
  rename,
  unlink,
  mkdir,
  rm,
  writeFile
} from 'node:fs/promises'
import path from 'node:path'
import { TextDecoder } from 'node:util'
import ts from 'typescript'
import { glob } from 'tinyglobby'
import type {
  WorkspaceFileCreateResult,
  WorkspaceFileDiagnostic,
  WorkspaceFileEntry,
  WorkspaceFileRead,
  WorkspaceFileRenameResult,
  WorkspaceFileReplaceResult,
  WorkspaceFileSearchMatch,
  WorkspaceFileSearchOptions,
  WorkspaceFileWrite
} from '../../shared/api'

export const MAX_FILE_BYTES = 512 * 1024

function revision(root: string, target: string, bytes: Buffer): string {
  return createHash('sha256')
    .update(JSON.stringify([root, target]))
    .update('\0')
    .update(bytes)
    .digest('hex')
}

const writes = new Map<string, Promise<unknown>>()

function assertContained(root: string, target: string): void {
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Path outside workspace')
  }
}

async function resolveTarget(
  root: string,
  requested: string
): Promise<{
  root: string
  lexical: string
  realRoot: string
  target: string
}> {
  if (
    !root ||
    !path.isAbsolute(root) ||
    typeof requested !== 'string' ||
    requested.includes('\0')
  ) {
    throw new Error('Invalid workspace path')
  }
  root = path.resolve(root)
  const lexical = path.resolve(root, requested)
  assertContained(root, lexical)
  // Reject NTFS alternate data streams, including on an otherwise contained file.
  if (process.platform === 'win32' && path.relative(root, lexical).includes(':')) {
    throw new Error('Invalid workspace path')
  }
  const realRoot = await realpath(root)
  const target = await realpath(lexical)
  assertContained(realRoot, target)
  return { root, lexical, realRoot, target }
}

async function resolveNewTarget(
  root: string,
  requested: string
): Promise<{
  root: string
  lexical: string
  realRoot: string
}> {
  if (
    !root ||
    !path.isAbsolute(root) ||
    typeof requested !== 'string' ||
    requested.includes('\0')
  ) {
    throw new Error('Invalid workspace path')
  }
  root = path.resolve(root)
  const lexical = path.resolve(root, requested)
  assertContained(root, lexical)
  if (process.platform === 'win32' && path.relative(root, lexical).includes(':')) {
    throw new Error('Invalid workspace path')
  }
  const realRoot = await realpath(root)
  let cur = path.dirname(lexical)
  while (cur !== root && cur.startsWith(root)) {
    try {
      const realCur = await realpath(cur)
      assertContained(realRoot, realCur)
      break
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'ENOENT') {
        cur = path.dirname(cur)
      } else {
        throw err
      }
    }
  }
  return { root, lexical, realRoot }
}

interface WorkspaceWatcher {
  watcher: FSWatcher
  timer: NodeJS.Timeout | null
}

const activeWatchers = new Map<string, WorkspaceWatcher>()
const changeListeners = new Set<(root: string) => void>()

export function onWorkspaceFilesChanged(listener: (root: string) => void): () => void {
  changeListeners.add(listener)
  return () => {
    changeListeners.delete(listener)
  }
}

export function notifyWorkspaceFilesChanged(root: string): void {
  for (const listener of changeListeners) {
    try {
      listener(root)
    } catch {}
  }
}

const WATCH_IGNORE_PATTERNS = [
  /^[\\/]?\.git([\\/]|$)/i,
  /^[\\/]?node_modules([\\/]|$)/i,
  /^[\\/]?\.next([\\/]|$)/i,
  /^[\\/]?dist([\\/]|$)/i,
  /^[\\/]?out([\\/]|$)/i,
  /^[\\/]?build([\\/]|$)/i,
  /\.roxy-save-/i,
  /\.tmp$/i
]

function shouldIgnoreWatchFilename(filename: string | null): boolean {
  if (!filename) return false
  const normalized = filename.split(path.sep).join('/')
  return WATCH_IGNORE_PATTERNS.some((p) => p.test(normalized))
}

export async function watchWorkspace(root: string): Promise<() => void> {
  if (!root || !path.isAbsolute(root)) return () => {}
  let realRoot: string
  try {
    realRoot = await realpath(root)
  } catch {
    return () => {}
  }

  if (activeWatchers.has(realRoot)) {
    return () => {}
  }

  try {
    const watcher = watch(realRoot, { recursive: true }, (_eventType, filename) => {
      if (typeof filename === 'string' && shouldIgnoreWatchFilename(filename)) {
        return
      }
      const current = activeWatchers.get(realRoot)
      if (!current) return
      if (current.timer) clearTimeout(current.timer)
      current.timer = setTimeout(() => {
        current.timer = null
        notifyWorkspaceFilesChanged(realRoot)
      }, 200)
    })
    watcher.on('error', () => {
      // Suppress watcher errors
    })
    activeWatchers.set(realRoot, { watcher, timer: null })
  } catch {
    return () => {}
  }

  return () => {
    const cur = activeWatchers.get(realRoot)
    if (!cur) return
    if (cur.timer) clearTimeout(cur.timer)
    try {
      cur.watcher.close()
    } catch {}
    activeWatchers.delete(realRoot)
  }
}

/** Direct children only. Symlinks, junctions and special files are not listed. */
export async function listWorkspaceFiles(
  root: string,
  requested: string
): Promise<WorkspaceFileEntry[]> {
  const resolved = await resolveTarget(root, requested)
  const entries = await readdir(resolved.target, { withFileTypes: true })
  return entries
    .filter((entry) => !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()))
    .map((entry) => ({
      name: entry.name,
      path: path
        .relative(resolved.root, path.join(resolved.lexical, entry.name))
        .split(path.sep)
        .join('/'),
      directory: entry.isDirectory()
    }))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name))
}

/** Bounded preview. In-root symlink targets are allowed for direct reads. */
export async function readWorkspaceFile(
  root: string,
  requested: string
): Promise<WorkspaceFileRead> {
  const resolved = await resolveTarget(root, requested)
  if (!(await stat(resolved.target)).isFile()) throw new Error('Not a regular file')
  const handle = await open(
    resolved.target,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  )
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('Not a regular file')
    // Recheck containment and identity after opening, before reading any bytes.
    const current = await realpath(resolved.lexical)
    assertContained(resolved.realRoot, current)
    const currentInfo = await stat(current)
    if (
      current !== resolved.target ||
      currentInfo.dev !== info.dev ||
      currentInfo.ino !== info.ino
    ) {
      throw new Error('Workspace file changed')
    }
    const buffer = Buffer.alloc(Math.min(info.size, MAX_FILE_BYTES))
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    const after = await handle.stat()
    const truncated = info.size > length || after.size > length
    const stable =
      info.size === after.size && info.mtimeMs === after.mtimeMs && info.ctimeMs === after.ctimeMs
    const bytes = buffer.subarray(0, length)
    // NUL/control bytes or invalid UTF-8 indicate binary data. UTF-16 is binary here.
    let binary = bytes.some(
      (byte) => byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13
    )
    let content = ''
    if (!binary) {
      try {
        // A bounded prefix may end mid-codepoint; do not emit a replacement character.
        content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes, {
          stream: truncated
        })
      } catch {
        binary = true
      }
    }
    return {
      content,
      truncated,
      binary,
      revision:
        binary || truncated || !stable ? null : revision(resolved.realRoot, resolved.target, bytes)
    }
  } finally {
    await handle.close()
  }
}

/** Existing complete UTF-8 files only. Serialized within this main process, by real target.
 * Node has no portable filesystem compare-and-swap or descriptor-relative rename:
 * external writers/path swaps in the final check-to-rename window cannot be excluded.
 * Rename replaces the inode; hardlink aliases, ACLs and extended attributes are not preserved.
 */
export async function writeWorkspaceFile(
  root: string,
  requested: string,
  content: string,
  expectedRevision: string
): Promise<WorkspaceFileWrite> {
  if (
    typeof content !== 'string' ||
    typeof expectedRevision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(expectedRevision)
  ) {
    throw new Error('Invalid workspace write')
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES)
    throw new Error('Workspace file exceeds 512 KiB')
  const bytes = Buffer.from(content, 'utf8')
  if (
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) !== content ||
    bytes.some((byte) => byte < 32 && byte !== 9 && byte !== 10 && byte !== 12 && byte !== 13)
  ) {
    throw new Error('Workspace content must be UTF-8 text')
  }
  const resolved = await resolveTarget(root, requested)
  const previous = writes.get(resolved.target) ?? Promise.resolve()
  const operation = previous
    .catch(() => {})
    .then(async (): Promise<WorkspaceFileWrite> => {
      const current = await resolveTarget(root, requested)
      if (current.target !== resolved.target || current.realRoot !== resolved.realRoot)
        return { status: 'conflict' }
      const original = await stat(resolved.target)
      if (!original.isFile()) throw new Error('Not a regular file')
      const initial = await readWorkspaceFile(root, requested)
      if (initial.revision !== expectedRevision) return { status: 'conflict' }
      const parent = path.dirname(resolved.target)
      const parentInfo = await stat(parent)
      const temp = path.join(parent, `.roxy-save-${randomUUID()}.tmp`)
      let created = false
      try {
        const handle = await open(
          temp,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
          0o600
        )
        created = true
        try {
          await handle.writeFile(bytes)
          await handle.chmod(original.mode & 0o7777)
          await handle.sync()
        } finally {
          await handle.close()
        }
        // Recheck both path bindings and bytes immediately before replacing the target.
        const check = await resolveTarget(root, requested)
        const latest = await readWorkspaceFile(root, requested)
        const info = await stat(resolved.target)
        const directory = await stat(parent)
        if (
          check.target !== resolved.target ||
          check.realRoot !== resolved.realRoot ||
          (await realpath(parent)) !== parent ||
          directory.dev !== parentInfo.dev ||
          directory.ino !== parentInfo.ino ||
          info.dev !== original.dev ||
          info.ino !== original.ino ||
          info.mode !== original.mode ||
          info.mtimeMs !== original.mtimeMs ||
          info.ctimeMs !== original.ctimeMs ||
          latest.revision !== expectedRevision
        )
          return { status: 'conflict' }
        await rename(temp, resolved.target)
        created = false
        notifyWorkspaceFilesChanged(resolved.realRoot)
        return { status: 'saved', revision: revision(resolved.realRoot, resolved.target, bytes) }
      } finally {
        if (created) await unlink(temp)
      }
    })
  writes.set(resolved.target, operation)
  try {
    return await operation
  } finally {
    if (writes.get(resolved.target) === operation) writes.delete(resolved.target)
  }
}

/** Delete a workspace file or directory recursively. */
export async function deleteWorkspaceFile(root: string, requested: string): Promise<boolean> {
  const resolved = await resolveTarget(root, requested)
  if (resolved.target === resolved.realRoot) {
    throw new Error('Cannot delete workspace root')
  }
  try {
    await rm(resolved.target, { recursive: true, force: true })
    notifyWorkspaceFilesChanged(resolved.realRoot)
    return true
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    if (code === 'ENOENT') return true
    throw err
  }
}

/** Create a workspace file or directory. */
export async function createWorkspaceFile(
  root: string,
  requested: string,
  isDirectory = false
): Promise<WorkspaceFileCreateResult> {
  const resolved = await resolveNewTarget(root, requested)
  if (resolved.lexical === resolved.realRoot || resolved.lexical === resolved.root) {
    throw new Error('Cannot create workspace root')
  }
  try {
    await stat(resolved.lexical)
    throw new Error('File or directory already exists')
  } catch (err: unknown) {
    if ((err as { code?: string })?.code !== 'ENOENT') {
      throw err
    }
  }
  const parent = path.dirname(resolved.lexical)
  await mkdir(parent, { recursive: true })
  if (isDirectory) {
    await mkdir(resolved.lexical, { recursive: true })
  } else {
    await writeFile(resolved.lexical, '', { encoding: 'utf8', flag: 'wx' })
  }
  const relPath = path.relative(resolved.realRoot, resolved.lexical).split(path.sep).join('/')
  notifyWorkspaceFilesChanged(resolved.realRoot)
  return { success: true, path: relPath }
}

/** Rename or move a workspace file or directory. */
export async function renameWorkspaceFile(
  root: string,
  oldRequested: string,
  newRequested: string
): Promise<WorkspaceFileRenameResult> {
  const oldResolved = await resolveTarget(root, oldRequested)
  if (oldResolved.target === oldResolved.realRoot) {
    throw new Error('Cannot rename workspace root')
  }
  const newResolved = await resolveNewTarget(root, newRequested)
  if (newResolved.lexical === newResolved.realRoot || newResolved.lexical === newResolved.root) {
    throw new Error('Cannot rename to workspace root')
  }
  try {
    await stat(newResolved.lexical)
    throw new Error('Target already exists')
  } catch (err: unknown) {
    if ((err as { code?: string })?.code !== 'ENOENT') {
      throw err
    }
  }
  const newParent = path.dirname(newResolved.lexical)
  await mkdir(newParent, { recursive: true })
  await rename(oldResolved.target, newResolved.lexical)
  const relPath = path.relative(newResolved.realRoot, newResolved.lexical).split(path.sep).join('/')
  notifyWorkspaceFilesChanged(newResolved.realRoot)
  return { success: true, newPath: relPath }
}

const IGNORED_DIAGNOSTIC_CODES = new Set([
  6307, // File is not listed within the file list of project
  6305, // Output file has not been built from source file
  6306, // File is part of a project reference cycle
  5055, // Cannot write file because it would overwrite input file
  5056, // Cannot write file because it will overwrite input file
  5083, // Cannot read file
  6133, // Variable is declared but its value is never read
  6192, // All imports in import declaration are unused
  6196, // All variables are unused
  2688 // Cannot find type definition file
])

export async function getWorkspaceFileDiagnostics(
  root: string,
  requested: string,
  content: string
): Promise<WorkspaceFileDiagnostic[]> {
  const resolved = await resolveTarget(root, requested)
  if (content.length > 500_000 || content.split('\n').length > 10_000) return []

  const isJsTs = /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(resolved.lexical)
  const isJson = /\.json$/i.test(resolved.lexical)

  if (isJson) {
    const source = ts.parseJsonText(resolved.lexical.replace(/\\/g, '/'), content)
    const diagnostics =
      (source as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? []
    return diagnostics.map((d) => {
      const start = d.start ?? 0
      const pos = source.getLineAndCharacterOfPosition(start)
      return {
        line: pos.line + 1,
        column: pos.character + 1,
        start,
        length: d.length ?? 0,
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, '\n')
      }
    })
  }

  if (!isJsTs) return []

  const targetAbs = resolved.target
  const dir = path.dirname(targetAbs)

  let configPath = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.web.json')
  if (!configPath || !configPath.toLowerCase().startsWith(resolved.realRoot.toLowerCase())) {
    configPath = ts.findConfigFile(dir, ts.sys.fileExists, 'tsconfig.json')
  }

  let compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true
  }

  if (configPath && configPath.toLowerCase().startsWith(resolved.realRoot.toLowerCase())) {
    try {
      const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        path.dirname(configPath)
      )
      compilerOptions = {
        ...compilerOptions,
        ...parsed.options,
        noEmit: true,
        skipLibCheck: true
      }
    } catch {}
  }

  const baseHost = ts.createCompilerHost(compilerOptions)
  const host: ts.CompilerHost = {
    ...baseHost,
    getSourceFile: (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      if (path.resolve(fileName).toLowerCase() === targetAbs.toLowerCase()) {
        return ts.createSourceFile(fileName, content, languageVersion, true)
      }
      return baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
    },
    readFile: (fileName) => {
      if (path.resolve(fileName).toLowerCase() === targetAbs.toLowerCase()) return content
      return baseHost.readFile(fileName)
    },
    fileExists: (fileName) => {
      if (path.resolve(fileName).toLowerCase() === targetAbs.toLowerCase()) return true
      return baseHost.fileExists(fileName)
    }
  }

  const program = ts.createProgram([targetAbs], compilerOptions, host)
  const source = program.getSourceFile(targetAbs)
  if (!source) return []

  const syntactic = program.getSyntacticDiagnostics(source)
  const semantic = program.getSemanticDiagnostics(source).filter((d) => {
    if (d.file !== source) return false
    if (IGNORED_DIAGNOSTIC_CODES.has(d.code)) return false
    return true
  })

  return [...syntactic, ...semantic].map((d) => {
    const start = d.start ?? 0
    const pos = source.getLineAndCharacterOfPosition(start)
    return {
      line: pos.line + 1,
      column: pos.character + 1,
      start,
      length: d.length ?? 0,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n')
    }
  })
}

const SEARCH_IGNORE = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/out/**',
  '**/build/**',
  '**/.next/**',
  '**/.cache/**',
  '**/coverage/**'
]

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function searchWorkspaceFiles(
  root: string,
  query: string,
  options?: WorkspaceFileSearchOptions
): Promise<WorkspaceFileSearchMatch[]> {
  if (!root || !path.isAbsolute(root) || !query || !query.trim()) {
    return []
  }

  const realRoot = await realpath(root).catch(() => null)
  if (!realRoot) return []

  const flags = options?.caseSensitive ? 'g' : 'gi'
  const escaped = escapeRegExp(query.trim())
  const pattern = options?.wholeWord ? `\\b${escaped}\\b` : escaped
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch {
    return []
  }

  const maxResults = Math.min(options?.maxResults ?? 300, 1000)
  const files = await glob('**/*', {
    cwd: realRoot,
    onlyFiles: true,
    ignore: SEARCH_IGNORE
  }).catch(() => [])

  const matches: WorkspaceFileSearchMatch[] = []

  for (const rel of files) {
    if (matches.length >= maxResults) break
    const fullPath = path.join(realRoot, rel)
    try {
      const fileStat = await stat(fullPath)
      if (fileStat.size > MAX_FILE_BYTES) continue
      const content = await readFile(fullPath, 'utf8')
      if (content.includes('\0')) continue

      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const lineText = lines[i]
        regex.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = regex.exec(lineText)) !== null) {
          matches.push({
            path: rel.split(path.sep).join('/'),
            line: i + 1,
            column: m.index + 1,
            matchLength: m[0].length,
            lineText: lineText.trimEnd().slice(0, 300)
          })
          if (matches.length >= maxResults) break
          if (m[0].length === 0) break
        }
        if (matches.length >= maxResults) break
      }
    } catch {
      continue
    }
  }

  return matches
}

export async function replaceWorkspaceFiles(
  root: string,
  query: string,
  replacement: string,
  options?: WorkspaceFileSearchOptions,
  paths?: string[]
): Promise<WorkspaceFileReplaceResult> {
  if (
    !root ||
    !path.isAbsolute(root) ||
    !query ||
    !query.trim() ||
    typeof replacement !== 'string'
  ) {
    return { filesChanged: 0, replacements: 0 }
  }

  const realRoot = await realpath(root).catch(() => null)
  if (!realRoot) return { filesChanged: 0, replacements: 0 }

  const flags = options?.caseSensitive ? 'g' : 'gi'
  const escaped = escapeRegExp(query.trim())
  const pattern = options?.wholeWord ? `\\b${escaped}\\b` : escaped
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch {
    return { filesChanged: 0, replacements: 0 }
  }

  let candidateFiles: string[]
  if (paths && paths.length > 0) {
    candidateFiles = paths
  } else {
    candidateFiles = await glob('**/*', {
      cwd: realRoot,
      onlyFiles: true,
      ignore: SEARCH_IGNORE
    }).catch(() => [])
  }

  let filesChanged = 0
  let totalReplacements = 0

  for (const rel of candidateFiles) {
    try {
      const read = await readWorkspaceFile(realRoot, rel)
      if (read.binary || read.truncated || !read.revision) continue

      regex.lastIndex = 0
      if (!regex.test(read.content)) continue

      regex.lastIndex = 0
      let fileMatchCount = 0
      const newContent = read.content.replace(regex, () => {
        fileMatchCount++
        return replacement
      })

      if (fileMatchCount > 0 && newContent !== read.content) {
        const write = await writeWorkspaceFile(realRoot, rel, newContent, read.revision)
        if (write.status === 'saved') {
          filesChanged++
          totalReplacements += fileMatchCount
        }
      }
    } catch {
      continue
    }
  }

  return { filesChanged, replacements: totalReplacements }
}
