/**
 * A thin, safe wrapper around the `git` binary — the foundation for
 * worktree-backed sessions (several agents working the same repo in parallel,
 * each in its own isolated checkout on its own branch).
 *
 * Design rules, all deliberate:
 *
 *  - NO npm dependency. `git` is already on the machine of anyone this feature
 *    is for, and a JS reimplementation would diverge from the real thing.
 *  - Every call is `spawn(git, [args])` with an argument ARRAY and
 *    `shell: false`. Branch names and paths are user data; interpolating them
 *    into a shell string would be a command-injection hole, and would break on
 *    Windows paths with spaces besides.
 *  - Nothing here throws into a caller. Git failures are normal (no remote,
 *    detached HEAD, offline, a branch checked out elsewhere) and must never take
 *    down a turn, so everything returns a typed result or null.
 *  - Commands are serialized per repository. Git takes an index/ref lock, and N
 *    concurrent sessions on one repo would otherwise race it.
 *
 * Git — not the database — stays the source of truth for worktrees and branches.
 * The DB only stores a pointer (`chats.worktree_path`).
 */
import { spawn } from 'node:child_process'
import { promises as fs, realpathSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { slugToBranchSegment } from '../../shared/slugs'
import {
  DEFAULT_BRANCH_PREFIX,
  isPlaceholderBranch,
  normalizeBranchPrefix,
  placeholderBranchName
} from '../../shared/branch'
import * as repo from '../db/repo'
import { getCredential } from './forge/credentials'
import type {
  RepoSyncTarget,
  GitCommitNode,
  GitChangedFile,
  GitFileDiffResult,
  GitCommandLogEntry,
  GitRepositoryAction
} from '../../shared/api'

/** How long any single git command may run before it's killed. */
const GIT_TIMEOUT_MS = 30_000
/** `git fetch` talks to the network, so it gets a longer leash. */
const FETCH_TIMEOUT_MS = 60_000
/** Cap git's stdout so a pathological repo can't balloon memory. */
const MAX_GIT_OUTPUT = 2_000_000
const MAX_GIT_COMMAND_LOG = 100
const gitCommandLog: GitCommandLogEntry[] = []
let nextGitCommandId = 1

function displayGitCommand(args: string[]): string {
  const text = ['git', ...args].map((arg) => (/[\s"]/u.test(arg) ? JSON.stringify(arg) : arg)).join(' ')
  return text.replace(/:\/\/[^/@\s]+@/gu, '://***@')
}

function redactGitOutput(text: string): string {
  return text.replace(/:\/\/[^/@\s]+@/gu, '://***@')
}

function beginGitCommand(args: string[], cwd: string): GitCommandLogEntry {
  const entry: GitCommandLogEntry = {
    id: nextGitCommandId++,
    command: displayGitCommand(args),
    cwd,
    startedAt: Date.now(),
    status: 'running',
    stdout: '',
    stderr: '',
    exitCode: null
  }
  gitCommandLog.push(entry)
  if (gitCommandLog.length > MAX_GIT_COMMAND_LOG) gitCommandLog.shift()
  return entry
}

export function getCommandLog(cwd: string): GitCommandLogEntry[] {
  const key = canonicalPath(cwd)
  return gitCommandLog
    .filter((entry) => !key || canonicalPath(entry.cwd) === key)
    .slice()
    .reverse()
    .map((entry) => ({ ...entry }))
}

/** Fallback prefix when settings haven't been read (tests, early startup). */
export const WORKTREE_BRANCH_PREFIX = DEFAULT_BRANCH_PREFIX

/**
 * The user's configured branch prefix, normalized.
 *
 * Read per call rather than cached: changing it in Settings has to affect the
 * very next workstream, and this is one indexed row.
 */
function branchPrefix(): string {
  try {
    return normalizeBranchPrefix(repo.getSettings().branchPrefix)
  } catch {
    // No settings yet (early startup, or a test without a DB) - fall back.
    return DEFAULT_BRANCH_PREFIX
  }
}
/** The git config key that remembers which branch a workstream should merge into. */
const BASE_CONFIG_SUFFIX = 'roxy-base'

/**
 * One canonical spelling for a path, so ours and git's always compare equal.
 *
 * Git prints fully-resolved forward-slash paths. Node hands back whatever the
 * caller had — which on Windows is routinely an 8.3 short name
 * (`C:\Users\FREDDY~1\...` from %TEMP%) or a different drive-letter case.
 * Comparing those two spellings as strings silently fails, which would make a
 * live worktree look orphaned and get pruned out from under a session.
 *
 * `realpathSync.native` is the one that expands short names on Windows; the
 * portable `realpathSync` does not. Falls back to `path.normalize` when the
 * path doesn't exist (a worktree we're about to create).
 */
export function canonicalPath(p: string): string {
  if (!p) return ''
  try {
    return path.normalize(realpathSync.native(p))
  } catch {
    return path.normalize(p)
  }
}

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | null
}

export interface WorktreeInfo {
  path: string
  /** Short branch name, or null when the worktree is on a detached HEAD. */
  branch: string | null
  head: string | null
  /** True for the repository's own main working tree (never removable). */
  isMain: boolean
}

export interface GitStatus {
  dirty: boolean
  /** Number of changed entries (staged, unstaged and untracked). */
  changed: number
  ahead: number
  behind: number
  branch: string | null
  /** True when the branch has an upstream to compare against. */
  hasUpstream: boolean
  /**
   * The upstream ref this branch is measured against, e.g. `origin/main`.
   *
   * Kept alongside `hasUpstream` because it is what a sync action has to NAME.
   * "Update from origin/main" is a promise the user can verify; "pull" is a
   * guess about which of possibly several remotes we meant.
   */
  upstream: string | null
}

/** The outcome of a fast-forward or a reset. */
export interface SyncResult {
  ok: boolean
  error?: string
  /** The ref we synced to (or would have), once we knew it. */
  upstream?: string
  /** False when the branch was already there and nothing moved. */
  updated?: boolean
  /** True when a reset parked uncommitted work in the stash first. */
  stashed?: boolean
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/**
 * Serialize git per repository.
 *
 * Two sessions creating worktrees in the same repo at the same moment will race
 * git's index lock and one gets a confusing "Unable to create .git/index.lock"
 * failure. Each repo root owns a promise chain; commands queue behind it. Keyed
 * by the resolved repo root when we know it, else by cwd.
 */
const repoLocks = new Map<string, Promise<unknown>>()

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = repoLocks.get(key) ?? Promise.resolve()
  // `.catch` keeps one failure from poisoning every queued command behind it.
  const next = prev.then(task, task)
  repoLocks.set(
    key,
    next.catch(() => undefined)
  )
  // Drop the entry once the chain drains, so the map doesn't grow forever.
  void next
    .catch(() => undefined)
    .finally(() => {
      if (repoLocks.get(key) === undefined) repoLocks.delete(key)
    })
  return next
}

/**
 * Run one git command. Never throws — a missing binary, a non-zero exit and a
 * timeout all come back as `{ ok: false }` with whatever stderr git produced.
 */
function execGit(
  args: string[],
  cwd: string,
  timeoutMs = GIT_TIMEOUT_MS,
  stdinInput?: string
): Promise<GitResult> {
  return new Promise((resolve) => {
    const logEntry = beginGitCommand(args, cwd)
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('git', args, {
        cwd: cwd || undefined,
        // shell:false is the point — args stay an array, so a branch name can
        // never be interpreted as shell syntax.
        shell: false,
        windowsHide: true,
        env: {
          ...process.env,
          // Git must never stop for credentials or an editor: this runs headless
          // inside the app, and a prompt would hang the command until timeout.
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_EDITOR: 'true',
          GCM_INTERACTIVE: 'never'
        }
      })
    } catch (e) {
      const result = {
        ok: false,
        stdout: '',
        stderr: e instanceof Error ? e.message : String(e),
        code: null
      }
      logEntry.finishedAt = Date.now()
      logEntry.status = 'failed'
      logEntry.stderr = result.stderr
      resolve(result)
      return
    }

    if (stdinInput !== undefined) {
      try {
        child.stdin?.write(stdinInput)
        child.stdin?.end()
      } catch {
        /* already closed */
      }
    }

    let stdout = ''
    let stderr = ''
    let done = false
    const finish = (r: GitResult): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      logEntry.finishedAt = Date.now()
      logEntry.status = r.ok ? 'succeeded' : 'failed'
      logEntry.stdout = redactGitOutput(r.stdout)
      logEntry.stderr = redactGitOutput(r.stderr)
      logEntry.exitCode = r.code
      resolve(r)
    }

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
      finish({ ok: false, stdout, stderr: `git timed out after ${timeoutMs}ms`, code: null })
    }, timeoutMs)

    child.stdout?.on('data', (d: Buffer) => {
      if (stdout.length < MAX_GIT_OUTPUT) stdout += d.toString()
      logEntry.stdout = redactGitOutput(stdout)
    })
    child.stderr?.on('data', (d: Buffer) => {
      if (stderr.length < MAX_GIT_OUTPUT) stderr += d.toString()
      logEntry.stderr = redactGitOutput(stderr)
    })
    child.on('error', (e) => finish({ ok: false, stdout, stderr: e.message, code: null }))
    child.on('close', (code) => finish({ ok: code === 0, stdout, stderr, code: code ?? null }))
  })
}

/** Run a git command serialized against everything else touching this repo. */
function git(args: string[], cwd: string, timeoutMs?: number): Promise<GitResult> {
  return serialize(cwd, () => execGit(args, cwd, timeoutMs))
}

/**
 * Check which paths are ignored by git in `cwd`.
 * Returns a Set of normalized paths (forward slashes, no trailing slash).
 */
export async function getIgnoredPaths(
  cwd: string,
  entries: { path: string; directory: boolean }[]
): Promise<Set<string>> {
  if (!cwd || entries.length === 0) return new Set()
  const root = await repoRoot(cwd)
  if (!root) return new Set()

  const lines = entries.map((e) => {
    const p = e.path.replace(/\\/g, '/')
    return e.directory ? (p.endsWith('/') ? p : `${p}/`) : p
  })
  const input = lines.join('\n')

  const r = await execGit(['check-ignore', '-v', '--stdin'], cwd, 5000, input)
  if ((r.code !== 0 && r.code !== 1) || !r.stdout.trim()) return new Set()

  const set = new Set<string>()
  for (const line of r.stdout.split(/\r?\n/)) {
    const tabIdx = line.indexOf('\t')
    let rawPath = line
    if (tabIdx !== -1) {
      const meta = line.slice(0, tabIdx)
      rawPath = line.slice(tabIdx + 1)
      const match = meta.match(/^(?:.*):(\d+):(.*)$/)
      if (match) {
        const pattern = match[2]
        // Git for Windows CRLF bug: blank lines (\r\n) in .gitignore are
        // parsed as empty pattern rules that match every directory path ending in '/'.
        // Also skip negation patterns (!pattern means un-ignored).
        if (!pattern || !pattern.trim() || pattern === '/' || pattern.startsWith('!')) {
          continue
        }
      }
    }
    const clean = rawPath
      .trim()
      .replace(/^"+|"+$/g, '')
      .replace(/\\\\/g, '/')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '')
      .trim()
    if (clean) {
      set.add(clean)
      set.add(clean.toLowerCase())
    }
  }
  return set
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

let gitAvailable: boolean | null = null

/**
 * Whether a usable `git` binary exists. Probed once and cached: worktree UI is
 * hidden entirely when this is false, so it's checked on a hot path.
 */
export async function isGitAvailable(): Promise<boolean> {
  if (gitAvailable !== null) return gitAvailable
  const r = await execGit(['--version'], process.cwd(), 5_000)
  gitAvailable = r.ok && /git version/i.test(r.stdout)
  return gitAvailable
}

/** Test-only: forget the cached probe. */
export function _resetGitAvailability(): void {
  gitAvailable = null
}

// ---------------------------------------------------------------------------
// Repository queries
// ---------------------------------------------------------------------------

/** The repository root containing `cwd`, or null when it isn't in a repo. */
export async function repoRoot(cwd: string): Promise<string | null> {
  if (!cwd) return null
  const r = await git(['rev-parse', '--show-toplevel'], cwd)
  if (!r.ok) return null
  const out = r.stdout.trim()
  return out ? canonicalPath(out) : null
}

/** The checked-out branch, or null when detached / not a repo. */
export async function currentBranch(cwd: string): Promise<string | null> {
  if (!cwd) return null
  const r = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
  if (!r.ok) return null
  const name = r.stdout.trim()
  return !name || name === 'HEAD' ? null : name
}

/**
 * Resolve `rev` to a commit sha in `cwd`, or null when it doesn't exist.
 *
 * The null is the point: callers use this to check that a ref they recorded
 * earlier (a fork's base commit, say) is still there, so a branch deleted in
 * the meantime degrades to a different base instead of a `fatal:` on the path
 * that was going to use it. Defaults to HEAD.
 */
export async function resolveCommit(cwd: string, rev = 'HEAD'): Promise<string | null> {
  if (!cwd) return null
  const r = await git(['rev-parse', '--verify', '--quiet', `${rev}^{commit}`], cwd)
  const sha = r.stdout.trim()
  return r.ok && sha ? sha : null
}

/**
 * Local branches plus remote-tracking branches, deduped and sorted.
 *
 * `origin/feature` collapses to `feature` so the picker shows one entry per
 * logical branch — checking out a remote-only branch by its short name is what
 * git does anyway (DWIM).
 */
export async function listBranches(cwd: string): Promise<string[]> {
  if (!cwd) return []
  const r = await git(
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes/origin'],
    cwd
  )
  if (!r.ok) return []
  const names = new Set<string>()
  for (const raw of r.stdout.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    // `origin/HEAD` is a symref pointing at the default branch, not a branch.
    if (line === 'origin/HEAD' || line.endsWith('/HEAD')) continue
    names.add(line.startsWith('origin/') ? line.slice('origin/'.length) : line)
  }
  return [...names].sort((a, b) => a.localeCompare(b))
}

/**
 * The MAIN working tree of the repo that owns `cwd`.
 *
 * `rev-parse --show-toplevel` inside a worktree returns the WORKTREE, not the
 * repo — so it's the wrong tool for "which of these is the real checkout" or
 * "where do I run a command that operates on this worktree". `--git-common-dir`
 * always points at the real `.git` directory, shared by every worktree; its
 * parent is the main working tree.
 */
async function mainWorktreeRoot(cwd: string): Promise<string | null> {
  const r = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd)
  const out = r.stdout.trim()
  if (r.ok && out) return canonicalPath(path.dirname(out))
  return repoRoot(cwd)
}

/**
 * Every worktree git knows about, with stale entries dropped.
 *
 * Git keeps administrative records for worktrees whose directory was deleted
 * behind its back, so each path is stat'd and only live ones are returned —
 * otherwise the branch picker offers to "attach" to a directory that's gone.
 */
export async function listWorktrees(root: string): Promise<WorktreeInfo[]> {
  if (!root) return []
  const r = await git(['worktree', 'list', '--porcelain'], root)
  if (!r.ok) return []

  const entries: WorktreeInfo[] = []
  let cur: Partial<WorktreeInfo> & { path?: string } = {}
  const flush = (): void => {
    if (cur.path) {
      entries.push({
        path: canonicalPath(cur.path),
        branch: cur.branch ?? null,
        head: cur.head ?? null,
        isMain: false
      })
    }
    cur = {}
  }
  for (const raw of r.stdout.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      flush()
      cur.path = line.slice('worktree '.length)
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      // e.g. "branch refs/heads/fix-auth" -> "fix-auth"
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line === 'detached') {
      cur.branch = null
    }
  }
  flush()

  // Flag the repo's own working tree by identity rather than by position: it's
  // the parent of the shared .git directory. Prune must never offer to delete it.
  const main = await mainWorktreeRoot(root)
  for (const e of entries) e.isMain = main !== null && e.path === main

  const live = await Promise.all(
    entries.map(async (e) => {
      try {
        const st = await fs.stat(e.path)
        return st.isDirectory() ? e : null
      } catch {
        return null // git still has a record, but the directory is gone
      }
    })
  )
  return live.filter((e): e is WorktreeInfo => e !== null)
}

/**
 * The repo's default branch — what a new workstream branches off.
 *
 * Tries origin/HEAD (what the remote says), then a local main/master, then
 * whatever is currently checked out. Null only when the repo has no commits.
 */
export async function defaultBranch(cwd: string): Promise<string | null> {
  if (!cwd) return null
  const sym = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd)
  if (sym.ok) {
    const name = sym.stdout.trim().replace(/^origin\//, '')
    if (name) return name
  }
  for (const candidate of ['main', 'master']) {
    const r = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`], cwd)
    if (r.ok && r.stdout.trim()) return candidate
  }
  return await currentBranch(cwd)
}

/** Fetch from a remote (default `origin`). Fails harmlessly when offline. */
export async function fetchOrigin(cwd: string, remote = 'origin'): Promise<GitResult> {
  return git(['fetch', '--quiet', remote], cwd, FETCH_TIMEOUT_MS)
}

/**
 * The remote a branch tracks, e.g. `origin`.
 *
 * Read from config rather than split off the front of `origin/main`: a remote
 * name may itself contain a slash, and guessing wrong means fetching the wrong
 * server and then "updating" from a stale ref — a silent wrong answer, which is
 * the worst kind for a sync button.
 */
export async function upstreamRemote(cwd: string, branch: string): Promise<string | null> {
  if (!cwd || !branch) return null
  const r = await git(['config', '--get', `branch.${branch}.remote`], cwd)
  const name = r.stdout.trim()
  return r.ok && name ? name : null
}

/** Whether the repo has an `origin` remote configured. */
export async function hasOrigin(cwd: string): Promise<boolean> {
  const r = await git(['remote'], cwd)
  return r.ok && r.stdout.split('\n').some((l) => l.trim() === 'origin')
}

/**
 * The fetch URL of a remote (default `origin`) - the input to forge detection.
 *
 * Uses `remote get-url` rather than parsing `git remote -v`, whose output
 * carries a `(fetch)`/`(push)` suffix that has to be stripped. This form also
 * honours `insteadOf` rewrites the same way git itself does, so a corporate
 * `url.<base>.insteadOf` rule resolves to the URL actually in use.
 */
export async function remoteUrl(cwd: string, name = 'origin'): Promise<string | null> {
  if (!cwd) return null
  const r = await git(['remote', 'get-url', name], cwd)
  const out = r.stdout.trim().split('\n')[0]?.trim()
  return r.ok && out ? out : null
}

/**
 * Push a branch to origin, optionally setting upstream.
 *
 * Deliberately NOT forced, and deliberately not offering `--force-with-lease`:
 * this is reachable from a one-click chip, and a single click that can destroy
 * a colleague's commits is not an acceptable thing to build. A rejected push
 * surfaces git's own error and the user resolves it deliberately.
 *
 * Takes the network timeout, since a push talks to the remote.
 */
export async function pushBranch(
  cwd: string,
  branch: string,
  opts: { setUpstream?: boolean } = {}
): Promise<{ ok: boolean; error?: string }> {
  if (!cwd || !branch) return { ok: false, error: 'push: missing cwd or branch' }
  const args = ['push']
  if (opts.setUpstream) args.push('--set-upstream')
  args.push('origin', branch)
  const r = await git(args, cwd, FETCH_TIMEOUT_MS)
  return r.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Push failed') }
}
/**
 * Working-tree status: dirty flag, changed-entry count, and ahead/behind vs the
 * upstream. Uses `--porcelain=v2 --branch`, whose header lines carry the branch
 * and ahead/behind without a second command.
 */
export async function status(cwd: string): Promise<GitStatus | null> {
  if (!cwd) return null
  const r = await git(['status', '--porcelain=v2', '--branch', '--untracked-files=normal'], cwd)
  if (!r.ok) return null

  let branch: string | null = null
  let ahead = 0
  let behind = 0
  let upstream: string | null = null
  let changed = 0
  for (const raw of r.stdout.split('\n')) {
    const line = raw.trimEnd()
    if (!line) continue
    if (line.startsWith('# branch.head ')) {
      const v = line.slice('# branch.head '.length).trim()
      branch = v === '(detached)' ? null : v
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length).trim() || null
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+)\s+-(\d+)/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (!line.startsWith('#')) {
      changed++
    }
  }
  return { dirty: changed > 0, changed, ahead, behind, branch, hasUpstream: !!upstream, upstream }
}

// ---------------------------------------------------------------------------
// Getting back in sync with the remote
// ---------------------------------------------------------------------------

/**
 * The ref a branch should sync against, even when it tracks nothing.
 *
 * The upstream is the right answer whenever there is one - it is what the user
 * pushed to and what ahead/behind already measure against.
 *
 * The fallback is the whole point of this function. A workstream branch is
 * created locally and has no upstream until its first push, so `st.upstream` is
 * null for the entire period when "my branch is stale, give me what's on main"
 * is MOST likely to be true. Reporting "no upstream" there is technically
 * accurate and practically useless: the branch has an obvious base
 * (`origin/main`), and that is what the user means by "update from main".
 *
 * Returns null only when there is genuinely nothing to sync to: no base branch,
 * or a base that is the branch itself.
 */
export async function syncRefFor(
  cwd: string,
  opts: { branch?: string | null; upstream?: string | null } = {}
): Promise<{ ref: string; viaUpstream: boolean; local: boolean } | null> {
  if (!cwd) return null
  if (opts.upstream) return { ref: opts.upstream, viaUpstream: true, local: false }

  // The branch this workstream was cut from, as recorded at creation - the
  // honest answer to "main" for a repo whose default is `develop` or `trunk`.
  const branch = opts.branch ?? (await currentBranch(cwd))
  const base = (branch ? await baseBranchFor(cwd, branch) : null) ?? (await defaultBranch(cwd))
  if (!base) return null

  // Prefer the REMOTE base. A local `main` can be months behind the origin it
  // tracks, and resetting onto that would look like it worked while quietly
  // restoring old code - the exact failure this button exists to prevent.
  const remoteRef = `origin/${base}`
  const onRemote = await git(
    ['rev-parse', '--verify', '--quiet', `refs/remotes/${remoteRef}^{commit}`],
    cwd
  )
  if (onRemote.ok && onRemote.stdout.trim()) {
    return { ref: remoteRef, viaUpstream: false, local: false }
  }

  // No remote copy of the base. If the repo has NO REMOTE AT ALL, the local
  // branch is not a stale mirror of anything - it is the only truth there is,
  // and refusing to sync with it strands every local-only repo (scratch
  // projects, anything not yet pushed) with no way back to main. The staleness
  // argument above is about a local branch DIVERGING from its remote; with no
  // remote there is nothing for it to diverge from.
  //
  // When a remote DOES exist but lacks this base, stay silent: that means the
  // base was deleted or renamed upstream, and syncing to a local leftover is
  // the stale-restore failure, not an escape from it.
  if (await remoteUrl(cwd)) return null

  const onLocal = await git(
    ['rev-parse', '--verify', '--quiet', `refs/heads/${base}^{commit}`],
    cwd
  )
  if (!onLocal.ok || !onLocal.stdout.trim()) return null
  // Syncing a branch to itself is a guaranteed no-op, so offer nothing rather
  // than a button that can only ever report "already up to date".
  if (base === branch) return null
  return { ref: base, viaUpstream: false, local: true }
}

/**
 * How far `cwd`'s branch is from `ref`, as a pair of commit counts.
 *
 * `rev-list --left-right --count A...B` is one command for both numbers, and
 * uses the merge base - so "behind" means commits actually missing rather than
 * every commit since the branches diverged.
 */
async function distanceFrom(cwd: string, ref: string): Promise<{ ahead: number; behind: number }> {
  const r = await git(['rev-list', '--left-right', '--count', `${ref}...HEAD`], cwd)
  if (!r.ok) return { ahead: 0, behind: 0 }
  const m = /(\d+)\s+(\d+)/.exec(r.stdout.trim())
  // Left is the ref, right is HEAD: left-only commits are what we're BEHIND.
  return m ? { behind: Number(m[1]), ahead: Number(m[2]) } : { ahead: 0, behind: 0 }
}

/**
 * Everything the UI needs to offer a sync for one repo, or null when it can't.
 *
 * Costs one extra git command beyond `status` (the ahead/behind count) and only
 * when the branch has no upstream, so the common single-repo case is unchanged.
 */
export async function syncTargetFor(cwd: string): Promise<RepoSyncTarget | null> {
  const st = await status(cwd)
  if (!st?.branch) return null

  const target = await syncRefFor(cwd, { branch: st.branch, upstream: st.upstream })
  if (!target) return null

  // With an upstream, status already counted the distance - don't pay twice.
  const { ahead, behind } = target.viaUpstream
    ? { ahead: st.ahead, behind: st.behind }
    : await distanceFrom(cwd, target.ref)

  return {
    ref: target.ref,
    viaUpstream: target.viaUpstream,
    ahead,
    behind,
    changed: st.changed,
    // `ahead === 0` is the honest predicate for whether a fast-forward can
    // succeed; see the note in forge/index.ts on why it is not `behind > 0`.
    canFastForward: ahead === 0
  }
}

/**
 * Fast-forward the checked-out branch onto its upstream.
 *
 * Explicitly NOT `git pull`. `pull` is two operations wearing one name, and
 * which ones depend on `pull.rebase`, `pull.ff` and the user's global config —
 * so the same button would merge on one machine, rebase on another, and open an
 * editor on a third. This does exactly one thing on every machine:
 *
 *   fetch, then move the branch pointer forward IF that is all it takes.
 *
 * `--ff-only` is the entire safety model. When the branch has local commits the
 * upstream doesn't, git refuses and nothing is touched: no merge commit, no
 * half-finished rebase with conflict markers in a tree an agent is editing, no
 * state the user has to know git to get out of. They get told to reset (which
 * stashes) or to resolve it themselves, deliberately.
 */
export async function pullFastForward(cwd: string): Promise<SyncResult> {
  if (!cwd) return { ok: false, error: 'pull: missing cwd' }
  const st = await status(cwd)
  if (!st?.branch) return { ok: false, error: 'Not on a branch (detached HEAD).' }

  // Falls back to `origin/<base>` when the branch tracks nothing, so a
  // never-pushed workstream can still catch up with main. See `syncRefFor`.
  const target = await syncRefFor(cwd, { branch: st.branch, upstream: st.upstream })
  if (!target) {
    return { ok: false, error: `"${st.branch}" has nothing to update from.` }
  }

  // Fetch first so "behind" is measured against what the server has NOW, not
  // whatever the last poll happened to see. Skipped for a LOCAL base ref: there
  // is no remote to reach, and treating an unreachable one as failure would
  // block the merge in a repo where nothing could have gone stale.
  if (!target.local) {
    const remote = (await upstreamRemote(cwd, st.branch)) ?? 'origin'
    const fetched = await fetchOrigin(cwd, remote)
    if (!fetched.ok)
      return { ok: false, error: cleanGitError(fetched, `Could not reach ${remote}`) }
  }

  // Re-measure AFTER the fetch, against the ref we're actually merging. For a
  // tracked branch `status` already knows; for a base ref it has no opinion, so
  // count explicitly rather than read a number about a different ref.
  const behind = target.viaUpstream
    ? ((await status(cwd))?.behind ?? 0)
    : (await distanceFrom(cwd, target.ref)).behind
  if (behind === 0) {
    return { ok: true, upstream: target.ref, updated: false }
  }

  // A dirty tree is fine for a fast-forward as long as no incoming file
  // collides with a local edit — git checks that itself and refuses if so, and
  // its refusal names the files, which is better than any pre-flight we could
  // write here.
  const r = await git(['merge', '--ff-only', target.ref], cwd, FETCH_TIMEOUT_MS)
  if (!r.ok)
    return { ok: false, error: cleanGitError(r, 'Could not fast-forward'), upstream: target.ref }
  return { ok: true, upstream: target.ref, updated: true }
}

/**
 * Pull upstream changes for the checked-out branch.
 * Tries fast-forward first. If the branches have diverged, performs a merge.
 * If conflicts occur, leaves conflict markers and enters a merge state so the
 * user can resolve them via the conflict solver.
 */
export async function pullBranch(cwd: string): Promise<SyncResult & { conflict?: boolean }> {
  if (!cwd) return { ok: false, error: 'pull: missing cwd' }
  const st = await status(cwd)
  if (!st?.branch) return { ok: false, error: 'Not on a branch (detached HEAD).' }

  const target = await syncRefFor(cwd, { branch: st.branch, upstream: st.upstream })
  if (!target) {
    return { ok: false, error: `"${st.branch}" has nothing to update from.` }
  }

  if (!target.local) {
    const remote = (await upstreamRemote(cwd, st.branch)) ?? 'origin'
    const fetched = await fetchOrigin(cwd, remote)
    if (!fetched.ok) {
      return { ok: false, error: cleanGitError(fetched, `Could not reach ${remote}`) }
    }
  }

  const behind = target.viaUpstream
    ? ((await status(cwd))?.behind ?? 0)
    : (await distanceFrom(cwd, target.ref)).behind
  if (behind === 0) {
    return { ok: true, upstream: target.ref, updated: false }
  }

  const ahead = target.viaUpstream
    ? ((await status(cwd))?.ahead ?? 0)
    : (await distanceFrom(cwd, target.ref)).ahead

  // Try fast-forward if no local commits ahead
  if (ahead === 0) {
    const r = await git(['merge', '--ff-only', target.ref], cwd, FETCH_TIMEOUT_MS)
    if (r.ok) {
      return { ok: true, upstream: target.ref, updated: true }
    }
    // If ff-only failed because of dirty tree collisions (not divergence), report the error
    if (
      !r.stderr.includes('Not possible to fast-forward') &&
      !r.stderr.includes('Diverging branches') &&
      !r.stdout.includes('Not possible to fast-forward')
    ) {
      return { ok: false, error: cleanGitError(r, 'Could not fast-forward'), upstream: target.ref }
    }
  }

  // If already merging, don't start another merge
  if (await isMerging(cwd)) {
    return {
      ok: false,
      conflict: true,
      error: 'A merge is already in progress. Please resolve conflicts or abort the merge.',
      upstream: target.ref
    }
  }

  // Branches diverged. Perform a merge.
  const mergeResult = await git(['merge', target.ref, '--no-edit'], cwd, FETCH_TIMEOUT_MS)
  if (mergeResult.ok) {
    return { ok: true, upstream: target.ref, updated: true }
  }

  // Check if conflicts arose
  if (await isMerging(cwd)) {
    return {
      ok: false,
      conflict: true,
      error: 'Merge conflict detected. Please resolve conflicts.',
      upstream: target.ref
    }
  }

  return {
    ok: false,
    error: cleanGitError(mergeResult, 'Merge failed'),
    upstream: target.ref
  }
}

/**
 * Hard-reset the branch onto a ref, parking any local work in a stash first.
 *
 * This is the "just give me what's on the server" escape hatch, and it is
 * destructive by definition — so the one thing it guarantees is that nothing is
 * unrecoverable. Uncommitted changes go to the stash BEFORE the reset, with a
 * message naming Roxy and the branch, so `git stash list` shows exactly what
 * happened and `git stash pop` undoes it.
 *
 * `--include-untracked` matters more than it looks: an agent's brand-new files
 * are untracked, and a plain stash would leave them behind to be wiped by the
 * clean step or to collide with incoming files.
 *
 * Local COMMITS are not stashed — they don't need to be. They stay in the reflog
 * and the caller is told the sha to get back to.
 */
export async function resetToUpstream(cwd: string): Promise<SyncResult> {
  if (!cwd) return { ok: false, error: 'reset: missing cwd' }
  const st = await status(cwd)
  if (!st?.branch) return { ok: false, error: 'Not on a branch (detached HEAD).' }

  // Falls back to `origin/<base>`, which is what makes "reset to main" reachable
  // on a branch that was never pushed. See `syncRefFor`.
  const ref = await syncRefFor(cwd, { branch: st.branch, upstream: st.upstream })
  if (!ref) {
    return { ok: false, error: `"${st.branch}" has nothing to reset to.` }
  }

  // See `pullFastForward`: a local base ref has no remote to fetch from.
  if (!ref.local) {
    const remote = (await upstreamRemote(cwd, st.branch)) ?? 'origin'
    const fetched = await fetchOrigin(cwd, remote)
    if (!fetched.ok)
      return { ok: false, error: cleanGitError(fetched, `Could not reach ${remote}`) }
  }

  // Resolve the target BEFORE touching anything, so a typo'd or vanished
  // upstream fails while the tree is still intact.
  const target = await git(['rev-parse', '--verify', '--quiet', `${ref.ref}^{commit}`], cwd)
  if (!target.ok || !target.stdout.trim()) {
    return { ok: false, error: `Could not resolve ${ref.ref}.`, upstream: ref.ref }
  }

  let stashed = false
  if (st.dirty) {
    const label = `roxy: before reset of ${st.branch}`
    const stash = await git(['stash', 'push', '--include-untracked', '-m', label], cwd)
    // Refuse rather than reset anyway: the whole promise of this button is that
    // the work is recoverable, and a failed stash breaks exactly that.
    if (!stash.ok) {
      return {
        ok: false,
        error: cleanGitError(stash, 'Could not stash your changes, so nothing was reset'),
        upstream: ref.ref
      }
    }
    // `stash push` exits 0 with "No local changes to save" when everything that
    // looked dirty was ignored - claiming a stash exists then would send the
    // user to `git stash pop` for something that isn't there.
    stashed = !/no local changes/i.test(stash.stdout + stash.stderr)
  }

  const r = await git(['reset', '--hard', target.stdout.trim()], cwd)
  if (!r.ok) {
    return { ok: false, error: cleanGitError(r, 'Reset failed'), upstream: ref.ref, stashed }
  }
  return { ok: true, upstream: ref.ref, updated: true, stashed }
}

// ---------------------------------------------------------------------------
// Branch naming
// ---------------------------------------------------------------------------

/**
 * A fresh placeholder branch name, e.g. `roxy/a1b2c3d4`.
 *
 * The prefix is a user setting (some people want `wip/`, their initials, or
 * nothing at all), so it is read here rather than baked in as a constant.
 */
export function temporaryBranchName(prefix?: string): string {
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return placeholderBranchName(prefix ?? branchPrefix(), hex)
}

/**
 * Whether a branch name is free in every one of `roots`.
 *
 * A composite workstream puts the SAME branch name in each of its repos, so a
 * candidate is only usable if no repo already has it. Checking one repo and
 * hoping is not enough: `worktree add -b` on an existing branch is a hard
 * failure, and it would strike on the turn path, in the third repo, after two
 * worktrees already existed.
 */
async function branchFreeInAll(roots: string[], candidate: string): Promise<boolean> {
  for (const root of roots) {
    const exists = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`], root)
    if (exists.ok && exists.stdout.trim()) return false
  }
  return true
}

/**
 * The branch name for a session titled `title`, guaranteed not to collide.
 *
 * Sessions are already named "Legacy Ogre Apprentice", so the branch reads
 * `roxy/legacy-ogre-apprentice` rather than `roxy/6fdc60b8` — the name means
 * something in `git branch`, in a PR list, and to whoever reviews it.
 *
 * The uniqueness loop matters more than it looks: a branch OUTLIVES its
 * worktree (`git worktree remove` leaves the branch behind), so deleting a
 * session and creating another that draws the same random title is not rare —
 * and `worktree add -b` on an existing branch is a hard failure on the turn
 * path.
 *
 * `root` may be one repo or several. With several (a composite workstream) the
 * name has to be free in EVERY one of them, so they can all share it.
 */
export async function branchNameForTitle(root: string | string[], title: string): Promise<string> {
  const roots = (Array.isArray(root) ? root : [root]).filter(Boolean)
  if (!roots.length) return temporaryBranchName()

  const segment = slugToBranchSegment(title)
  // Nothing usable survived (an emoji- or CJK-only title): fall back to hex
  // rather than inventing a name.
  if (!segment) return temporaryBranchName()

  const prefix = branchPrefix()
  const base = prefix ? prefix + '/' + segment : segment
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? base : base + '-' + (i + 1)
    if (await branchFreeInAll(roots, candidate)) return candidate
  }
  return temporaryBranchName()
}

/**
 * Whether a branch is still an auto-generated placeholder.
 *
 * Renaming a workstream's branch MUST only ever touch placeholders — clobbering
 * a name the user chose (or one that came from origin) would be data loss, so
 * this is an exact shape rather than a prefix check.
 */
export function isTemporaryBranch(name: string | null | undefined, prefix?: string): boolean {
  return isPlaceholderBranch(name, prefix ?? branchPrefix())
}

/**
 * Rename a branch, and move the workstream's recorded PR base with it.
 *
 * Safe while the branch is checked out in a worktree: git rewrites the
 * worktree's HEAD in place, so the directory and any uncommitted work are
 * untouched. Run from the MAIN repo — a worktree can rename its own branch, but
 * the main tree is the one caller we always have a path to.
 */
export async function renameBranch(
  repoRoot: string,
  from: string,
  to: string
): Promise<{ ok: boolean; error?: string }> {
  if (!repoRoot || !from || !to) return { ok: false, error: 'renameBranch: missing argument' }
  if (from === to) return { ok: true }

  const valid = await git(['check-ref-format', '--branch', to], repoRoot)
  if (!valid.ok) return { ok: false, error: `"${to}" is not a valid branch name.` }

  const exists = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${to}`], repoRoot)
  if (exists.ok && exists.stdout.trim()) {
    return { ok: false, error: `A branch named "${to}" already exists.` }
  }

  // -m, never -M: forcing would clobber a branch that a race just created.
  const r = await git(['branch', '-m', from, to], repoRoot)
  if (!r.ok) return { ok: false, error: cleanGitError(r, `Could not rename "${from}"`) }
  return { ok: true }
}

/** Filesystem-safe directory segment for a branch (`feat/x` -> `feat-x`). */
function branchToDirName(branch: string): string {
  return branch.replace(/[/\\]/g, '-').replace(/[^A-Za-z0-9._-]/g, '_')
}

/**
 * Where a worktree for `branch` lives: under the app's data dir, never inside
 * the repo. A worktree inside the repo would be walked by file watchers, picked
 * up by glob/grep (the IGNORE list in harness/tools.ts doesn't know about it),
 * and would show up as an untracked directory in git status.
 *
 * `root` is the thing the directory is NAMED after. For a single-repo session
 * that is the repo; for a composite it is the PROJECT folder, so all N repos
 * land in one directory named for the project rather than N directories named
 * for each repo.
 */
export function worktreePathFor(root: string, branch: string): string {
  const base = app.getPath('userData')
  return path.join(base, 'worktrees', path.basename(root), branchToDirName(branch))
}

/** Ensure the path is free, appending -2, -3, … if a directory already exists. */
async function uniquePath(desired: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const candidate = i === 0 ? desired : `${desired}-${i + 1}`
    try {
      await fs.stat(candidate)
    } catch {
      return candidate // doesn't exist — take it
    }
  }
  return `${desired}-${Date.now()}`
}

/**
 * Reserve a free directory path, for a caller that needs the name BEFORE it
 * creates anything.
 *
 * A composite workstream picks its root once and then places every repo inside
 * it, so de-duplication has to happen at the ROOT. Doing it per child instead
 * would let one repo land in `backend` and the next in `frontend-2`, splitting
 * one session's checkouts across two directories.
 */
export function reserveWorktreePath(desired: string): Promise<string> {
  return uniquePath(desired)
}

// ---------------------------------------------------------------------------
// Worktree lifecycle
// ---------------------------------------------------------------------------

export interface CreateWorktreeInput {
  repoRoot: string
  /** The NEW branch to create. */
  branch: string
  /** Commit-ish to branch from. Omitted -> freshly-fetched origin/<default>. */
  baseRef?: string
  /** Explicit directory. Omitted -> the standard userData location. */
  path?: string
  /**
   * Use `path` verbatim instead of de-duplicating it with a `-2` suffix.
   *
   * For a composite workstream the root was already reserved as a unit, and the
   * children must land exactly where the plan says — a child that quietly
   * became `backend-2` would be a worktree no link points at, invisible to both
   * teardown and prune.
   */
  exactPath?: boolean
  /** The branch this work will eventually merge into (recorded in git config). */
  baseBranch?: string
}

export interface WorktreeResult {
  ok: boolean
  worktree?: WorktreeInfo
  /** True when an existing worktree was reused rather than created. */
  attached?: boolean
  error?: string
}

/**
 * Create a worktree on a NEW branch.
 *
 * Branches off freshly-fetched `origin/<default>` rather than the local ref, so
 * a workstream doesn't start from whatever stale commit the user's local main
 * happens to sit on — that's the difference between a clean PR and one full of
 * unrelated diffs. Falls back to the local ref when there's no origin or the
 * fetch fails (offline is normal, and must still work).
 */
export async function createWorktree(input: CreateWorktreeInput): Promise<WorktreeResult> {
  const { repoRoot: root, branch } = input
  if (!root || !branch) return { ok: false, error: 'createWorktree: missing repoRoot or branch' }

  // Reuse rather than fail: git refuses to check a branch out twice, so if this
  // branch already lives in a worktree, hand that one back.
  const existing = (await listWorktrees(root)).find((w) => w.branch === branch)
  if (existing) return { ok: true, worktree: existing, attached: true }

  let baseRef = input.baseRef
  const base = input.baseBranch ?? (await defaultBranch(root))
  if (!baseRef) {
    if (base && (await hasOrigin(root))) {
      await fetchOrigin(root) // best-effort; offline just means a local base
      const remote = await git(
        ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${base}^{commit}`],
        root
      )
      if (remote.ok && remote.stdout.trim()) baseRef = remote.stdout.trim()
    }
    if (!baseRef && base) {
      const local = await git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`], root)
      if (local.ok && local.stdout.trim()) baseRef = local.stdout.trim()
    }
    if (!baseRef) baseRef = 'HEAD'
  }

  const desired = input.path ?? worktreePathFor(root, branch)
  const target = input.exactPath ? desired : await uniquePath(desired)
  const add = await git(['worktree', 'add', '-b', branch, target, baseRef], root)
  if (!add.ok) {
    return { ok: false, error: cleanGitError(add, `Could not create a worktree for "${branch}"`) }
  }

  // Remember the PR base in git config rather than the DB: it survives a DB
  // reset, travels with the repo, and is exactly what `gh pr create --base`
  // wants later.
  if (base) {
    await git(['config', `branch.${branch}.${BASE_CONFIG_SUFFIX}`, base], root)
  }

  return {
    ok: true,
    worktree: { path: canonicalPath(target), branch, head: null, isMain: false }
  }
}

/**
 * Create a worktree for a branch that ALREADY exists (local or origin-only).
 * Attaches to the existing worktree when the branch is checked out elsewhere.
 */
export async function attachWorktree(input: {
  repoRoot: string
  branch: string
  path?: string
  /** Use `path` verbatim; see `CreateWorktreeInput.exactPath`. */
  exactPath?: boolean
}): Promise<WorktreeResult> {
  const { repoRoot: root, branch } = input
  if (!root || !branch) return { ok: false, error: 'attachWorktree: missing repoRoot or branch' }

  const existing = (await listWorktrees(root)).find((w) => w.branch === branch)
  if (existing) return { ok: true, worktree: existing, attached: true }

  const desired = input.path ?? worktreePathFor(root, branch)
  const target = input.exactPath ? desired : await uniquePath(desired)
  const localRef = await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], root)
  const args =
    localRef.ok && localRef.stdout.trim()
      ? ['worktree', 'add', target, branch]
      : // origin-only: create a local branch tracking the remote one
        ['worktree', 'add', '-b', branch, target, `origin/${branch}`]

  const add = await git(args, root)
  if (!add.ok) {
    return { ok: false, error: cleanGitError(add, `Could not check out "${branch}"`) }
  }
  return {
    ok: true,
    worktree: { path: canonicalPath(target), branch, head: null, isMain: false }
  }
}

/**
 * Remove a worktree and prune git's record of it.
 *
 * Two Windows-specific hazards, both handled here:
 *  - The command must run from the MAIN working tree. Running it with the
 *    worktree as cwd means our own process holds that directory open, and
 *    Windows refuses to delete it ("Permission denied") — on POSIX the same
 *    command happens to succeed, so this only ever fails on Windows.
 *  - It still fails if any OTHER process holds a handle inside (a dev server in
 *    node_modules/.next is the usual culprit), so callers must stop a session's
 *    background processes FIRST.
 */
export async function removeWorktree(
  worktreePath: string,
  opts: { force?: boolean; cwd?: string } = {}
): Promise<{ ok: boolean; error?: string }> {
  if (!worktreePath) return { ok: false, error: 'removeWorktree: missing path' }
  // `cwd` is the OWNING repo, and multi-repo callers must pass it. Deriving it
  // from the worktree works for a normal checkout but not for a composite
  // child: `git worktree remove` refuses ("not a working tree") unless it runs
  // in a repo that actually owns the path, and the composite ROOT is not a repo
  // at all, so there is nothing there to derive from.
  const root = opts.cwd ?? (await mainWorktreeRoot(worktreePath)) ?? worktreePath
  const args = ['worktree', 'remove']
  if (opts.force) args.push('--force')
  args.push(worktreePath)
  const r = await git(args, root)
  if (!r.ok) {
    // The directory may already be gone; prune git's stale record either way.
    await git(['worktree', 'prune'], root)
    try {
      await fs.stat(worktreePath)
    } catch {
      return { ok: true } // nothing left on disk — treat as removed
    }
    return { ok: false, error: cleanGitError(r, 'Could not remove the worktree') }
  }
  await git(['worktree', 'prune'], root)
  return { ok: true }
}

/**
 * Has this branch ever been pushed?
 *
 * Renaming a pushed branch is a trap: git renames only the LOCAL ref, so the
 * remote keeps the old name and the renamed branch still tracks it. The next
 * push either recreates the old branch or updates it under a name nobody
 * recognizes, and an open PR points at a branch that no longer exists locally.
 * So the rename paths refuse once a branch has an upstream.
 *
 * Reads config rather than `rev-parse @{upstream}` so it works for any branch,
 * not just the one currently checked out.
 */
export async function hasUpstreamBranch(cwd: string, branch: string): Promise<boolean> {
  if (!cwd || !branch) return false
  const r = await git(['config', '--get', `branch.${branch}.remote`], cwd)
  return r.ok && !!r.stdout.trim()
}

/** The branch a workstream should merge into, as recorded at creation. */
export async function baseBranchFor(cwd: string, branch: string): Promise<string | null> {
  const r = await git(['config', '--get', `branch.${branch}.${BASE_CONFIG_SUFFIX}`], cwd)
  const v = r.stdout.trim()
  return r.ok && v ? v : null
}

/** Turn a git failure into one readable line for the UI. */
function cleanGitError(r: GitResult, fallback: string): string {
  const text = (r.stderr || r.stdout).trim()
  if (!text) return fallback
  const first = text
    .split('\n')
    .map((l) => l.replace(/^fatal:\s*/i, '').trim())
    .find((l) => l.length > 0)
  return first ? `${fallback}: ${first}` : fallback
}

/** Initialize a git repository in `cwd` with default branch `main`. */
export async function initRepository(cwd: string): Promise<{ ok: boolean; error?: string }> {
  if (!cwd) return { ok: false, error: 'Missing repository directory.' }
  const r = await git(['init'], cwd)
  if (!r.ok) return { ok: false, error: cleanGitError(r, 'Failed to initialize repository') }
  await git(['branch', '-M', 'main'], cwd)
  return { ok: true }
}

/** Commit staged changes with the given message. Supports completing an active merge. */
export async function commitChanges(
  cwd: string,
  message: string,
  options?: { amend?: boolean; signoff?: boolean; all?: boolean }
): Promise<{ ok: boolean; error?: string; sha?: string }> {
  if (!cwd) return { ok: false, error: 'Missing repository directory.' }
  const msg = message.trim()
  const merging = await isMerging(cwd)
  if (!msg && !merging && !options?.amend) {
    return { ok: false, error: 'Commit message cannot be empty.' }
  }

  if (options?.all) {
    const add = await git(['add', '-A'], cwd)
    if (!add.ok) return { ok: false, error: cleanGitError(add, 'Failed to stage files') }
  }

  const commitArgs = ['commit']
  if (options?.amend) commitArgs.push('--amend')
  if (options?.signoff) commitArgs.push('--signoff')
  if (msg) commitArgs.push('-m', msg)
  else commitArgs.push('--no-edit')
  const r = await git(commitArgs, cwd)
  if (!r.ok) return { ok: false, error: cleanGitError(r, 'Commit failed') }

  const sha = await resolveCommit(cwd, 'HEAD')
  return { ok: true, sha: sha ?? undefined }
}

/** Move HEAD back one local commit while preserving that commit's changes staged. */
export async function undoLastCommit(cwd: string): Promise<{ ok: boolean; error?: string }> {
  if (!cwd) return { ok: false, error: 'Missing repository directory.' }
  if (await isMerging(cwd)) return { ok: false, error: 'Cannot undo a commit during a merge.' }

  const head = await git(['rev-parse', '--verify', 'HEAD'], cwd)
  if (!head.ok) return { ok: false, error: 'No commit to undo.' }

  const st = await status(cwd)
  if (st?.hasUpstream && st.ahead === 0) {
    return { ok: false, error: 'Latest commit is already synchronized.' }
  }

  const parent = await git(['rev-parse', '--verify', 'HEAD^'], cwd)
  const r = parent.ok
    ? await git(['reset', '--soft', 'HEAD^'], cwd)
    : await git(['update-ref', '-d', 'HEAD'], cwd)
  return r.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Failed to undo commit') }
}

/** Create a new branch at HEAD without changing the branch checked out in this worktree. */
export async function createBranch(
  cwd: string,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const branch = name.trim()
  if (!cwd || !branch) return { ok: false, error: 'Branch name cannot be empty.' }
  const valid = await git(['check-ref-format', '--branch', branch], cwd)
  if (!valid.ok) return { ok: false, error: `"${branch}" is not a valid branch name.` }
  const r = await git(['branch', branch, 'HEAD'], cwd)
  return r.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Failed to create branch') }
}

/** Create a lightweight tag at HEAD. */
export async function createTag(
  cwd: string,
  name: string
): Promise<{ ok: boolean; error?: string }> {
  const tag = name.trim()
  if (!cwd || !tag) return { ok: false, error: 'Tag name cannot be empty.' }
  const valid = await git(['check-ref-format', `refs/tags/${tag}`], cwd)
  if (!valid.ok) return { ok: false, error: `"${tag}" is not a valid tag name.` }
  const r = await git(['tag', tag, 'HEAD'], cwd)
  return r.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Failed to create tag') }
}

/** Stash tracked and untracked workspace changes. */
export async function stashChanges(cwd: string): Promise<{ ok: boolean; error?: string }> {
  if (!cwd) return { ok: false, error: 'Missing repository directory.' }
  const r = await git(['stash', 'push', '--include-untracked', '-m', 'Roxy manual stash'], cwd)
  return r.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Failed to stash changes') }
}

/** Apply and remove the latest stash. */
export async function popStash(cwd: string): Promise<{ ok: boolean; error?: string }> {
  if (!cwd) return { ok: false, error: 'Missing repository directory.' }
  const r = await git(['stash', 'pop'], cwd)
  return r.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Failed to pop stash') }
}

async function validBranchName(cwd: string, name: string): Promise<boolean> {
  return Boolean(name && (await git(['check-ref-format', '--branch', name], cwd)).ok)
}

function validRemoteName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)
}

/** Run a validated action exposed by the Git repository menu. */
export async function repositoryAction(
  cwd: string,
  action: GitRepositoryAction
): Promise<{ ok: boolean; error?: string }> {
  if (!cwd) return { ok: false, error: 'Missing repository directory.' }

  let args: string[]
  switch (action.type) {
    case 'checkout':
      if (action.detached) {
        args = ['checkout', '--detach', action.branch]
      } else {
        if (!(await validBranchName(cwd, action.branch))) {
          return { ok: false, error: 'Invalid branch name.' }
        }
        args = ['switch', action.branch]
      }
      break
    case 'renameBranch':
      if (!(await validBranchName(cwd, action.newName))) {
        return { ok: false, error: 'Invalid branch name.' }
      }
      args = action.oldName
        ? ['branch', '-m', action.oldName, action.newName]
        : ['branch', '-m', action.newName]
      break
    case 'merge':
      if (!(await validBranchName(cwd, action.branch))) {
        return { ok: false, error: 'Invalid branch name.' }
      }
      args = ['merge', action.branch]
      break
    case 'rebase':
      if (!(await validBranchName(cwd, action.branch))) {
        return { ok: false, error: 'Invalid branch name.' }
      }
      args = ['rebase', action.branch]
      break
    case 'abortRebase':
      args = ['rebase', '--abort']
      break
    case 'createBranchFrom':
      if (!(await validBranchName(cwd, action.name))) {
        return { ok: false, error: 'Invalid branch name.' }
      }
      args = ['branch', action.name, action.startPoint]
      break
    case 'deleteBranch':
      if (!(await validBranchName(cwd, action.name))) {
        return { ok: false, error: 'Invalid branch name.' }
      }
      args = ['branch', action.force ? '-D' : '-d', action.name]
      break
    case 'deleteRemoteBranch':
      if (!validRemoteName(action.remote) || !(await validBranchName(cwd, action.branch))) {
        return { ok: false, error: 'Invalid remote or branch name.' }
      }
      args = ['push', action.remote, '--delete', action.branch]
      break
    case 'publishBranch': {
      const branch = await currentBranch(cwd)
      if (!branch) return { ok: false, error: 'Not on a branch.' }
      args = ['push', '--set-upstream', 'origin', branch]
      break
    }
    case 'addRemote':
      if (!validRemoteName(action.name) || !action.url.trim()) {
        return { ok: false, error: 'Invalid remote name or URL.' }
      }
      args = ['remote', 'add', action.name, action.url.trim()]
      break
    case 'removeRemote':
      if (!validRemoteName(action.name)) return { ok: false, error: 'Invalid remote name.' }
      args = ['remote', 'remove', action.name]
      break
    case 'pull':
      if (action.remote && !validRemoteName(action.remote)) {
        return { ok: false, error: 'Invalid remote name.' }
      }
      if (action.branch && !(await validBranchName(cwd, action.branch))) {
        return { ok: false, error: 'Invalid branch name.' }
      }
      args = ['pull', ...(action.rebase ? ['--rebase'] : [])]
      if (action.remote) args.push(action.remote)
      if (action.branch) args.push(action.branch)
      break
    case 'push': {
      const remote = action.remote ?? 'origin'
      const branch = action.branch ?? (await currentBranch(cwd))
      if (!validRemoteName(remote) || !branch || !(await validBranchName(cwd, branch))) {
        return { ok: false, error: 'Invalid remote or branch name.' }
      }
      args = ['push', ...(action.force ? ['--force-with-lease'] : []), remote, branch]
      break
    }
    case 'fetch':
      args = ['fetch', ...(action.all ? ['--all'] : []), ...(action.prune ? ['--prune'] : [])]
      break
    case 'unstageAll':
      args = ['restore', '--staged', '.']
      break
    case 'stash':
      args = ['stash', 'push', '-m', action.message?.trim() || 'Roxy manual stash']
      if (action.mode === 'untracked') args.push('--include-untracked')
      if (action.mode === 'staged') args.push('--staged')
      break
    case 'stashApply':
      args = ['stash', 'apply', action.stash ?? 'stash@{0}']
      break
    case 'stashPop':
      args = ['stash', 'pop', action.stash ?? 'stash@{0}']
      break
    case 'stashDrop':
      args = ['stash', 'drop', action.stash ?? 'stash@{0}']
      break
    case 'stashClear':
      args = ['stash', 'clear']
      break
    case 'stashShow':
      args = ['stash', 'show', '--stat', '--patch', action.stash ?? 'stash@{0}']
      break
    case 'deleteTag':
      args = ['tag', '-d', action.name]
      break
    case 'deleteRemoteTag':
      if (!validRemoteName(action.remote)) return { ok: false, error: 'Invalid remote name.' }
      args = ['push', action.remote, '--delete', `refs/tags/${action.name}`]
      break
    case 'pushTags':
      if (action.remote && !validRemoteName(action.remote)) {
        return { ok: false, error: 'Invalid remote name.' }
      }
      args = ['push', action.remote ?? 'origin', '--tags']
      break
  }

  const result = await git(args, cwd, FETCH_TIMEOUT_MS)
  return result.ok
    ? { ok: true }
    : { ok: false, error: cleanGitError(result, 'Git operation failed') }
}

/** Fetch commit graph history including merges, branches, and author metadata. */
export async function getLogGraph(cwd: string, limit = 60): Promise<GitCommitNode[]> {
  if (!cwd) return []
  const r = await git(
    [
      'log',
      '--all',
      '--topo-order',
      '--format=%H%x00%h%x00%P%x00%an%x00%ar%x00%s%x00%D',
      '-n',
      String(Math.min(5000, Math.max(1, limit)))
    ],
    cwd
  )
  if (!r.ok || !r.stdout.trim()) return []

  const nodes: GitCommitNode[] = []
  const lines = r.stdout.split('\n').filter((l) => l.trim())
  for (const line of lines) {
    const parts = line.split('\x00')
    if (parts.length < 6) continue
    const [sha, shortSha, rawParents, author, date, message, rawRefs] = parts
    const parents = rawParents ? rawParents.trim().split(/\s+/).filter(Boolean) : []
    const refs = rawRefs
      ? rawRefs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    nodes.push({
      sha,
      shortSha: shortSha || sha.slice(0, 7),
      parents,
      isMerge: parents.length > 1,
      author: author || 'Unknown',
      date: date || '',
      message: (message || '').trim(),
      refs
    })
  }
  return nodes
}

/** Get list of files modified in a specific commit. */
export async function getCommitFiles(cwd: string, sha: string): Promise<GitChangedFile[]> {
  if (!cwd || !sha) return []
  const cleanSha = sha.trim()
  if (!/^[0-9a-fA-F]{7,40}$/.test(cleanSha)) return []

  const r = await git(
    ['diff-tree', '--no-commit-id', '--name-status', '-r', '--root', cleanSha],
    cwd
  )
  if (!r.ok || !r.stdout.trim()) return []

  const files: GitChangedFile[] = []
  const lines = r.stdout.split('\n').filter((l) => l.trim())
  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const rawStatus = parts[0].trim().toUpperCase()
    const filePath = parts[parts.length - 1].trim()
    let status: GitChangedFile['status'] = 'modified'
    if (rawStatus.startsWith('A')) status = 'added'
    else if (rawStatus.startsWith('D')) status = 'deleted'
    else if (rawStatus.startsWith('R')) status = 'renamed'
    else if (rawStatus.startsWith('C')) status = 'copied'

    files.push({
      path: filePath,
      status,
      staged: false
    })
  }
  return files
}

/** Get list of uncommitted changed files in `cwd`. */
export async function getChangedFiles(cwd: string): Promise<GitChangedFile[]> {
  if (!cwd) return []
  const r = await git(['status', '--porcelain=v1', '-uall'], cwd)
  if (!r.ok || !r.stdout.trim()) return []

  const list: GitChangedFile[] = []
  const lines = r.stdout.split('\n').filter((l) => l.trim())
  for (const line of lines) {
    if (line.length < 3) continue
    const x = line[0]
    const y = line[1]
    let filePath = line.slice(3).trim()
    if (filePath.includes(' -> ')) {
      const parts = filePath.split(' -> ')
      filePath = parts[parts.length - 1].trim()
    }
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1)
    }
    let status: GitChangedFile['status'] = 'modified'
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      status = 'conflict'
    } else if (x === '?' || y === '?') status = 'untracked'
    else if (x === 'A' || y === 'A') status = 'added'
    else if (x === 'D' || y === 'D') status = 'deleted'
    else if (x === 'R' || y === 'R') status = 'renamed'
    else if (x === 'C' || y === 'C') status = 'copied'
    list.push({
      path: filePath,
      status,
      staged: x !== ' ' && x !== '?' && x !== 'U'
    })
  }
  return list
}

/** Fetch before/after content of a file for diffing. */
export async function getFileDiff(
  cwd: string,
  filePath: string,
  sha?: string
): Promise<GitFileDiffResult> {
  if (!cwd || !filePath) {
    return { path: filePath, before: '', after: '', ok: false, error: 'Missing path or cwd' }
  }

  const root = await repoRoot(cwd)
  if (!root) {
    return { path: filePath, before: '', after: '', ok: false, error: 'Not a git repository' }
  }

  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '')

  try {
    if (sha && sha.trim()) {
      const cleanSha = sha.trim()
      if (!/^[0-9a-fA-F]{7,40}$/.test(cleanSha)) {
        return { path: filePath, before: '', after: '', ok: false, error: 'Invalid commit SHA' }
      }

      const [afterRes, beforeRes] = await Promise.all([
        git(['show', `${cleanSha}:${normalizedPath}`], cwd),
        git(['show', `${cleanSha}~1:${normalizedPath}`], cwd)
      ])

      const after = afterRes.ok ? afterRes.stdout : ''
      const before = beforeRes.ok ? beforeRes.stdout : ''

      const isBinary = after.includes('\0') || before.includes('\0')
      return {
        path: filePath,
        before: isBinary ? '' : before,
        after: isBinary ? '' : after,
        isBinary,
        ok: true
      }
    } else {
      const isIgnored = await git(['check-ignore', '-q', normalizedPath], cwd)
      if (isIgnored.code === 0) {
        return { path: filePath, before: '', after: '', ok: false, error: 'File is ignored by git' }
      }

      // Uncommitted changes in working tree: before is HEAD, after is current working file
      const beforeRes = await git(['show', `HEAD:${normalizedPath}`], cwd)
      const before = beforeRes.ok ? beforeRes.stdout : ''

      let after = ''
      try {
        const fullPath = path.resolve(cwd, filePath)
        after = await fs.readFile(fullPath, 'utf-8')
      } catch {
        after = ''
      }

      const isBinary = after.includes('\0') || before.includes('\0')
      return {
        path: filePath,
        before: isBinary ? '' : before,
        after: isBinary ? '' : after,
        isBinary,
        ok: true
      }
    }
  } catch (e) {
    return {
      path: filePath,
      before: '',
      after: '',
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/** Initialize, commit, add origin remote, and push to publish current workspace. */
export async function publishWorkspace(
  cwd: string,
  remoteUrlStr: string
): Promise<{ ok: boolean; error?: string }> {
  if (!cwd) return { ok: false, error: 'Missing repository directory.' }
  const url = remoteUrlStr.trim()
  if (!url) return { ok: false, error: 'Missing remote URL.' }

  const isRepo = await repoRoot(cwd)
  if (!isRepo) {
    const initRes = await initRepository(cwd)
    if (!initRes.ok) return initRes
  }

  const hasRemote = await hasOrigin(cwd)
  if (hasRemote) {
    await git(['remote', 'set-url', 'origin', url], cwd)
  } else {
    const remoteRes = await git(['remote', 'add', 'origin', url], cwd)
    if (!remoteRes.ok)
      return { ok: false, error: cleanGitError(remoteRes, 'Failed to add remote origin') }
  }

  const head = await resolveCommit(cwd, 'HEAD')
  if (!head) {
    await git(['add', '-A'], cwd)
    const initCommit = await git(['commit', '-m', 'Initial commit'], cwd)
    if (!initCommit.ok)
      return { ok: false, error: cleanGitError(initCommit, 'Failed to create initial commit') }
  }

  const branch = (await currentBranch(cwd)) || 'main'
  if (branch === 'master') {
    await git(['branch', '-M', 'main'], cwd)
  }
  const finalBranch = (await currentBranch(cwd)) || 'main'
  return pushBranch(cwd, finalBranch, { setUpstream: true })
}

/** Call GitHub API to create a new repository for the current user. */
export async function createGitHubRepo(
  name: string,
  opts: { description?: string; isPrivate?: boolean; token?: string } = {}
): Promise<{ ok: boolean; cloneUrl?: string; htmlUrl?: string; error?: string }> {
  let token = opts.token?.trim()
  if (!token) {
    const cred = await getCredential('github.com')
    if (cred?.password) {
      token = cred.password
    }
  }

  if (!token) {
    return {
      ok: false,
      error:
        'No GitHub token found. Please sign in with Git Credential Manager or enter a Personal Access Token.'
    }
  }

  try {
    const res = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Roxy-App',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name.trim(),
        description: opts.description?.trim() || undefined,
        private: opts.isPrivate !== false,
        auto_init: false
      })
    })

    const data = (await res.json()) as {
      clone_url?: string
      html_url?: string
      message?: string
      errors?: Array<{ message: string }>
    }

    if (res.status === 201 && data.clone_url) {
      return {
        ok: true,
        cloneUrl: data.clone_url,
        htmlUrl: data.html_url
      }
    }

    const detail = data.errors?.map((e) => e.message).join('; ')
    const errMsg = detail
      ? `${data.message}: ${detail}`
      : data.message || `GitHub API error (${res.status})`
    return { ok: false, error: errMsg }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/** Create a GitHub repository and publish the current workspace to it. */
export async function createAndPublishGitHub(
  cwd: string,
  input: { name: string; description?: string; isPrivate?: boolean; token?: string }
): Promise<{ ok: boolean; url?: string; cloneUrl?: string; error?: string }> {
  if (!cwd) return { ok: false, error: 'Missing repository directory.' }
  if (!input.name || !input.name.trim()) {
    return { ok: false, error: 'Missing repository name.' }
  }

  const ghRes = await createGitHubRepo(input.name.trim(), {
    description: input.description,
    isPrivate: input.isPrivate,
    token: input.token
  })

  if (!ghRes.ok || !ghRes.cloneUrl) {
    return { ok: false, error: ghRes.error || 'Failed to create GitHub repository.' }
  }

  const pushUrl = input.token
    ? ghRes.cloneUrl.replace('https://', `https://${encodeURIComponent(input.token)}@`)
    : ghRes.cloneUrl

  const pubRes = await publishWorkspace(cwd, pushUrl)
  if (input.token) {
    await git(['remote', 'set-url', 'origin', ghRes.cloneUrl], cwd)
  }

  if (!pubRes.ok) {
    return {
      ok: false,
      url: ghRes.htmlUrl,
      cloneUrl: ghRes.cloneUrl,
      error: `Repository created at ${ghRes.htmlUrl}, but push failed: ${pubRes.error}`
    }
  }

  return {
    ok: true,
    url: ghRes.htmlUrl,
    cloneUrl: ghRes.cloneUrl
  }
}

/** Revert uncommitted changes to a specific file (restore tracked to HEAD, or delete untracked). */
export async function revertFile(
  cwd: string,
  filePath: string
): Promise<{ ok: boolean; error?: string }> {
  if (!cwd || !filePath) return { ok: false, error: 'Missing path or directory' }
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '')

  // Check if file is untracked
  const statusRes = await git(['status', '--porcelain=v1', '--', normalizedPath], cwd)
  if (statusRes.ok && statusRes.stdout.trim().startsWith('??')) {
    try {
      const fullPath = path.resolve(cwd, filePath)
      await fs.rm(fullPath, { recursive: true, force: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  // Restore tracked file from HEAD (staged + worktree)
  const r = await git(['restore', '--staged', '--worktree', '--', normalizedPath], cwd)
  if (r.ok) return { ok: true }

  const r2 = await git(['checkout', 'HEAD', '--', normalizedPath], cwd)
  return r2.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Failed to revert file') }
}

/** Revert all uncommitted working tree changes in `cwd`. */
export async function revertAll(cwd: string): Promise<{ ok: boolean; error?: string }> {
  if (!cwd) return { ok: false, error: 'Missing directory' }
  const r1 = await git(['restore', '--staged', '--worktree', '.'], cwd)
  const r2 = await git(['clean', '-fd'], cwd)
  return r1.ok && r2.ok
    ? { ok: true }
    : { ok: false, error: cleanGitError(r1.ok ? r2 : r1, 'Failed to revert all changes') }
}

/** Stage a file in git. */
export async function stageFile(
  cwd: string,
  filePath: string
): Promise<{ ok: boolean; error?: string }> {
  if (!cwd || !filePath) return { ok: false, error: 'Missing path or directory' }
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const r = await git(['add', '--', normalizedPath], cwd)
  return r.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Failed to stage file') }
}

/** Unstage a file from git index. */
export async function unstageFile(
  cwd: string,
  filePath: string
): Promise<{ ok: boolean; error?: string }> {
  if (!cwd || !filePath) return { ok: false, error: 'Missing path or directory' }
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const r = await git(['restore', '--staged', '--', normalizedPath], cwd)
  return r.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Failed to unstage file') }
}

/** Stage all workspace changes in git. */
export async function stageAll(cwd: string): Promise<{ ok: boolean; error?: string }> {
  if (!cwd) return { ok: false, error: 'Missing directory' }
  const r = await git(['add', '-A'], cwd)
  return r.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Failed to stage changes') }
}

/** Save resolved conflict file content to disk and stage it in git. */
export async function resolveConflict(
  cwd: string,
  filePath: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  if (!cwd || !filePath) return { ok: false, error: 'Missing path or directory' }
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const fullPath = path.resolve(cwd, filePath)
  try {
    await fs.writeFile(fullPath, content, 'utf-8')
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  const r = await git(['add', '--', normalizedPath], cwd)
  return r.ok
    ? { ok: true }
    : { ok: false, error: cleanGitError(r, 'Failed to stage resolved conflict') }
}

/** Check whether git is in an active merge state (.git/MERGE_HEAD). */
export async function isMerging(cwd: string): Promise<boolean> {
  if (!cwd) return false
  try {
    const gitDirRes = await git(['rev-parse', '--git-dir'], cwd)
    if (!gitDirRes.ok || !gitDirRes.stdout.trim()) return false
    const gitDir = path.resolve(cwd, gitDirRes.stdout.trim())
    const mergeHead = path.join(gitDir, 'MERGE_HEAD')
    await fs.access(mergeHead)
    return true
  } catch {
    return false
  }
}

/** Check whether git is in an active rebase state (.git/rebase-merge or .git/rebase-apply). */
export async function isRebasing(cwd: string): Promise<boolean> {
  if (!cwd) return false
  try {
    const gitDirRes = await git(['rev-parse', '--git-dir'], cwd)
    if (!gitDirRes.ok || !gitDirRes.stdout.trim()) return false
    const gitDir = path.resolve(cwd, gitDirRes.stdout.trim())
    const rebaseMerge = path.join(gitDir, 'rebase-merge')
    const rebaseApply = path.join(gitDir, 'rebase-apply')
    const hasMerge = await fs.access(rebaseMerge).then(() => true, () => false)
    const hasApply = await fs.access(rebaseApply).then(() => true, () => false)
    return hasMerge || hasApply
  } catch {
    return false
  }
}

/** Abort a merge in progress (`git merge --abort`). */
export async function abortMerge(cwd: string): Promise<{ ok: boolean; error?: string }> {
  if (!cwd) return { ok: false, error: 'Missing directory' }
  const r = await git(['merge', '--abort'], cwd)
  return r.ok ? { ok: true } : { ok: false, error: cleanGitError(r, 'Failed to abort merge') }
}
