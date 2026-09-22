import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

let portableResolved = false
let portableActive = false
let portableDir: string | null = null

/**
 * Reset cached portable-mode state. Used only by automated tests.
 */
export function _resetPortableModeForTests(): void {
  portableResolved = false
  portableActive = false
  portableDir = null
}

function isInstalledApp(execDir: string): boolean {
  try {
    const uninstaller = path.join(execDir, 'Uninstall roxy.exe')
    if (fs.existsSync(uninstaller)) return true

    const localAppData = process.env.LOCALAPPDATA
    const programFiles = process.env.ProgramFiles
    const programFilesX86 = process.env['ProgramFiles(x86)']

    const normalized = path.resolve(execDir).toLowerCase()
    if (
      localAppData &&
      normalized.startsWith(path.resolve(localAppData, 'Programs').toLowerCase())
    ) {
      return true
    }
    if (programFiles && normalized.startsWith(path.resolve(programFiles).toLowerCase())) {
      return true
    }
    if (programFilesX86 && normalized.startsWith(path.resolve(programFilesX86).toLowerCase())) {
      return true
    }
  } catch {
    // fallback
  }
  return false
}

/**
 * Determine whether Roxy is running in portable mode.
 *
 * Detected via:
 * 1. `PORTABLE_EXECUTABLE_DIR` environment variable (injected by electron-builder's portable launcher)
 * 2. `--portable` command line flag
 * 3. `ROXY_PORTABLE=1` environment variable
 * 4. A `data` directory or `.portable` marker file next to the packaged executable (VS Code style)
 * 5. Packaged standalone folder (ZIP distribution) running outside Windows installer directories
 */
export function isPortableMode(): boolean {
  if (portableResolved) return portableActive

  // 1. electron-builder portable executable target
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    portableActive = true
    portableDir = process.env.PORTABLE_EXECUTABLE_DIR
    portableResolved = true
    return true
  }

  // 2. Explicit flag or environment variable
  if (process.argv.includes('--portable') || process.env.ROXY_PORTABLE === '1') {
    portableActive = true
    portableDir = app.isPackaged
      ? path.dirname(process.execPath)
      : path.join(process.cwd(), '.portable-data')
    portableResolved = true
    return true
  }

  // 3. Packaged folder checks
  if (app.isPackaged) {
    try {
      const execDir = path.dirname(process.execPath)
      const dataPath = path.join(execDir, 'data')
      const markerPath = path.join(execDir, '.portable')

      // Explicit data folder or .portable marker takes priority
      if (
        (fs.existsSync(dataPath) && fs.statSync(dataPath).isDirectory()) ||
        fs.existsSync(markerPath)
      ) {
        portableActive = true
        portableDir = execDir
        portableResolved = true
        return true
      }

      // Standalone folder (ZIP release) running outside standard installer paths
      if (!isInstalledApp(execDir)) {
        portableActive = true
        portableDir = execDir
        portableResolved = true
        return true
      }
    } catch {
      // ignore filesystem check failure
    }
  }

  portableResolved = true
  portableActive = false
  return false
}

/**
 * Get the path to the portable data directory, or null if not in portable mode.
 */
export function getPortableDataDir(): string | null {
  if (!isPortableMode() || !portableDir) return null
  return path.join(portableDir, 'data')
}

/**
 * Initialize portable mode paths before app is ready and before single-instance lock.
 * Directs Electron's `userData` and `temp` directories into the portable `data/` folder.
 */
export function initPortableMode(): boolean {
  if (!isPortableMode()) return false

  const dataDir = getPortableDataDir()
  if (!dataDir) return false

  try {
    fs.mkdirSync(dataDir, { recursive: true })
    app.setPath('userData', dataDir)
  } catch (err) {
    console.error('[portable] Failed to configure userData path:', err)
    return false
  }

  try {
    const tempDir = path.join(dataDir, 'temp')
    fs.mkdirSync(tempDir, { recursive: true })
    app.setPath('temp', tempDir)
  } catch {
    // Keep host temp as safe fallback
  }

  return true
}
