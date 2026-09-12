/**
 * Text-to-Speech (TTS) integration with local RVC voice server.
 *
 * Streams chat responses to background Python RVC daemon on 127.0.0.1:5050.
 * Non-blocking, best-effort: silently skips if the voice server is offline.
 */
import type { LlmEvent } from '../../shared/api'
import type { AppSettings } from '../../shared/types'
import { CHANNELS } from '../../shared/ipc'
import { spawn, type ChildProcess } from 'node:child_process'
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { getSettings } from '../db/repo'
import { resolvePython } from './stt'

const TTS_URL = process.env.ROXY_TTS_URL ?? 'http://127.0.0.1:5050'
const TTS_LANG = process.env.ROXY_TTS_LANG // e.g. 'ja', 'es', 'zh', 'fr'

let managedServerProcess: ChildProcess | null = null
let ttsServerLogs = ''
let ttsLogListener: ((chunk: string) => void) | null = null
let speakingStateListener: ((state: { speaking: boolean; text?: string }) => void) | null = null

export function setTtsLogListener(listener: ((chunk: string) => void) | null): void {
  ttsLogListener = listener
}

export function setSpeakingStateListener(
  listener: ((state: { speaking: boolean; text?: string }) => void) | null
): void {
  speakingStateListener = listener
}

const EMOTION_TAG_RE = /\[[a-zA-Z\s-]+\]\s*/g

export function stripEmotionTags(text: string): string {
  return text.replace(EMOTION_TAG_RE, '')
}

/** Count words in text (supports space-delimited words and CJK characters). */
export function countWords(text: string): number {
  const clean = stripEmotionTags(text).trim()
  if (!clean) return 0
  const matches = clean.match(
    /[\p{L}\p{N}'-]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
  )
  return matches ? matches.length : clean.split(/\s+/).filter(Boolean).length
}

function notifySpeaking(speaking: boolean, text?: string): void {
  const clean = text ? stripEmotionTags(text).trim() : undefined
  speakingStateListener?.({ speaking, text: clean })
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

const DEEPL_LANG_MAP: Record<string, string> = {
  ja: 'JA',
  zh: 'ZH',
  ko: 'KO',
  es: 'ES',
  fr: 'FR',
  de: 'DE',
  en: 'EN-US'
}

/** Translate text to target language via DeepL (if API key provided) or Google Translate fallback. */
export async function translateText(
  text: string,
  targetLang: string,
  apiKey?: string
): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed || !targetLang || targetLang.toLowerCase() === 'none') {
    return text
  }

  const langLower = targetLang.toLowerCase()

  // 1. Prefer DeepL if API key is provided
  const deepLKey = apiKey?.trim()
  if (deepLKey) {
    try {
      const endpoint = deepLKey.endsWith(':fx')
        ? 'https://api-free.deepl.com/v2/translate'
        : 'https://api.deepl.com/v2/translate'
      const targetCode = DEEPL_LANG_MAP[langLower] || targetLang.toUpperCase()

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${deepLKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: [trimmed],
          target_lang: targetCode
        }),
        signal: AbortSignal.timeout(8000)
      })

      if (res.ok) {
        const data = (await res.json()) as { translations?: Array<{ text: string }> }
        if (data.translations?.[0]?.text) {
          appendTtsServerLog(
            `[DeepL] Translated (${targetCode}): "${data.translations[0].text.slice(0, 50)}..."\n`
          )
          return data.translations[0].text
        }
      } else {
        const errText = await res.text().catch(() => res.statusText)
        appendTtsServerLog(`[DeepL ERR] HTTP ${res.status}: ${errText}\n`)
      }
    } catch (err) {
      appendTtsServerLog(`[DeepL ERR] ${err instanceof Error ? err.message : String(err)}\n`)
    }
  }

  // 2. Fallback to Google Translate
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t`
    const body = new URLSearchParams({ q: trimmed })
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) {
      appendTtsServerLog(`[Google Translate ERR] HTTP ${res.status}: ${res.statusText}\n`)
      return text
    }
    const data = (await res.json()) as [[string[]]]
    const translated = data[0].map((item) => item[0]).join('')
    if (translated) {
      appendTtsServerLog(
        `[Google Translate] Translated (${targetLang}): "${translated.slice(0, 50)}..."\n`
      )
      return translated
    }
    return text
  } catch (err) {
    appendTtsServerLog(
      `[Google Translate ERR] ${err instanceof Error ? err.message : String(err)}\n`
    )
    return text
  }
}

interface PendingPlayback {
  id: string
  resolveReady: (duration: number) => void
  resolveEnded: () => void
  timer?: NodeJS.Timeout
}

const pendingPlaybacks = new Map<string, PendingPlayback>()

export function handleAudioReady(id: string, duration: number): void {
  const p = pendingPlaybacks.get(id)
  if (p) {
    p.resolveReady(duration)
  }
}

export function handleAudioEnded(id: string): void {
  const p = pendingPlaybacks.get(id)
  if (p) {
    if (p.timer) clearTimeout(p.timer)
    p.resolveEnded()
    pendingPlaybacks.delete(id)
  }
}

export function stopRendererAudio(): void {
  for (const [, p] of pendingPlaybacks) {
    if (p.timer) clearTimeout(p.timer)
    p.resolveEnded()
  }
  pendingPlaybacks.clear()

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(CHANNELS.ttsStopAudio)
    }
  }
}

export async function playAudioBufferInRenderer(
  buffer: Buffer,
  format = 'audio/mp3',
  text?: string,
  signal?: AbortSignal
): Promise<{ duration: number; serverOk: boolean }> {
  if (signal?.aborted) return { duration: 0, serverOk: false }

  const id = `tts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const fallbackDuration = Math.max(1, Math.round((buffer.length / 16000) * 10) / 10)

  const windows = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  if (windows.length === 0) {
    appendTtsServerLog('[TTS Player] No active window available for audio playback.\n')
    return { duration: fallbackDuration, serverOk: false }
  }

  const targetWin = windows.find((w) => w.isVisible() && !w.isMinimized()) || windows[0]

  return new Promise<{ duration: number; serverOk: boolean }>((resolve) => {
    let resolved = false

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      const p = pendingPlaybacks.get(id)
      if (p?.timer) clearTimeout(p.timer)
      pendingPlaybacks.delete(id)
    }

    const onAbort = () => {
      if (resolved) return
      resolved = true
      cleanup()
      stopRendererAudio()
      resolve({ duration: 0, serverOk: false })
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    const timeoutTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true
        signal?.removeEventListener('abort', onAbort)
        notifySpeaking(true, text)
        resolve({ duration: fallbackDuration, serverOk: true })
      }
    }, 3500)

    pendingPlaybacks.set(id, {
      id,
      timer: timeoutTimer,
      resolveReady: (duration) => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeoutTimer)
          signal?.removeEventListener('abort', onAbort)
          const actualDuration =
            Number.isFinite(duration) && duration > 0 ? duration : fallbackDuration
          notifySpeaking(true, text)
          resolve({ duration: actualDuration, serverOk: true })
        }
      },
      resolveEnded: () => {
        // audio completed
      }
    })

    targetWin.webContents.send(CHANNELS.ttsPlayAudio, {
      id,
      audioBase64: buffer.toString('base64'),
      format,
      text
    })
  })
}

export interface EmotionRule {
  tag: string
  pattern: RegExp
}

export const FISH_AUDIO_EMOTION_RULES: EmotionRule[] = [
  // Sound effects & explicit delivery cues
  {
    tag: 'whispering',
    pattern:
      /\b(\*whispers?\*|whisper(ing|ed|s)?|psst\b|off the record|between (you and me|us)|keep (this|it) quiet|secretly|softly|hush|shh+)\b/i
  },
  {
    tag: 'laughing',
    pattern:
      /\b(ha(ha)+|he(he)+|rofl|lmao|\*laughs?\*|laugh(ing|ed|ter)?|hilarious|cracks? me up)\b|[😂🤣😆]/i
  },
  {
    tag: 'chuckling',
    pattern: /\b(heh+|lol|\*chuckles?\*|chuckle(s|d|ing)?|giggle(s|d|ing)?|snicker|smirk)\b|[😏🤭]/i
  },
  {
    tag: 'sighing',
    pattern: /\b(\*sighs?\*|sigh(s|ed|ing)?|phew|whew|heavy breath|alas)\b|[😮‍💨]/i
  },
  {
    tag: 'gasping',
    pattern: /\b(\*gasps?\*|gasp(s|ed|ing)?|holy cow|oh my god|omg\b|gosh|jeez)\b/i
  },
  {
    tag: 'yawning',
    pattern:
      /\b(\*yawns?\*|yawn(s|ed|ing)?|so sleepy|exhausted|tired|drowsy|need (a nap|coffee|sleep))\b|[🥱]/i
  },
  {
    tag: 'sobbing',
    pattern: /\b(\*sobs?\*|\*cries\*|sobbing|crying|weep(ing)?|tears|heartbroken)\b|[😭😢]/i
  },
  {
    tag: 'shouting',
    pattern: /\b(\*shouts?\*|\*yells?\*|shout(ing|ed)?|yell(ing|ed)?|scream(ing|ed)?)\b/i
  },

  // Extreme / emergency / fear
  {
    tag: 'hysterical',
    pattern:
      /\b(total disaster|everything is on fire|system crash emergency|emergency|meltdown|mayhem|panic|catastrophe)\b/i
  },
  {
    tag: 'scared',
    pattern:
      /\b(danger|critical vulnerability|malicious|exploit|threat|scary|terrifying|scared|fear|frightened|spooky|creepy)\b|[😱]/i
  },
  {
    tag: 'sarcastic',
    pattern:
      /\b(oh brilliant|what a surprise|yeah right|as if|surely nothing could go wrong|wow so helpful|big deal)\b|[🙄]/i
  },
  {
    tag: 'angry',
    pattern:
      /\b(unacceptable|outrageous|infuriating|furious|how dare|pissed off|angry|mad\b|rage|hate this)\b|[😡🤬]/i
  },
  {
    tag: 'frustrated',
    pattern:
      /\b(\bugh\b|annoy(ing|ed)?|frustrat(ing|ed|ion)?|timed out again|stuck on|broken again|headache|irritat(ing|ed)?|pain in the)\b|[😤]/i
  },

  // Positive / high energy
  {
    tag: 'excited',
    pattern:
      /([!?]{2,}|\b(awesome|amazing|fantastic|incredible|superb|woohoo|hooray|yay|let's go|congrat(s|ulations)?|can't wait|epic|thrilled|hyped)\b|[🎉🔥✨])/i
  },
  {
    tag: 'surprised',
    pattern:
      /\b(wow\b|whoa\b|unbeliev(able)?|astonish(ing)?|no way|didn't expect|surprise(d)?|shock(ing)?)\b/i
  },
  {
    tag: 'delighted',
    pattern: /\b(delighted|splendid|marvelous|it's a pleasure|what a joy|lovely|delightful)\b/i
  },
  {
    tag: 'grateful',
    pattern:
      /\b(thank(s| you)?|much appreciated|deeply appreciate|grateful(ly)?|gratitude|much obliged|props to)\b|[🙏]/i
  },
  {
    tag: 'proud',
    pattern:
      /\b(proud (of|to)|great (achievement|work|job)|well deserved|kudos|nailed it|bravo|killed it)\b/i
  },
  {
    tag: 'confident',
    pattern:
      /\b(definitely|certainly|guarantee(d)?|absolutely|without a doubt|i'm confident|i am confident|positive|for sure|rest assured|sure thing|this will|ensures that|ensures|prevents|solves this|correctly|properly|without issue|clear(ly)?|of course|as expected)\b/i
  },
  {
    tag: 'satisfied',
    pattern:
      /\b(all set|resolved|looks? good|working (as expected|properly|now)|fixed (successfully)?|ready to go|perfect\b|done deal|good to go|passes|passing|passed|succeeded|successful(ly)?|done\b|finished|completed|all working)/i
  },
  {
    tag: 'happy',
    pattern:
      /\b(glad to|happy to|pleased to|welcome\b|great to see you|have a (great|wonderful|good)|great to|nice to|enjoy|cheers|smile)\b|[😊🙂😃]/i
  },
  {
    tag: 'cheerful',
    pattern:
      /\b(hello|hi\b|hey\b|welcome\b|good (morning|afternoon|evening)|greetings|happy to help|glad to assist|my pleasure|anytime)\b/i
  },

  // Disdain & contempt
  { tag: 'disdainful', pattern: /\b(pathetic|worthless|laughable|amateurish|beneath us)\b/i },
  {
    tag: 'contemptuous',
    pattern: /\b(despicable|scorn|utter nonsense|complete garbage|disgraceful)\b/i
  },
  {
    tag: 'disgusted',
    pattern:
      /\b(disgust(ing|ed)?|gross\b|nasty|repulsive|nauseating|yuck|eww?|code smell)\b|[🤢🤮]/i
  },

  // Empathy, support, apologies
  {
    tag: 'embarrassed',
    pattern:
      /\b(my bad|oops|whoops|my mistake|pardon me|clumsy of me|apologies for that|awkward|blunder)\b|[😅😳]/i
  },
  {
    tag: 'empathetic',
    pattern:
      /\b(i understand your|i hear you|feel you|understandable|hang in there|sorry for the trouble|tough (situation|time))\b/i
  },
  {
    tag: 'reassuring',
    pattern:
      /\b(don't worry|no need to worry|nothing to worry|easy fix|quick fix|straightforward|simple fix|we got this|no big deal|no problem at all)\b/i
  },
  {
    tag: 'sympathetic',
    pattern: /\b(my condolences|deepest sympathies|sorry for your loss|grieving)\b/i
  },
  {
    tag: 'compassionate',
    pattern:
      /\b(take care|be gentle|be kind|here (to help|for you)|you're not alone|take your time)\b/i
  },
  {
    tag: 'regretful',
    pattern:
      /\b(i regret|regrettable|wish i hadn't|should have (known|checked)|unfortunate mistake)\b/i
  },
  {
    tag: 'guilty',
    pattern: /\b(my fault|i caused this|blame is on me|i take the blame|guilty of)\b/i
  },
  { tag: 'ashamed', pattern: /\b(mortified|deeply ashamed|humiliated|shameful)\b/i },

  // Sadness, depression, disappointment
  { tag: 'depressed', pattern: /\b(hopeless|pointless|given up|miserable|despair|gloomy)\b/i },
  {
    tag: 'sad',
    pattern: /\b(sad(ly)?|unfortunate(ly)?|i'm sorry|too bad|shame that|bummer|sorrow)\b|[😞]/i
  },
  {
    tag: 'disappointed',
    pattern: /\b(disappoint(ed|ing)?|let down|missed opportunity|fell short|not what we wanted)\b/i
  },
  { tag: 'unhappy', pattern: /\b(discontent|dissatisfied|unhappy|not pleased)\b/i },
  { tag: 'upset', pattern: /\b(distressing|upsetting|chaos|disrupted|upset|vexed|troubled)\b/i },

  // Worry, doubt, confusion
  {
    tag: 'confused',
    pattern:
      /\b(\bhuh\b|baffl(ed|ing)|confus(ed|ing)|doesn't make sense|unclear to me|can't figure out|weird|strange|odd)\b/i
  },
  {
    tag: 'doubtful',
    pattern: /\b(doubt(ful)?|skeptic(al)?|hard to believe|unlikely|questionable|not convinced)\b/i
  },
  {
    tag: 'worried',
    pattern:
      /\b(worr(y|ied|ying)|be careful|caution|heads up|risky|risk|potential issue|watch out|concern(ed)?)\b/i
  },
  {
    tag: 'nervous',
    pattern: /\b(nervous|shaky|jittery|proceed with caution|tense|uneasy|butterflies)\b/i
  },
  {
    tag: 'anxious',
    pattern:
      /\b(urgently|urgent\b|asap\b|deadline approaching|running out of time|hurry|pressing)\b/i
  },
  {
    tag: 'uncertain',
    pattern: /\b(not sure|maybe|perhaps|might be|could possibly|it depends|uncertain|tentative)\b/i
  },
  {
    tag: 'curious',
    pattern:
      /(\?|\b(curious|wonder(ing)?|why|how come|what if|how about|explore|investigate|tell me more|can you|could you)\b|[🤔🧐])/i
  },

  // Social & interpersonal
  { tag: 'jealous', pattern: /\b(jealous (of)?|envious (of)?|wish i had that)\b/i },
  { tag: 'envious', pattern: /\b(envious|covet)\b/i },
  { tag: 'lonely', pattern: /\b(feeling alone|isolated|solitary|lonely)\b/i },
  {
    tag: 'nostalgic',
    pattern: /\b(nostalgic|reminisce|back in the day|remember when|good old days|legacy days)\b/i
  },
  { tag: 'moved', pattern: /\b(heartwarming|deeply touched|moved by|means a lot)\b/i },

  // Attitude, resolution, perspective, reasoning
  {
    tag: 'determined',
    pattern:
      /\b(let's|i('ll| will| have)|we('ll| will| can)|determined|won't give up|on it now|tackle|handle|updat(e|ing|ed)|add(ing|ed)?|implement(ing|ed)?|creat(e|ing|ed)|modif(y|ying|ied)|replac(e|ing|ed)|fix(ing|ed)?|refactor(ing|ed)?|start by|next (step|we)|now we)\b|[💪]/i
  },
  {
    tag: 'thoughtful',
    pattern:
      /\b(here (is|are)|this (means|is|shows|represents|handles)|the (reason|issue|problem|cause)|because|based on|analyz(e|ing|ed)|inspect(ing|ed)?|look(ing)? at|examin(e|ing|ed)|observ(e|ing|ed)|notice(d)?|specifically|in this case|for example|for instance|note that|it appears|such as|according to|considering)\b/i
  },
  {
    tag: 'hopeful',
    pattern: /\b(hope(ful|fully|s)?|looking forward|fingers crossed|with any luck|promising)\b/i
  },
  {
    tag: 'optimistic',
    pattern:
      /\b(optimis(tic|m)|things are looking up|bright side|promising|upbeat|positive outlook)\b/i
  },
  {
    tag: 'pessimistic',
    pattern: /\b(pessimis(tic|m)|worst case|probably fail|doomed|downhill)\b/i
  },
  {
    tag: 'relaxed',
    pattern:
      /\b(no problem|no worries|anytime|take it easy|chill|all good|no stress|smooth sailing)\b|[😎]/i
  },
  {
    tag: 'calm',
    pattern:
      /\b(calm(ly|ness)?|peaceful(ly)?|tranquil|serene|deep breath|quietly|soothing|take a breather)\b|[🧘🕊️]/i
  },
  {
    tag: 'indifferent',
    pattern: /\b(doesn't matter|either way|up to you|whatever you prefer|don't mind|fine by me)\b/i
  },
  {
    tag: 'resigned',
    pattern: /\b(it is what it is|nothing we can do|have to accept|oh well|so be it)\b/i
  },
  { tag: 'bored', pattern: /\b(tedious|repetitive|boring|bored|dull|monotonous)\b/i }
]

export function detectFishAudioEmotion(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return 'relaxed'

  // If text already has an emotion tag
  const existing = trimmed.match(/^\[([a-zA-Z\s-]+)\]/)
  if (existing) {
    const rawTag = existing[1].toLowerCase().trim()
    if (rawTag !== 'calm') {
      return rawTag
    }
    // If tag is 'calm', check if the text content warrants a more expressive tag
    const rest = trimmed.slice(existing[0].length).trim()
    for (const rule of FISH_AUDIO_EMOTION_RULES) {
      if (rule.tag !== 'calm' && rule.pattern.test(rest)) {
        return rule.tag
      }
    }
    // Only keep 'calm' if text is genuinely calm/peaceful
    if (/\b(calm|peaceful|quiet|breathe|serene|tranquil)\b/i.test(rest)) {
      return 'calm'
    }
    return 'confident'
  }

  for (const rule of FISH_AUDIO_EMOTION_RULES) {
    if (rule.pattern.test(trimmed)) {
      return rule.tag
    }
  }

  // Technical terms or code terms default to thoughtful
  if (
    /\b(code|file|folder|dir|function|class|method|component|variable|api|server|port|database|config|schema|error|log|output|build|test|script|branch|repo)\b/i.test(
      trimmed
    )
  ) {
    return 'thoughtful'
  }

  return 'relaxed'
}

export function ensureEmotionTags(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return text

  // If text starts with [calm], upgrade it if the content warrants a better tone
  const calmMatch = trimmed.match(/^\[calm\]\s*(.*)/i)
  if (calmMatch) {
    const rest = calmMatch[1].trim()
    const detected = detectFishAudioEmotion(rest)
    if (detected !== 'calm') {
      const match = text.match(/^(\s*)/)
      const leading = match ? match[1] : ''
      return `${leading}[${detected}] ${rest}`
    }
  }

  // If already contains bracketed emotion tags, keep as-is
  if (/\[[a-zA-Z\s-]+\]/.test(trimmed)) {
    return text
  }

  const sentences = text.split(/(?<=[.!?\n])\s+/)
  if (sentences.length <= 1) {
    const tag = detectFishAudioEmotion(trimmed)
    const match = text.match(/^(\s*)/)
    const leading = match ? match[1] : ''
    return `${leading}[${tag}] ${trimmed}`
  }

  return sentences
    .map((s) => {
      const sTrim = s.trim()
      if (!sTrim || sTrim.startsWith('```')) return s
      const tag = detectFishAudioEmotion(sTrim)
      const match = s.match(/^(\s*)/)
      const leading = match ? match[1] : ''
      return `${leading}[${tag}] ${sTrim}`
    })
    .join(' ')
}

export async function synthesizeFishAudio(
  text: string,
  settings: AppSettings,
  signal?: AbortSignal
): Promise<Buffer> {
  const apiKey = settings.fishAudioApiKey?.trim()
  if (!apiKey) {
    throw new Error('Fish Audio API key is not configured in Settings.')
  }

  const model = settings.fishAudioModel?.trim() || 's2.1-pro'
  const voiceId = settings.fishAudioVoice?.trim() || undefined
  const speed = settings.ttsSpeed ?? 15
  const speedMultiplier = Math.max(0.5, Math.min(2.0, Math.round((1 + speed / 100) * 100) / 100))

  const trimmedText = text.trim()
  const tagMatch = trimmedText.match(/^\[([a-zA-Z\s-]+)\]/)
  const emotionTag = tagMatch ? tagMatch[1] : detectFishAudioEmotion(trimmedText)
  const fishText = tagMatch ? trimmedText : `[${emotionTag}] ${trimmedText}`

  const body: Record<string, unknown> = {
    text: fishText,
    format: 'mp3',
    prosody: {
      speed: speedMultiplier
    }
  }
  if (voiceId) {
    body.reference_id = voiceId
  }

  appendTtsServerLog(
    `[Fish Audio] Synthesizing (${model}, [${emotionTag}]): "${stripEmotionTags(trimmedText).slice(0, 50)}..."\n`
  )

  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      model
    },
    body: JSON.stringify(body),
    signal
  })

  if (!res.ok) {
    let errorDetail = res.statusText
    try {
      const errData = (await res.json()) as { message?: string; reason?: string }
      if (errData?.message) {
        errorDetail = errData.message + (errData.reason ? ` (${errData.reason})` : '')
      }
    } catch {
      // ignore
    }
    const errMsg = `Fish Audio request failed (${res.status}): ${errorDetail}`
    appendTtsServerLog(`[Fish Audio ERROR] ${errMsg}\n`)
    throw new Error(errMsg)
  }

  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

/** Send sentence to voice system (local RVC daemon or Fish Audio API). */
export async function speakSentence(
  text: string,
  targetLang?: string,
  speed?: number
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return

  const settings = getSettings()
  if (settings.ttsProvider === 'fish') {
    void speakSentenceAndWait(trimmed, undefined, targetLang, speed, undefined, settings)
    return
  }

  const cleanText = stripEmotionTags(trimmed).trim() || trimmed
  const lang = targetLang || TTS_LANG || 'ja'
  const rate = formatRate(speed)

  try {
    await fetch(`${TTS_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanText, wait: false, lang, rate }),
      signal: AbortSignal.timeout(2000)
    })
  } catch {
    // Voice daemon offline or unreachable — silently proceed
  }
}

/** Send sentence to voice system and wait until audio generation is ready and playing. Returns audio duration in seconds. */
export async function speakSentenceAndWait(
  text: string,
  apiKey?: string,
  targetLang?: string,
  speed?: number,
  signal?: AbortSignal,
  customSettings?: AppSettings
): Promise<{ duration: number; serverOk: boolean }> {
  const trimmed = text.trim()
  if (!trimmed || signal?.aborted) return { duration: 0, serverOk: false }

  const settings = customSettings || getSettings()

  if (settings.ttsProvider === 'fish') {
    const cleanText = stripEmotionTags(trimmed).trim()
    const maxWords = settings.fishAudioMaxWords ?? 0
    if (maxWords > 0 && countWords(cleanText) > maxWords) {
      return { duration: 0, serverOk: true }
    }

    try {
      const lang =
        targetLang || (settings.ttsTranslate === false ? 'none' : settings.ttsLang || 'ja')
      const tagMatch = trimmed.match(/^\[([a-zA-Z\s-]+)\]\s*/)
      let rawTag = tagMatch ? tagMatch[1] : undefined

      // If tag was omitted or was a lazy [calm], determine active emotion from English text
      let effectiveTag = rawTag
      if (!effectiveTag || effectiveTag.toLowerCase() === 'calm') {
        const detected = detectFishAudioEmotion(cleanText)
        if (detected !== 'calm' || !effectiveTag) {
          effectiveTag = detected
        }
      }

      let textToSynthesize: string
      if (settings.ttsTranslate && lang !== 'none' && cleanText) {
        const deeplKey = apiKey?.trim() || settings.ttsApiKey?.trim() || undefined
        const translated = await translateText(cleanText, lang, deeplKey)
        textToSynthesize = effectiveTag ? `[${effectiveTag}] ${translated}` : translated
      } else {
        textToSynthesize = effectiveTag ? `[${effectiveTag}] ${cleanText}` : trimmed
      }

      const audioBuffer = await synthesizeFishAudio(textToSynthesize, settings, signal)
      const displayTag = settings.ttsShowEmotions
        ? effectiveTag
          ? `[${effectiveTag}] ${cleanText}`
          : trimmed
        : cleanText || trimmed
      return await playAudioBufferInRenderer(audioBuffer, 'audio/mp3', displayTag, signal)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      appendTtsServerLog(`[Fish Audio] Failed: ${msg}\n`)
      return { duration: 0, serverOk: false }
    }
  }

  const cleanTrimmed = stripEmotionTags(trimmed).trim() || trimmed
  const lang = targetLang || TTS_LANG || 'ja'
  const rate = formatRate(speed)

  let duration = 0
  let serverOk = false
  try {
    const timeoutSignal = AbortSignal.timeout(60000)
    const combinedSignal = signal
      ? typeof AbortSignal.any === 'function'
        ? AbortSignal.any([timeoutSignal, signal])
        : signal
      : timeoutSignal

    const res = await fetch(`${TTS_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanTrimmed,
        wait: true,
        api_key: apiKey?.trim() || undefined,
        lang,
        rate
      }),
      signal: combinedSignal
    })
    if (res.ok) {
      const data = (await res.json()) as { duration?: number }
      duration = typeof data.duration === 'number' ? data.duration : 0
      serverOk = true
    }
  } catch {
    // Voice daemon offline or timed out — silently proceed
  }

  // Audio has finished generating and has begun playing in the Python voice daemon.
  // Notify speaking state now so text, speech bubble, and lip-sync sync to exact audio playback start.
  if (serverOk && !signal?.aborted) {
    notifySpeaking(true, trimmed)
  }

  return { duration, serverOk }
}

/** Stop audio playback immediately and clear queue. */
export async function stopTts(): Promise<void> {
  notifySpeaking(false)
  stopRendererAudio()
  try {
    await fetch(`${TTS_URL}/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(1000)
    })
  } catch {
    // Ignore
  }
}

/** Test voice synthesis for current settings. */
export async function testTtsVoice(sampleText?: string): Promise<{ ok: boolean; error?: string }> {
  const settings = getSettings()
  if (settings.ttsProvider === 'fish') {
    if (!settings.fishAudioApiKey?.trim()) {
      return { ok: false, error: 'Fish Audio API key is not configured.' }
    }
    try {
      let text = sampleText?.trim() || 'Hello! Welcome to Fish Audio on Roxy.'
      const lang = settings.ttsTranslate === false ? 'none' : settings.ttsLang || 'ja'
      if (settings.ttsTranslate && lang !== 'none') {
        text = await translateText(text, lang, settings.ttsApiKey)
      }
      const audioBuffer = await synthesizeFishAudio(text, settings)
      const res = await playAudioBufferInRenderer(audioBuffer, 'audio/mp3', text)
      return { ok: res.serverOk }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  if (!(await isTtsServerAlive())) {
    return { ok: false, error: 'Local TTS server is offline. Start it first.' }
  }
  const text = sampleText?.trim() || 'Roxy local voice server is operational.'
  await speakSentence(text)
  return { ok: true }
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
  private abortController = new AbortController()
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
      const { duration, serverOk } = await speakSentenceAndWait(
        textToSpeak,
        this.settings.ttsApiKey,
        effectiveLang,
        this.settings.ttsSpeed,
        this.abortController.signal,
        this.settings
      )
      // 2. Server is ready! Display message in chat at exact moment it plays
      if (!this.aborted) {
        const textToDisplay = this.settings.ttsShowEmotions
          ? ensureEmotionTags(textToSpeak)
          : stripEmotionTags(textToSpeak)
        if (textToDisplay) {
          this.onDisplay(textToDisplay)
        }
      }
      // If server was offline, still notify speaking briefly so bubble/display works
      if (!serverOk && !this.aborted && textToSpeak.trim()) {
        const bubbleText = this.settings.ttsShowEmotions
          ? ensureEmotionTags(textToSpeak.trim())
          : stripEmotionTags(textToSpeak).trim()
        notifySpeaking(true, bubbleText)
        await new Promise<void>((resolve) => setTimeout(resolve, 3000))
        if (!this.aborted) notifySpeaking(false)
        return
      }
      // 3. Keep speaking state active during audio playback duration
      if (duration > 0 && !this.aborted) {
        await new Promise<void>((resolve) => setTimeout(resolve, Math.ceil(duration * 1000)))
      }
      if (!this.aborted) {
        notifySpeaking(false)
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
        const { duration, serverOk } = await speakSentenceAndWait(
          entireText,
          this.settings.ttsApiKey,
          effectiveLang,
          this.settings.ttsSpeed,
          this.abortController.signal,
          this.settings
        )
        if (!this.aborted && entireText) {
          const textToDisplay = this.settings.ttsShowEmotions
            ? ensureEmotionTags(entireText)
            : stripEmotionTags(entireText)
          if (textToDisplay) {
            this.onDisplay(textToDisplay)
          }
        }
        if (!serverOk && !this.aborted && entireText.trim()) {
          const bubbleText = this.settings.ttsShowEmotions
            ? ensureEmotionTags(entireText.trim())
            : stripEmotionTags(entireText).trim()
          notifySpeaking(true, bubbleText)
          await new Promise<void>((resolve) => setTimeout(resolve, 3000))
          if (!this.aborted) notifySpeaking(false)
          return
        }
        if (duration > 0 && !this.aborted) {
          await new Promise<void>((resolve) => setTimeout(resolve, Math.ceil(duration * 1000)))
        }
        notifySpeaking(false)
      }
      return
    }

    if (this.buffer.length > 0) {
      this.flushSentence()
    }
    await this.queue
    notifySpeaking(false)
  }

  abort(): void {
    this.aborted = true
    this.abortController.abort()
    notifySpeaking(false)
    if (this.buffer) {
      const textToDisplay = this.settings.ttsShowEmotions
        ? ensureEmotionTags(this.buffer)
        : stripEmotionTags(this.buffer)
      if (textToDisplay) this.onDisplay(textToDisplay)
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
