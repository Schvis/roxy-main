/**
 * Text-to-Speech (TTS) integration with local RVC voice server.
 *
 * Streams chat responses to background Python RVC daemon on 127.0.0.1:5050.
 * Non-blocking, best-effort: silently skips if the voice server is offline.
 */
import type { LlmEvent } from '../../shared/api'
import type { AppSettings } from '../../shared/types'
import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getSettings } from '../db/repo'
import { resolvePython } from './stt'

const TTS_URL = process.env.ROXY_TTS_URL ?? 'http://127.0.0.1:5050'
const TTS_LANG = process.env.ROXY_TTS_LANG // e.g. 'ja', 'es', 'zh', 'fr'

let managedServerProcess: ChildProcess | null = null
let ttsServerLogs = ''
let ttsLogListener: ((chunk: string) => void) | null = null

export function setTtsLogListener(listener: ((chunk: string) => void) | null): void {
  ttsLogListener = listener
}

export function getTtsServerLogs(): string {
  return ttsServerLogs
}

export function clearTtsServerLogs(): void {
  ttsServerLogs = ''
}

export function formatRate(speed: number | undefined): string {
  const val = typeof speed === 'number' && Number.isFinite(speed) ? speed : 15
  return `${val >= 0 ? '+' : ''}${val}%`
}

function appendTtsServerLog(text: string): void {
  ttsServerLogs += text
  if (ttsServerLogs.length > 100_000) {
    ttsServerLogs = ttsServerLogs.slice(-100_000)
  }
  ttsLogListener?.(text)
}

function resolveScript(name: string): string {
  // Never pass an app.asar path to Python: external binaries cannot read inside asar.
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

    // Fallback: extract script from asar to a temp directory so python can execute it
    try {
      const asarScript = path.join(app.getAppPath(), 'script', name)
      if (fs.existsSync(asarScript)) {
        const tempDir = path.join(app.getPath('temp'), 'roxy-tts-scripts')
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })
        const tempPath = path.join(tempDir, name)
        fs.writeFileSync(tempPath, fs.readFileSync(asarScript))
        return tempPath
      }
    } catch (e) {
      console.warn('[TTS] Failed to extract script from asar to temp:', e)
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
  return path.join(process.cwd(), 'script', name)
}

export async function getLocalTtsStatus(): Promise<{ installed: boolean; running: boolean }> {
  const running = await isTtsServerAlive()
  let installed = false
  try {
    const pyExe = resolvePython()
    const testPy = spawn(
      pyExe,
      [
        '-c',
        'import edge_tts, sounddevice, soundfile, deepl, deep_translator; from rvc_python.infer import RVCInference'
      ],
      { windowsHide: true }
    )
    installed = await new Promise<boolean>((resolve) => {
      testPy.on('close', (code) => resolve(code === 0))
      testPy.on('error', () => resolve(false))
    })
  } catch {
    installed = false
  }
  return { installed, running }
}

export async function installTtsDependencies(
  onChunk?: (chunk: string) => void
): Promise<{ ok: boolean; log: string }> {
  const scriptPath = resolveScript('setup_tts_env.py')
  const cwd = path.dirname(scriptPath)
  const pyExe = resolvePython()
  return new Promise<{ ok: boolean; log: string }>((resolve) => {
    let output = ''
    try {
      const proc = spawn(pyExe, ['-u', scriptPath], { cwd, windowsHide: true })
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
        const text = `\nFailed to start installer: ${err.message}`
        output += text
        onChunk?.(text)
        resolve({ ok: false, log: output })
      })
    } catch (e) {
      const text = String(e)
      onChunk?.(text)
      resolve({ ok: false, log: text })
    }
  })
}

export function getTtsModelDirs(): string[] {
  const dirs: string[] = []
  const scriptPath = resolveScript('rvc_tts_server.py')
  const userDir = path.join(app.getPath('userData'), 'models')
  const candidates = [
    path.join(process.cwd(), 'RoxyMigurdia'),
    path.resolve(path.dirname(scriptPath), '..', 'RoxyMigurdia'),
    path.join(app.getAppPath(), 'RoxyMigurdia'),
    path.join(process.resourcesPath, 'RoxyMigurdia'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'RoxyMigurdia'),
    userDir
  ]
  for (const mc of candidates) {
    if (fs.existsSync(mc) && fs.statSync(mc).isDirectory() && !dirs.includes(mc)) {
      dirs.push(mc)
    }
  }
  return dirs
}

export function findTtsModelDir(): string | null {
  const dirs = getTtsModelDirs()
  return dirs.length > 0 ? dirs[0] : null
}

export function getTtsModelsDir(): string {
  if (!app.isPackaged) {
    const repoDir = path.join(process.cwd(), 'RoxyMigurdia')
    if (fs.existsSync(repoDir) && fs.statSync(repoDir).isDirectory()) {
      return repoDir
    }
    const scriptPath = resolveScript('rvc_tts_server.py')
    const parentDir = path.resolve(path.dirname(scriptPath), '..', 'RoxyMigurdia')
    if (fs.existsSync(parentDir) && fs.statSync(parentDir).isDirectory()) {
      return parentDir
    }
  }
  const userDir = path.join(app.getPath('userData'), 'models')
  if (!fs.existsSync(userDir)) {
    try {
      fs.mkdirSync(userDir, { recursive: true })
    } catch {
      // ignore
    }
  }
  return userDir
}

export async function getAvailableTtsModels(): Promise<{
  models: string[]
  current: string
  indexes: string[]
  currentIndex: string
}> {
  const currentSettings = getSettings()
  let current = currentSettings.ttsModel || 'roxy_e660_s4620.pth'
  let currentIndex = currentSettings.ttsIndex || 'auto'
  const modelDirs = getTtsModelDirs()
  let models: string[] = []
  let indexes: string[] = []

  for (const dir of modelDirs) {
    try {
      const files = fs.readdirSync(dir)
      for (const f of files) {
        if (f.endsWith('.pth') && !models.includes(f)) {
          models.push(f)
        }
        if (f.endsWith('.index') && !indexes.includes(f)) {
          indexes.push(f)
        }
      }
    } catch {
      // ignore
    }
  }

  if (await isTtsServerAlive()) {
    try {
      const res = await fetch(`${TTS_URL}/models`, { signal: AbortSignal.timeout(600) })
      if (res.ok) {
        const data = (await res.json()) as {
          models?: string[]
          current?: string
          indexes?: string[]
          currentIndex?: string
        }
        if (data.models && data.models.length > 0) {
          models = Array.from(new Set([...models, ...data.models]))
        }
        if (data.current) {
          current = data.current
        }
        if (data.indexes && data.indexes.length > 0) {
          indexes = Array.from(new Set([...indexes, ...data.indexes]))
        }
        if (data.currentIndex) {
          currentIndex = data.currentIndex
        }
      }
    } catch {
      // ignore
    }
  }

  if (models.length === 0) {
    models = ['roxy_e660_s4620.pth', 'RoxyMigurdia.pth']
  }
  if (indexes.length === 0) {
    indexes = [
      'added_IVF346_Flat_nprobe_1_roxy_v2.index',
      'added_IVF432_Flat_nprobe_1_RoxyMigurdia_v2.index'
    ]
  }

  return { models, current, indexes, currentIndex }
}

export async function setServerTtsModel(modelName?: string, indexName?: string): Promise<boolean> {
  if (await isTtsServerAlive()) {
    try {
      const payload: Record<string, string> = {}
      if (modelName) payload.model = modelName
      if (indexName !== undefined) payload.index = indexName
      const res = await fetch(`${TTS_URL}/model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000)
      })
      return res.ok
    } catch {
      return false
    }
  }
  return true
}

export async function startLocalTtsServer(): Promise<{ ok: boolean; error?: string }> {
  if (await isTtsServerAlive()) {
    return { ok: true }
  }

  // Clean up any stale process reference
  if (managedServerProcess && !managedServerProcess.killed) {
    try {
      if (process.platform === 'win32' && managedServerProcess.pid) {
        spawn('taskkill', ['/pid', managedServerProcess.pid.toString(), '/t', '/f'], {
          windowsHide: true
        })
      } else {
        managedServerProcess.kill()
      }
    } catch {
      // Ignore
    }
    managedServerProcess = null
  }

  const scriptPath = resolveScript('rvc_tts_server.py')
  const cwd = app.isPackaged
    ? path.dirname(scriptPath)
    : path.resolve(path.dirname(scriptPath), '..')

  const startMsg = `\n[TTS Server] Starting server...\n[TTS Server] Script: ${scriptPath}\n[TTS Server] Working dir: ${cwd}\n`
  console.log(startMsg.trim())
  appendTtsServerLog(startMsg)

  try {
    const env: NodeJS.ProcessEnv = { ...process.env }
    const currentSettings = getSettings()
    const chosenModelName = currentSettings.ttsModel || 'roxy_e660_s4620.pth'
    const chosenIndexName = currentSettings.ttsIndex || 'auto'
    const allDirs = getTtsModelDirs()
    const userModelsDir = path.join(app.getPath('userData'), 'models')
    if (!fs.existsSync(userModelsDir)) {
      try {
        fs.mkdirSync(userModelsDir, { recursive: true })
      } catch {
        // ignore
      }
    }
    env.ROXY_TTS_USER_MODELS_DIR = userModelsDir
    if (allDirs.length > 0) {
      env.ROXY_TTS_MODEL_DIR = allDirs[0]
    }

    for (const d of allDirs) {
      const p = path.join(d, chosenModelName)
      if (fs.existsSync(p)) {
        env.ROXY_TTS_MODEL = p
        break
      }
    }
    if (!env.ROXY_TTS_MODEL) {
      for (const d of allDirs) {
        const roxyModel = path.join(d, 'roxy_e660_s4620.pth')
        const defaultModel = path.join(d, 'RoxyMigurdia.pth')
        if (fs.existsSync(roxyModel)) {
          env.ROXY_TTS_MODEL = roxyModel
          break
        } else if (fs.existsSync(defaultModel)) {
          env.ROXY_TTS_MODEL = defaultModel
          break
        }
      }
    }

    if (chosenIndexName === 'none' || chosenIndexName === 'off') {
      env.ROXY_TTS_INDEX = ''
    } else if (chosenIndexName !== 'auto') {
      for (const d of allDirs) {
        const p = path.join(d, chosenIndexName)
        if (fs.existsSync(p)) {
          env.ROXY_TTS_INDEX = p
          break
        }
      }
    } else if (env.ROXY_TTS_MODEL) {
      const stem = path.parse(env.ROXY_TTS_MODEL).name.toLowerCase()
      for (const d of allDirs) {
        try {
          const idxs = fs.readdirSync(d).filter((f) => f.endsWith('.index'))
          const matched = idxs.find((f) => f.toLowerCase().includes(stem)) || idxs[0]
          if (matched) {
            env.ROXY_TTS_INDEX = path.join(d, matched)
            break
          }
        } catch {
          // ignore
        }
      }
    }

    if (env.ROXY_TTS_MODEL) {
      const msg = `[TTS Server] Model: ${env.ROXY_TTS_MODEL}\n`
      console.log(msg.trim())
      appendTtsServerLog(msg)
    }
    if (env.ROXY_TTS_INDEX) {
      const msg = `[TTS Server] Index: ${env.ROXY_TTS_INDEX}\n`
      console.log(msg.trim())
      appendTtsServerLog(msg)
    }

    const targetLang =
      currentSettings.ttsTranslate === false ? 'none' : currentSettings.ttsLang || 'ja'
    const speed = currentSettings.ttsSpeed ?? 15
    env.ROXY_TRANSLATE_LANG = targetLang
    env.ROXY_TTS_LANG = targetLang
    env.ROXY_TTS_RATE = formatRate(speed)

    const pyExe = resolvePython()
    const proc = spawn(pyExe, ['-u', scriptPath], {
      cwd,
      env: {
        ...env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      },
      windowsHide: true
    })
    managedServerProcess = proc

    let spawnError: Error | null = null

    proc.stdout?.on('data', (d: Buffer) => {
      const text = d.toString('utf-8')
      console.log(`[TTS Server] ${text.trimEnd()}`)
      appendTtsServerLog(text)
    })

    proc.stderr?.on('data', (d: Buffer) => {
      const text = d.toString('utf-8')
      console.error(`[TTS Server ERR] ${text.trimEnd()}`)
      appendTtsServerLog(text)
    })

    proc.on('error', (err) => {
      spawnError = err
      const text = `[TTS Server ERROR] Failed to spawn python: ${err.message}\n`
      console.error(text)
      appendTtsServerLog(text)
    })

    proc.on('close', (code, signal) => {
      const text = `[TTS Server] Process closed (code: ${code}, signal: ${signal})\n`
      console.log(text)
      appendTtsServerLog(text)
      if (managedServerProcess === proc) {
        managedServerProcess = null
      }
    })

    // Wait up to 25s for server to become healthy (50 * 500ms)
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 500))
      if (await isTtsServerAlive()) {
        const okMsg = '[TTS Server] Server is online and responding to health check.\n'
        console.log(okMsg.trim())
        appendTtsServerLog(okMsg)
        return { ok: true }
      }
      if (spawnError) {
        return {
          ok: false,
          error: `Failed to spawn python: ${(spawnError as Error).message}`
        }
      }
      if (proc.exitCode !== null) {
        const errorMsg = `TTS server exited with code ${proc.exitCode}. Check console output.`
        return { ok: false, error: errorMsg }
      }
    }

    return {
      ok: false,
      error:
        'Server started but did not respond on http://127.0.0.1:5050 within 25s. Check console output.'
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e)
    const errText = `[TTS Server ERROR] ${errorMsg}\n`
    console.error(errText)
    appendTtsServerLog(errText)
    return { ok: false, error: errorMsg }
  }
}

export async function stopLocalTtsServer(): Promise<{ ok: boolean }> {
  appendTtsServerLog('[TTS Server] Stopping server...\n')
  console.log('[TTS Server] Stopping server...')
  await stopTts()
  if (managedServerProcess && !managedServerProcess.killed) {
    try {
      if (process.platform === 'win32' && managedServerProcess.pid) {
        spawn('taskkill', ['/pid', managedServerProcess.pid.toString(), '/t', '/f'], {
          windowsHide: true
        })
      } else {
        managedServerProcess.kill()
      }
    } catch {
      // Process already terminated
    }
    managedServerProcess = null
  }
  return { ok: true }
}

export const LANG_VOICES: Record<string, string> = {
  ja: 'ja-JP-NanamiNeural',
  zh: 'zh-CN-XiaoxiaoNeural',
  ko: 'ko-KR-SunHiNeural',
  es: 'es-ES-ElviraNeural',
  fr: 'fr-FR-DeniseNeural',
  de: 'de-DE-KatjaNeural',
  en: 'en-US-JennyNeural'
}

/** Translate text to target language via free Google Translate API. */
export async function translateText(text: string, targetLang: string): Promise<string> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return text
    const data = (await res.json()) as [[string[]]]
    return data[0].map((item) => item[0]).join('')
  } catch {
    return text
  }
}

/** Send sentence to background RVC voice daemon. */
export async function speakSentence(
  text: string,
  targetLang?: string,
  speed?: number
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return

  const lang = targetLang || TTS_LANG || 'ja'
  const rate = formatRate(speed)

  try {
    await fetch(`${TTS_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, wait: false, lang, rate }),
      signal: AbortSignal.timeout(2000)
    })
  } catch {
    // Voice daemon offline or unreachable — silently proceed
  }
}

/** Send sentence to voice daemon and wait until audio generation is ready and playing. */
export async function speakSentenceAndWait(
  text: string,
  apiKey?: string,
  targetLang?: string,
  speed?: number
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return

  const lang = targetLang || TTS_LANG || 'ja'
  const rate = formatRate(speed)

  try {
    await fetch(`${TTS_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: trimmed,
        wait: true,
        api_key: apiKey?.trim() || undefined,
        lang,
        rate
      }),
      signal: AbortSignal.timeout(60000)
    })
  } catch {
    // Voice daemon offline or timed out — silently proceed
  }
}

/** Stop audio playback immediately and clear queue. */
export async function stopTts(): Promise<void> {
  try {
    await fetch(`${TTS_URL}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(1000)
    })
  } catch {
    // Ignore
  }
}

/** Check if RVC voice server is responding. */
export async function isTtsServerAlive(): Promise<boolean> {
  try {
    const res = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(500) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Synchronous TTS streamer: buffers prose until sentence boundaries (or full message),
 * sends to TTS server, and only displays text in chat when the server signals that
 * audio playback has started.
 */
export class SyncTtsStreamer {
  private buffer = ''
  private inCodeBlock = false
  private backtickCount = 0
  private queue: Promise<void> = Promise.resolve()
  private aborted = false
  private onDisplay: (text: string) => void
  private settings: AppSettings

  constructor(onDisplay: (text: string) => void, settings: AppSettings) {
    this.onDisplay = onDisplay
    this.settings = settings
  }

  onText(delta: string): void {
    if (this.aborted || !delta) return

    if (!this.settings.ttsEnabled) {
      this.onDisplay(delta)
      return
    }

    if (this.settings.ttsMode === 'all') {
      this.buffer += delta
      return
    }

    for (let i = 0; i < delta.length; i++) {
      const char = delta[i]

      if (char === '`') {
        this.backtickCount++
        if (this.backtickCount === 3) {
          this.inCodeBlock = !this.inCodeBlock
          this.backtickCount = 0
          if (this.inCodeBlock) {
            // Entering code block: flush any buffered prose sentence
            this.flushSentence()
            this.onDisplay('```')
          } else {
            // Exiting code block: display closing fence immediately
            this.onDisplay('```')
          }
          continue
        }
        continue
      } else {
        if (this.backtickCount > 0) {
          const ticks = '`'.repeat(this.backtickCount)
          if (this.inCodeBlock) {
            this.onDisplay(ticks)
          } else {
            this.buffer += ticks
          }
          this.backtickCount = 0
        }
      }

      if (this.inCodeBlock) {
        // Code content displays directly without TTS
        this.onDisplay(char)
        continue
      }

      this.buffer += char

      // Sentence boundary check
      if (char === '.' || char === '!' || char === '?' || char === '\n') {
        if (char === '.' && i + 1 < delta.length && /\d/.test(delta[i + 1])) {
          continue
        }
        if (this.buffer.trim().length >= 10) {
          this.flushSentence()
        }
      }
    }
  }

  private flushSentence(): void {
    const textToSpeak = this.buffer
    this.buffer = ''
    if (!textToSpeak.trim()) {
      if (textToSpeak) this.onDisplay(textToSpeak)
      return
    }

    this.queue = this.queue.then(async () => {
      if (this.aborted) return
      // 1. Send to server and wait until audio is ready and starts playing
      const effectiveLang =
        this.settings.ttsTranslate === false ? 'none' : this.settings.ttsLang || 'ja'
      await speakSentenceAndWait(
        textToSpeak,
        this.settings.ttsApiKey,
        effectiveLang,
        this.settings.ttsSpeed
      )
      // 2. Server is ready! Display message in chat at exact moment it plays
      if (!this.aborted) {
        this.onDisplay(textToSpeak)
      }
    })
  }

  async finish(): Promise<void> {
    if (!this.settings.ttsEnabled) {
      return
    }

    if (this.settings.ttsMode === 'all') {
      const entireText = this.buffer
      this.buffer = ''
      if (entireText.trim()) {
        const effectiveLang =
          this.settings.ttsTranslate === false ? 'none' : this.settings.ttsLang || 'ja'
        await speakSentenceAndWait(
          entireText,
          this.settings.ttsApiKey,
          effectiveLang,
          this.settings.ttsSpeed
        )
      }
      if (!this.aborted && entireText) {
        this.onDisplay(entireText)
      }
      return
    }

    if (this.buffer.length > 0) {
      this.flushSentence()
    }
    await this.queue
  }

  abort(): void {
    this.aborted = true
    if (this.buffer) {
      this.onDisplay(this.buffer)
      this.buffer = ''
    }
    void stopTts()
  }
}

export function createSyncTtsStreamer(
  onDisplay: (text: string) => void,
  settings: AppSettings
): SyncTtsStreamer {
  return new SyncTtsStreamer(onDisplay, settings)
}

/**
 * Token buffer that strips code fences and dispatches finished
 * sentences to the background RVC voice server during chat streaming (async fire-and-forget).
 */
export class TtsStreamer {
  private buffer = ''
  private inCodeBlock = false
  private backtickCount = 0

  onEvent(event: LlmEvent): void {
    if (event.type !== 'text' || !event.delta) return

    for (let i = 0; i < event.delta.length; i++) {
      const char = event.delta[i]

      if (char === '`') {
        this.backtickCount++
        if (this.backtickCount === 3) {
          this.inCodeBlock = !this.inCodeBlock
          this.backtickCount = 0
          if (!this.inCodeBlock && this.buffer.endsWith('``')) {
            this.buffer = this.buffer.slice(0, -2)
          }
        }
        continue
      } else {
        if (this.backtickCount > 0 && !this.inCodeBlock) {
          this.buffer += '`'.repeat(this.backtickCount)
        }
        this.backtickCount = 0
      }

      if (this.inCodeBlock) {
        continue
      }

      this.buffer += char

      // Sentence boundary check
      if (char === '.' || char === '!' || char === '?' || char === '\n') {
        // Skip decimal numbers e.g. 3.14
        if (char === '.' && i + 1 < event.delta.length && /\d/.test(event.delta[i + 1])) {
          continue
        }
        if (this.buffer.trim().length >= 10) {
          const sentence = this.buffer.trim()
          this.buffer = ''
          void speakSentence(sentence)
        }
      }
    }
  }

  finish(): void {
    if (!this.inCodeBlock && this.buffer.trim().length > 0) {
      const sentence = this.buffer.trim()
      this.buffer = ''
      void speakSentence(sentence)
    }
  }
}

export function createTtsStreamer(): TtsStreamer {
  return new TtsStreamer()
}
