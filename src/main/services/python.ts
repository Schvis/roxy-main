/** Locate a Python interpreter for the local RVC TTS server. */
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

let cachedPythonPath: string | null = null

export function resolvePython(): string {
  if (cachedPythonPath && fs.existsSync(cachedPythonPath)) {
    return cachedPythonPath
  }

  const candidates: string[] = []

  if (process.env.PYTHON_PATH) {
    candidates.push(process.env.PYTHON_PATH)
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? ''
    const programFiles = process.env.ProgramFiles ?? ''
    const userProfile = process.env.USERPROFILE ?? ''

    const pyVersions = ['Python312', 'Python311', 'Python310', 'Python39']
    for (const v of pyVersions) {
      if (localAppData) {
        candidates.push(path.join(localAppData, 'Programs', 'Python', v, 'python.exe'))
      }
      if (userProfile) {
        candidates.push(
          path.join(userProfile, 'AppData', 'Local', 'Programs', 'Python', v, 'python.exe')
        )
      }
      if (programFiles) {
        candidates.push(path.join(programFiles, v, 'python.exe'))
      }
    }

    candidates.push(
      path.join(process.cwd(), '.venv', 'Scripts', 'python.exe'),
      path.join(process.cwd(), 'venv', 'Scripts', 'python.exe'),
      path.join(app.getAppPath(), '.venv', 'Scripts', 'python.exe'),
      path.join(app.getAppPath(), 'venv', 'Scripts', 'python.exe')
    )
  } else {
    candidates.push(
      path.join(process.cwd(), '.venv', 'bin', 'python'),
      path.join(process.cwd(), 'venv', 'bin', 'python'),
      '/usr/local/bin/python3',
      '/opt/homebrew/bin/python3',
      '/usr/bin/python3'
    )
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedPythonPath = c
      return c
    }
  }

  return 'python'
}
