import { execFile } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'
import { app } from 'electron'
import * as repo from '../db/repo'
import { reconnectMcpServer } from './mcp'

const execFileAsync = promisify(execFile)

/** Find system node executable to spawn JS scripts directly. */
export function resolveNodeBinary(): string {
  if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\nodejs\\node.exe',
      path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'node', 'node.exe')
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }
    return 'node.exe'
  }
  for (const c of ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']) {
    if (existsSync(c)) return c
  }
  return 'node'
}

/** Locate mcp-desktop.js from global npm installation. */
export function resolveScreenhandEntry(): string | null {
  const home = os.homedir()
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(
            process.env.APPDATA ?? '',
            'npm',
            'node_modules',
            'screenhand',
            'dist',
            'mcp-desktop.js'
          ),
          path.join(
            home,
            'AppData',
            'Roaming',
            'npm',
            'node_modules',
            'screenhand',
            'dist',
            'mcp-desktop.js'
          )
        ]
      : [
          '/usr/local/lib/node_modules/screenhand/dist/mcp-desktop.js',
          '/opt/homebrew/lib/node_modules/screenhand/dist/mcp-desktop.js',
          path.join(
            home,
            '.npm-global',
            'lib',
            'node_modules',
            'screenhand',
            'dist',
            'mcp-desktop.js'
          )
        ]

  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

export async function installScreenhandGlobal(): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'npm install -g screenhand'],
        { timeout: 180_000, windowsHide: true }
      )
    } else {
      await execFileAsync('npm', ['install', '-g', 'screenhand'], {
        timeout: 180_000
      })
    }
    return true
  } catch (err) {
    console.warn('npm install -g screenhand failed:', err)
    return false
  }
}

/**
 * Builds the C# native bridge for ScreenHand on Windows if not already present.
 * Patches upstream npm package issues (missing WPF flag, using System.IO, nullable types).
 */
export async function ensureWindowsBridge(entryPath: string): Promise<void> {
  if (process.platform !== 'win32') return
  const pkgRoot = path.resolve(path.dirname(entryPath), '..')
  const expectedBin = path.join(
    pkgRoot,
    'native',
    'windows-bridge',
    'bin',
    'Release',
    'net8.0-windows',
    'windows-bridge.exe'
  )
  const distExpectedBin = path.join(
    pkgRoot,
    'dist',
    'native',
    'windows-bridge',
    'bin',
    'Release',
    'net8.0-windows',
    'windows-bridge.exe'
  )
  const win32Bin = path.join(pkgRoot, 'bin', 'win32-x64', 'windows-bridge.exe')
  if (existsSync(expectedBin) && existsSync(distExpectedBin) && existsSync(win32Bin)) return

  const projDir = path.join(pkgRoot, 'native', 'windows-bridge')
  const projFile = path.join(projDir, 'WindowsBridge.csproj')
  if (!existsSync(projFile)) return

  try {
    // 1. Ensure WPF reference for UIAutomationClient
    const csprojContent = readFileSync(projFile, 'utf8')
    if (!csprojContent.includes('<UseWPF>')) {
      const fixed = csprojContent.replace(
        '<UseWindowsForms>true</UseWindowsForms>',
        '<UseWindowsForms>true</UseWindowsForms>\r\n    <UseWPF>true</UseWPF>'
      )
      writeFileSync(projFile, fixed, 'utf8')
    }

    // 2. Ensure using System.IO in ScreenCapture.cs
    const captureFile = path.join(projDir, 'ScreenCapture.cs')
    if (existsSync(captureFile)) {
      const captureContent = readFileSync(captureFile, 'utf8')
      if (!captureContent.includes('using System.IO;')) {
        writeFileSync(captureFile, 'using System.IO;\r\n' + captureContent, 'utf8')
      }
    }

    // 3. Fix non-nullable types in Program.cs
    const progFile = path.join(projDir, 'Program.cs')
    if (existsSync(progFile)) {
      let progContent = readFileSync(progFile, 'utf8')
      progContent = progContent.replace('Param<bool>(p, "exact")', 'Param<bool?>(p, "exact")')
      progContent = progContent.replace('Param<int>(p, "maxDepth")', 'Param<int?>(p, "maxDepth")')
      progContent = progContent.replace(
        'Param<int>(p, "clickCount")',
        'Param<int?>(p, "clickCount")'
      )
      progContent = progContent.replace('Param<int>(p, "deltaX")', 'Param<int?>(p, "deltaX")')
      progContent = progContent.replace('Param<int>(p, "deltaY")', 'Param<int?>(p, "deltaY")')
      writeFileSync(progFile, progContent, 'utf8')
    }

    // 4. Build with dotnet
    await execFileAsync('dotnet', ['build', '-c', 'Release', projFile], {
      windowsHide: true,
      timeout: 120_000
    })

    // 5. Mirror to dist/native/windows-bridge and bin/win32-x64
    const binDir = path.join(pkgRoot, 'bin', 'win32-x64')
    const distBinDir = path.dirname(distExpectedBin)
    mkdirSync(binDir, { recursive: true })
    mkdirSync(distBinDir, { recursive: true })
    const releaseDir = path.dirname(expectedBin)
    if (existsSync(releaseDir)) {
      for (const file of readdirSync(releaseDir)) {
        if (file.startsWith('windows-bridge.')) {
          copyFileSync(path.join(releaseDir, file), path.join(binDir, file))
          copyFileSync(path.join(releaseDir, file), path.join(distBinDir, file))
        }
      }
    }
  } catch (err) {
    console.warn('Compiling windows-bridge failed:', err)
  }
}

export async function setupScreenhand(): Promise<{ ok: boolean; error?: string }> {
  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    return { ok: false, error: 'ScreenHand is currently supported on macOS and Windows' }
  }

  let entry = resolveScreenhandEntry()
  if (!entry) {
    const installed = await installScreenhandGlobal()
    if (!installed) {
      return { ok: false, error: 'Failed to install screenhand via npm' }
    }
    entry = resolveScreenhandEntry()
    if (!entry) {
      return { ok: false, error: 'ScreenHand entry script not found after install' }
    }
  }

  // Ensure native Windows UIAutomation bridge is built
  await ensureWindowsBridge(entry)

  const nodeExe = resolveNodeBinary()

  // Pre-warm screenhand directly with node (avoids cmd.exe / EINVAL issues)
  try {
    await execFileAsync(nodeExe, [entry, '--info'], {
      timeout: 60_000,
      windowsHide: true
    })
  } catch (err) {
    console.warn('Prewarming screenhand completed with warning:', err)
  }

  // Upsert server record
  repo.upsertMcpServer({
    id: 'screenhand',
    config: {
      type: 'local',
      command: [nodeExe, entry]
    },
    enabled: true
  })

  // Trigger live connection
  const rec = repo.listMcpServers().find((s) => s.id === 'screenhand')
  if (rec) {
    await reconnectMcpServer(rec, app.getPath('home'))
  }

  return { ok: true }
}
