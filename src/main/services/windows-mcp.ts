import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'
import { app } from 'electron'
import * as repo from '../db/repo'
import { reconnectMcpServer } from './mcp'

const execFileAsync = promisify(execFile)

/** Candidate paths for uvx.exe on Windows. */
export function resolveUvxBinary(): string | null {
  const home = os.homedir()
  const localAppData = process.env.LOCALAPPDATA || ''
  const candidates = [
    path.join(home, '.local', 'bin', 'uvx.exe'),
    path.join(home, '.cargo', 'bin', 'uvx.exe'),
    path.join(localAppData, 'Programs', 'uv', 'uvx.exe'),
    path.join(localAppData, 'bin', 'uvx.exe')
  ]
  for (const c of candidates) {
    if (c && existsSync(c)) return c
  }
  return null
}

export async function findUvx(): Promise<string | null> {
  const resolved = resolveUvxBinary()
  if (resolved) return resolved

  try {
    const { stdout } = await execFileAsync('where.exe', ['uvx'])
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length > 0 && existsSync(lines[0])) {
      return lines[0]
    }
  } catch {
    // where.exe exits 1 if not in PATH
  }
  return null
}

export async function installUv(): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        'irm https://astral.sh/uv/install.ps1 | iex'
      ],
      { timeout: 120_000, windowsHide: true }
    )

    const uvx = await findUvx()
    if (!uvx) {
      return { ok: false, error: 'uv installed but uvx executable not found in standard paths' }
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: `Failed to install uv: ${err instanceof Error ? err.message : String(err)}`
    }
  }
}

export async function setupWindowsMcp(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Windows-MCP is only supported on Windows' }
  }

  let uvxPath = await findUvx()
  if (!uvxPath) {
    const installRes = await installUv()
    if (!installRes.ok) {
      return installRes
    }
    uvxPath = await findUvx()
    if (!uvxPath) {
      return { ok: false, error: 'Could not locate uvx after installation' }
    }
  }

  // Pre-warm windows-mcp (downloads package and Python runtime into uv cache if needed)
  try {
    await execFileAsync(uvxPath, ['windows-mcp', '--help'], {
      timeout: 180_000,
      windowsHide: true
    })
  } catch (err) {
    console.warn('Prewarming windows-mcp completed with warning:', err)
  }

  // Upsert server record
  repo.upsertMcpServer({
    id: 'windows-mcp',
    config: {
      type: 'local',
      command: [uvxPath, 'windows-mcp', 'serve'],
      environment: {
        ANONYMIZED_TELEMETRY: 'false'
      }
    },
    enabled: true
  })

  // Trigger live connection
  const rec = repo.listMcpServers().find((r) => r.id === 'windows-mcp')
  if (rec) {
    await reconnectMcpServer(rec, app.getPath('home'))
  }

  return { ok: true }
}
