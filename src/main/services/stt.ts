/**
 * Speech-to-Text (STT) local transcription service.
 *
 * Uses running Roxy voice server (port 5050) if available,
 * or spawns `script/transcribe.py` on-demand using faster-whisper.
 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { getSettings } from '../db/repo'

const TTS_URL = process.env.ROXY_TTS_URL ?? 'http://127.0.0.1:5050'

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

export async function getSttStatus(): Promise<{ installed: boolean; pythonPath: string }> {
  const pyExe = resolvePython()
  let installed = false
  try {
    const testPy = spawn(pyExe, ['-c', 'import faster_whisper'], { windowsHide: true })
    installed = await new Promise<boolean>((resolve) => {
      testPy.on('close', (code) => resolve(code === 0))
      testPy.on('error', () => resolve(false))
    })
  } catch {
    installed = false
  }
  return { installed, pythonPath: pyExe }
}

export async function installSttDependencies(
  onChunk?: (chunk: string) => void
): Promise<{ ok: boolean; log: string }> {
  const pyExe = resolvePython()
  return new Promise<{ ok: boolean; log: string }>((resolve) => {
    let output = ''
    try {
      const proc = spawn(pyExe, ['-m', 'pip', 'install', '--upgrade', 'faster-whisper'], {
        windowsHide: true
      })
      proc.stdout?.on('data', (d) => {
        const text = d.toString()
        output += text
        onChunk?.(text)
      })
      proc.stderr?.on('data', (d) => {
        const text = d.toString()
        output += text
        onChunk?.(text)
      })
      proc.on('close', (code) => {
        resolve({ ok: code === 0, log: output })
      })
      proc.on('error', (err) => {
        const msg = `[STT] Failed to launch pip: ${err.message}`
        output += `\n${msg}`
        onChunk?.(msg)
        resolve({ ok: false, log: output })
      })
    } catch (e) {
      resolve({ ok: false, log: String(e) })
    }
  })
}

function resolveScript(name: string): string {
  if (app.isPackaged) {
    const candidates = [
      path.join(process.resourcesPath, 'script', name),
      path.join(process.resourcesPath, name),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'script', name),
      path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'script', name)
    ]
    for (const c of candidates) {
      if (fs.existsSync(c)) return c
    }

    try {
      const asarScript = path.join(app.getAppPath(), 'script', name)
      if (fs.existsSync(asarScript)) {
        const tempDir = path.join(app.getPath('temp'), 'roxy-scripts')
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
        const tempPath = path.join(tempDir, name)
        fs.writeFileSync(tempPath, fs.readFileSync(asarScript))
        return tempPath
      }
    } catch (e) {
      console.warn('[STT] Failed to extract script from asar to temp:', e)
    }

    return path.join(process.resourcesPath, 'script', name)
  }

  const candidates = [
    path.join(process.cwd(), 'script', name),
    path.join(app.getAppPath(), 'script', name)
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[0]
}

async function isServerAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(600) })
    return res.ok
  } catch {
    return false
  }
}

export async function getInstalledWhisperModels(): Promise<string[]> {
  const pyExe = resolvePython()
  const scriptPath = resolveScript('transcribe.py')
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const proc = spawn(pyExe, [scriptPath, '--list-installed'], { windowsHide: true })
      let stdout = ''
      proc.stdout?.on('data', (d) => (stdout += d.toString()))
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`Exit code ${code}`))
      })
      proc.on('error', reject)
    })
    const parsed = JSON.parse(output.trim()) as { ok?: boolean; installed?: string[] }
    return parsed.installed ?? []
  } catch (err) {
    console.warn('[STT] Failed to list installed models:', err)
    return []
  }
}

export async function downloadWhisperModel(
  modelName: string,
  onProgress?: (progress: { percent: number; current: number; total: number }) => void
): Promise<{ ok: boolean; error?: string }> {
  const pyExe = resolvePython()
  const scriptPath = resolveScript('transcribe.py')
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    try {
      const proc = spawn(pyExe, [scriptPath, '--download-model', modelName], {
        windowsHide: true,
        env: {
          ...process.env,
          HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
          PYTHONWARNINGS: 'ignore'
        }
      })
      let errText = ''
      let buffer = ''

      proc.stdout?.on('data', (d) => {
        buffer += d.toString()
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const data = JSON.parse(trimmed) as {
              type?: string
              percent?: number
              current?: number
              total?: number
              error?: string
            }
            if (data.type === 'progress' && typeof data.percent === 'number') {
              onProgress?.({
                percent: data.percent,
                current: data.current ?? 0,
                total: data.total ?? 0
              })
            }
            if (data.type === 'error' && data.error) {
              errText = data.error
            }
          } catch {
            // Not JSON
          }
        }
      })

      proc.stderr?.on('data', (d) => {
        errText += d.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ ok: true })
        } else {
          resolve({ ok: false, error: errText.trim() || `Process exited with code ${code}` })
        }
      })

      proc.on('error', (err) => {
        resolve({ ok: false, error: err.message })
      })
    } catch (e: unknown) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) })
    }
  })
}

export async function transcribeAudio(
  buffer: Buffer,
  options?: {
    language?: string
    model?: string
    task?: string
    initialPrompt?: string
    beamSize?: number
  }
): Promise<{ text: string }> {
  const settings = getSettings()
  const rawLang =
    options?.language ??
    (settings.voiceLang && settings.voiceLang !== 'auto' ? settings.voiceLang : undefined)
  const language = rawLang && rawLang !== 'auto' ? rawLang : undefined
  const task = options?.task ?? 'transcribe'
  const beamSize = options?.beamSize ?? 5
  const initialPrompt = options?.initialPrompt
  const effectiveModel = options?.model ?? settings.voiceModel ?? 'base'

  // 1. Try running HTTP voice daemon first for low latency
  if (await isServerAlive()) {
    try {
      const res = await fetch(`${TTS_URL}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio: buffer.toString('base64'),
          model: effectiveModel,
          language,
          task,
          initial_prompt: initialPrompt,
          beam_size: beamSize
        }),
        signal: AbortSignal.timeout(60000)
      })
      if (res.ok) {
        const data = (await res.json()) as { ok?: boolean; text?: string; error?: string }
        if (data.ok && typeof data.text === 'string') {
          return { text: data.text.trim() }
        }
        if (data.error) {
          throw new Error(data.error)
        }
      }
    } catch (e) {
      console.warn('[STT] HTTP transcription failed, falling back to process spawn:', e)
    }
  }

  // 2. Fallback: run script/transcribe.py directly via child_process
  const scriptPath = resolveScript('transcribe.py')
  const tmpDir = path.join(app.getPath('temp'), 'roxy-stt')
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true })
  }
  const tmpAudioPath = path.join(
    tmpDir,
    `rec_${Date.now()}_${Math.random().toString(36).slice(2)}.wav`
  )
  fs.writeFileSync(tmpAudioPath, buffer)

  try {
    const args = [
      scriptPath,
      tmpAudioPath,
      '--model',
      effectiveModel,
      '--beam-size',
      String(beamSize)
    ]
    if (language) {
      args.push('--language', language)
    }
    if (task) {
      args.push('--task', task)
    }
    if (initialPrompt) {
      args.push('--initial-prompt', initialPrompt)
    }
    const pyExe = resolvePython()
    const output = await new Promise<string>((resolve, reject) => {
      const proc = spawn(pyExe, args, {
        windowsHide: true,
        env: {
          ...process.env,
          HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
          PYTHONWARNINGS: 'ignore'
        }
      })
      let stdout = ''
      let stderr = ''
      proc.stdout?.on('data', (d) => (stdout += d.toString()))
      proc.stderr?.on('data', (d) => (stderr += d.toString()))
      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout)
        } else {
          try {
            const parsed = JSON.parse(stdout.trim()) as { ok?: boolean; error?: string }
            if (parsed.error) {
              reject(new Error(parsed.error))
              return
            }
          } catch {
            // Not json
          }
          reject(new Error(stderr.trim() || stdout.trim() || `Process exited with code ${code}`))
        }
      })
      proc.on('error', (err) => reject(err))
    })

    const parsed = JSON.parse(output.trim()) as { ok: boolean; text?: string; error?: string }
    if (parsed.ok && typeof parsed.text === 'string') {
      return { text: parsed.text.trim() }
    }
    throw new Error(parsed.error || 'Failed to transcribe audio')
  } finally {
    try {
      if (fs.existsSync(tmpAudioPath)) {
        fs.unlinkSync(tmpAudioPath)
      }
    } catch {
      // Best effort cleanup
    }
  }
}
