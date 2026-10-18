import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  powerMonitor,
  shell,
  systemPreferences,
  utilityProcess
} from 'electron'
import type { UtilityProcess, IpcMainInvokeEvent, WebContents } from 'electron'
import type { Recorder } from '@handy-computer/recorder'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CHANNELS } from '../../shared/ipc'
import {
  VOICE_MODELS,
  normalizeVoice,
  type VoiceDevice,
  type VoiceError,
  type VoiceEvent,
  type VoiceResult,
  type VoiceSettings,
  type VoiceStartOptions,
  type VoiceState
} from '../../shared/voice'
import { getChat, getVoiceSettings, setVoiceSettings } from '../db/repo'

let window: BrowserWindow | null = null
let shortcuts: string[] = []
let lastShortcutPress = 0
let download: (NonNullable<VoiceState['download']> & { controller: AbortController }) | null = null
let lastError: VoiceError | null = null
let changing = false
let publishRevision = 0
type Recording = {
  id: string
  chatId: string
  /** The window that started it; recording and transcript events go only there. */
  sender: WebContents
  autoStop?: { gate: SpeechGate; elapsed: number; heard: boolean }
  recorder?: Recorder
  worker?: UtilityProcess
  sequence: number
  pending: number
  stopping: boolean
  cancelled: boolean
  closing?: Promise<void>
  opening?: Promise<Recorder>
  timer?: NodeJS.Timeout
  finish?: () => void
  reject?: () => void
  begin?: () => void
}
let active: Recording | null = null
type VoiceEngine = {
  modelId: string
  worker?: UtilityProcess
  ready?: Promise<UtilityProcess>
  reject?: () => void
}
let engine: VoiceEngine | null = null
const root = (): string => join(app.getPath('userData'), 'voice-models')
const directory = (id: string): string => join(root(), id)
const supported = (): boolean =>
  (process.platform === 'win32' && process.arch === 'x64') ||
  (process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)) ||
  (process.platform === 'linux' && ['arm64', 'x64'].includes(process.arch))

/**
 * Hands-free listening. Only the newest listener holds the microphone, and only
 * while no dictation is active; the rest wait and resume in order.
 */
type Listener = {
  id: string
  sender: WebContents
  gate: SpeechGate
  /** Audio just before speech crossed the gate, so first syllables are kept. */
  preroll: Float32Array[]
  worker?: UtilityProcess
  recorder?: Recorder
  utterance: {
    id: string
    text: string
    pending: number
    elapsed: number
    finishing: boolean
  } | null
}
let listeners: Listener[] = []
let capture: Listener | null = null
let listenerSync: Promise<void> = Promise.resolve()
/** Suspended or locked: listeners keep their place but release the microphone. */
let away = false

/** Energy gate over 100 ms chunks with an adaptive noise floor. */
class SpeechGate {
  private floor = 0.003
  private silence = 0
  speaking = false
  constructor(private readonly endMs: number) {}
  push(samples: Float32Array): 'start' | 'end' | null {
    let sum = 0
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
    const rms = Math.sqrt(sum / Math.max(1, samples.length))
    const threshold = Math.min(0.04, Math.max(0.006, this.floor * 2.5))
    const ms = samples.length / 16
    if (rms < threshold) this.floor = this.floor * 0.95 + rms * 0.05
    if (rms >= threshold) {
      this.silence = 0
      if (!this.speaking) {
        this.speaking = true
        return 'start'
      }
    } else if (this.speaking) {
      this.silence += ms
      if (this.silence >= this.endMs) {
        this.speaking = false
        this.silence = 0
        return 'end'
      }
    }
    return null
  }
}

function send(target: WebContents | undefined, event: VoiceEvent): void {
  if (target && !target.isDestroyed()) target.send(CHANNELS.voiceEvent, event)
}
/** State reaches every app window (overlay and VTuber read it too); toggles go to main. */
function emit(event: VoiceEvent): void {
  if (event.type === 'state') {
    for (const win of BrowserWindow.getAllWindows())
      if (!win.isDestroyed()) send(win.webContents, event)
  } else if (window && !window.isDestroyed()) send(window.webContents, event)
}
const watched = new WeakSet<WebContents>()
/** Abandon a window's recording and listeners when it goes away or navigates. */
function watchSender(target: WebContents): void {
  if (watched.has(target)) return
  watched.add(target)
  const abandon = (): void => {
    if (active?.sender === target) void stopVoice(false)
    const before = listeners.length
    listeners = listeners.filter((l) => l.sender !== target)
    if (listeners.length !== before) syncListeners()
  }
  target.on('destroyed', abandon)
  target.on('render-process-gone', abandon)
  target.on('did-start-navigation', (_e, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) abandon()
  })
}
function permission(): string {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? systemPreferences.getMediaAccessStatus('microphone')
    : 'unknown'
}
async function installed(id: string): Promise<boolean> {
  const model = VOICE_MODELS.find((m) => m.id === id)
  if (!model) return false
  try {
    if ((await readFile(join(directory(id), 'verified'), 'utf8')) !== model.revision) return false
    return (
      await Promise.all(
        model.files.map(async (f) => (await stat(join(directory(id), f.name))).size === f.bytes)
      )
    ).every(Boolean)
  } catch {
    return false
  }
}
export async function voiceState(): Promise<VoiceState> {
  const models = (
    await Promise.all(VOICE_MODELS.map(async (m) => ((await installed(m.id)) ? m.id : null)))
  ).filter((id): id is string => id !== null)
  return {
    settings: getVoiceSettings(),
    supported: supported(),
    permission: permission(),
    installed: models,
    download: download
      ? { modelId: download.modelId, received: download.received, total: download.total }
      : null,
    error: lastError
  }
}
async function publish(): Promise<void> {
  const revision = ++publishRevision
  const state = await voiceState()
  if (revision === publishRevision) emit({ type: 'state', state })
}
function fail(error: VoiceError): VoiceResult<never> {
  return { ok: false, error }
}

function unloadEngine(): void {
  const previous = engine
  engine = null
  previous?.reject?.()
  previous?.worker?.kill()
}

function loadEngine(modelId: string): Promise<UtilityProcess> {
  if (engine?.modelId === modelId && engine.ready) return engine.ready
  unloadEngine()
  const loading: VoiceEngine = { modelId }
  engine = loading
  loading.ready = (async () => {
    if (!(await installed(modelId))) throw 'modelRequired'
    if (engine !== loading) throw 'engineFailed'
    const worker = utilityProcess.fork(join(__dirname, 'voice-inference.js'), [], {
      serviceName: 'Roxy Voice',
      stdio: 'ignore'
    })
    loading.worker = worker
    worker.once('spawn', () => {
      if (engine !== loading) worker.kill()
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject('engineFailed'), 60_000)
      loading.reject = () => {
        clearTimeout(timer)
        reject('engineFailed')
      }
      worker.on('message', (message) => {
        if (engine !== loading) return
        if (message.type === 'ready') {
          clearTimeout(timer)
          resolve()
          return
        }
        if (message.type === 'error') {
          const recording = active
          unloadEngine()
          if (recording?.worker === worker) void stopVoice(false, 'engineFailed')
          return
        }
        const utterance = capture?.worker === worker ? capture.utterance : null
        if (utterance && message.recordingId === utterance.id) {
          if (message.type === 'text' && typeof message.text === 'string')
            utterance.text = message.text
          else if (message.type === 'ack')
            utterance.pending = Math.max(0, utterance.pending - message.frames)
          else if (message.type === 'finished') finishUtterance(capture!, worker)
          return
        }
        const recording = active
        if (
          !recording ||
          recording.worker !== worker ||
          recording.cancelled ||
          message.recordingId !== recording.id
        )
          return
        if (message.type === 'started') recording.begin?.()
        else if (message.type === 'text' && typeof message.text === 'string') {
          send(recording.sender, {
            type: 'transcript',
            recordingId: recording.id,
            sequence: ++recording.sequence,
            text: message.text
          })
        } else if (message.type === 'ack')
          recording.pending = Math.max(0, recording.pending - message.frames)
        else if (message.type === 'finished') recording.finish?.()
      })
      worker.once('exit', () => {
        loading.reject?.()
        if (capture?.worker === worker) {
          void releaseCapture()
          syncListeners()
        }
        if (engine !== loading) return
        engine = null
        if (active?.worker === worker) void stopVoice(false, 'engineFailed')
      })
      worker.postMessage({ type: 'load', directory: directory(modelId) })
    })
    return worker
  })().catch((error) => {
    if (engine === loading) unloadEngine()
    throw error
  })
  return loading.ready
}

function warmEngine(): void {
  const settings = getVoiceSettings()
  if (!supported() || !settings.enabled || !settings.modelId) {
    unloadEngine()
    return
  }
  // Loading weights never requests mic permission or opens a capture stream.
  void loadEngine(settings.modelId).catch(() => undefined)
}

function bindHotkeys(settings: VoiceSettings): VoiceError | null {
  const wanted = settings.enabled ? settings.hotkeys.filter(Boolean) : []
  if (new Set(wanted.map((s) => s.toLowerCase())).size !== wanted.length) return 'shortcutInvalid'
  const added: string[] = []
  try {
    for (const key of wanted) {
      if (shortcuts.includes(key)) continue
      if (
        globalShortcut.isRegistered(key) ||
        !globalShortcut.register(key, () => {
          const now = Date.now()
          const repeated = now - lastShortcutPress < 250
          lastShortcutPress = now
          if (repeated) return
          if (!window || window.isDestroyed()) return
          if (window.isMinimized()) window.restore()
          window.show()
          window.focus()
          emit({ type: 'toggle' })
        })
      ) {
        added.forEach((k) => globalShortcut.unregister(k))
        return 'shortcutTaken'
      }
      added.push(key)
    }
  } catch {
    added.forEach((k) => globalShortcut.unregister(k))
    return 'shortcutInvalid'
  }
  shortcuts.filter((k) => !wanted.includes(k)).forEach((k) => globalShortcut.unregister(k))
  shortcuts = wanted
  return null
}

export function setVoiceWindow(target: BrowserWindow): void {
  window = target
  watchSender(target.webContents)
  target.on('closed', () => {
    if (window === target) window = null
  })
}

async function pickDevice(
  native: typeof import('@handy-computer/recorder'),
  settings: VoiceSettings
): Promise<{ id?: string; fallback: boolean }> {
  const devices = await native.listInputDevices()
  const selected = settings.microphone
  const device = selected
    ? (devices.find((d) => d.id === selected.id) ??
      devices.find((d) => d.name === selected.name && d.occurrence === selected.occurrence))
    : undefined
  return { id: device?.id, fallback: !!selected && !device }
}

async function micAllowed(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  const access = permission()
  if (access === 'denied' || access === 'restricted') return false
  return access === 'granted' || (await systemPreferences.askForMediaAccess('microphone'))
}

// ---- Hands-free listeners --------------------------------------------------

function listenerReady(): boolean {
  const settings = getVoiceSettings()
  return supported() && settings.enabled && !!settings.modelId && !active && !changing && !away
}

/** Recompute which listener owns the microphone. Serialized; safe to call often. */
function syncListeners(): void {
  listenerSync = listenerSync
    .then(async () => {
      const wanted = listenerReady() ? (listeners.at(-1) ?? null) : null
      if (capture === wanted) return
      await releaseCapture()
      if (wanted) await openCapture(wanted)
    })
    .catch(() => undefined)
}

function dropUtterance(listener: Listener): void {
  const utterance = listener.utterance
  listener.utterance = null
  if (!utterance) return
  try {
    listener.worker?.postMessage({ type: 'reset', recordingId: utterance.id })
  } catch {
    unloadEngine()
  }
}

async function releaseCapture(): Promise<void> {
  const listener = capture
  if (!listener) return
  capture = null
  dropUtterance(listener)
  const recorder = listener.recorder
  listener.recorder = undefined
  listener.worker = undefined
  listener.gate = new SpeechGate(700)
  listener.preroll = []
  await recorder?.close().catch(() => undefined)
}

async function openCapture(listener: Listener): Promise<void> {
  const settings = getVoiceSettings()
  const current = (): boolean => listeners.includes(listener) && listenerReady()
  capture = listener
  try {
    const worker = await loadEngine(settings.modelId!)
    if (capture !== listener || !current()) return
    if (!(await micAllowed())) throw 'permissionDenied'
    const native = await import('@handy-computer/recorder')
    const { id } = await pickDevice(native, settings)
    if (capture !== listener || !current()) return
    listener.worker = worker
    const options = {
      sampleRate: 16000,
      channels: 'mono' as const,
      framesPerChunk: 1600,
      collect: false,
      onChunk: ({ samples }: { samples: Float32Array }): void => listenerChunk(listener, samples),
      onFailure: (e: { code: string }): void => {
        if (capture !== listener) return
        failListener(listener, e.code === 'PermissionDenied' ? 'permissionDenied' : 'captureFailed')
      }
    }
    let recorder: Recorder
    try {
      recorder = await native.Recorder.open({ ...options, device: id })
    } catch (e) {
      if (!id || (e as { code?: string }).code !== 'DeviceUnavailable') throw e
      recorder = await native.Recorder.open(options)
    }
    if (capture !== listener || !current()) {
      await recorder.close()
      return
    }
    listener.recorder = recorder
    recorder.start()
    send(listener.sender, { type: 'listener', listenerId: listener.id, phase: 'listening' })
  } catch (e) {
    if (capture !== listener) return
    failListener(
      listener,
      typeof e === 'string'
        ? (e as VoiceError)
        : (e as { code?: string }).code === 'PermissionDenied'
          ? 'permissionDenied'
          : 'captureFailed'
    )
  }
}

/** A listener that cannot capture is removed; its window decides whether to retry. */
function failListener(listener: Listener, error: VoiceError): void {
  listeners = listeners.filter((l) => l !== listener)
  if (capture === listener) void releaseCapture()
  send(listener.sender, { type: 'listener', listenerId: listener.id, phase: 'stopped', error })
  syncListeners()
}

function listenerChunk(listener: Listener, samples: Float32Array): void {
  if (capture !== listener || !listener.worker) return
  const worker = listener.worker
  const utterance = listener.utterance
  if (utterance?.finishing) return
  const edge = listener.gate.push(samples)
  const post = (chunk: Float32Array, id: string): void => {
    try {
      worker.postMessage({ type: 'audio', recordingId: id, samples: chunk })
    } catch {
      unloadEngine()
    }
  }
  if (!utterance) {
    if (edge !== 'start') {
      listener.preroll.push(samples)
      if (listener.preroll.length > 4) listener.preroll.shift()
      return
    }
    const next = {
      id: randomUUID(),
      text: '',
      pending: 0,
      elapsed: 0,
      finishing: false
    }
    listener.utterance = next
    worker.postMessage({ type: 'begin', recordingId: next.id })
    for (const chunk of [...listener.preroll, samples]) {
      next.pending += chunk.length
      post(chunk, next.id)
    }
    listener.preroll = []
    send(listener.sender, { type: 'listener', listenerId: listener.id, phase: 'speech' })
    return
  }
  utterance.pending += samples.length
  utterance.elapsed += samples.length
  // Recognition falling behind: drop this utterance rather than queue audio.
  if (utterance.pending > 16000 * 5) {
    dropUtterance(listener)
    send(listener.sender, { type: 'listener', listenerId: listener.id, phase: 'listening' })
    return
  }
  post(samples, utterance.id)
  if (edge === 'end' || utterance.elapsed > 16000 * 15) {
    utterance.finishing = true
    worker.postMessage({ type: 'finish', recordingId: utterance.id })
    send(listener.sender, { type: 'listener', listenerId: listener.id, phase: 'processing' })
  }
}

function finishUtterance(listener: Listener, worker: UtilityProcess): void {
  const utterance = listener.utterance
  if (!utterance) return
  dropUtterance(listener)
  listener.gate = new SpeechGate(700)
  const text = utterance.text.trim()
  if (text) send(listener.sender, { type: 'utterance', listenerId: listener.id, text })
  if (capture === listener && listener.worker === worker)
    send(listener.sender, { type: 'listener', listenerId: listener.id, phase: 'listening' })
}

function listen(sender: WebContents, id: string): VoiceResult {
  if (typeof id !== 'string' || !id || id.length > 100) return fail('unknown')
  if (!supported()) return fail('unsupported')
  const settings = getVoiceSettings()
  if (!settings.enabled) return fail('disabled')
  if (!settings.modelId) return fail('modelRequired')
  if (listeners.some((l) => l.id === id)) return { ok: true, value: undefined }
  watchSender(sender)
  listeners.push({ id, sender, gate: new SpeechGate(700), preroll: [], utterance: null })
  syncListeners()
  return { ok: true, value: undefined }
}

function unlisten(id: string): void {
  const before = listeners.length
  listeners = listeners.filter((l) => l.id !== id)
  if (listeners.length !== before) syncListeners()
}

export async function stopVoice(finalize: boolean, error?: VoiceError): Promise<void> {
  const recording = active
  if (!recording) return
  if (!recording.recorder) finalize = false
  if (!finalize) {
    recording.cancelled = true
    recording.reject?.()
    recording.finish?.()
  }
  if (error === 'engineFailed' || error === 'tooSlow') unloadEngine()
  if (recording.closing) return recording.closing
  recording.stopping = true
  clearTimeout(recording.timer)
  recording.closing = (async () => {
    try {
      if (finalize && recording.recorder?.isRecording) {
        const result = await recording.recorder.stop()
        if (!result.complete) error = 'captureFailed'
      }
      const recorder = recording.recorder ?? (await recording.opening?.catch(() => undefined))
      await recorder?.close()
      if (finalize && !recording.cancelled && active === recording && recording.worker) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            error = 'engineFailed'
            unloadEngine()
            resolve()
          }, 15_000)
          recording.finish = () => {
            clearTimeout(timer)
            resolve()
          }
          recording.worker!.postMessage({ type: 'finish', recordingId: recording.id })
        })
      }
    } catch {
      error ??= 'captureFailed'
    } finally {
      recording.reject?.()
      try {
        recording.worker?.postMessage({ type: 'reset', recordingId: recording.id })
      } catch {
        unloadEngine()
      }
      if (active === recording) active = null
      send(recording.sender, {
        type: 'recording',
        recordingId: recording.id,
        phase: 'stopped',
        error
      })
      syncListeners()
    }
  })()
  return recording.closing
}

async function startVoice(
  sender: WebContents,
  id: string,
  chatId: string,
  options?: VoiceStartOptions
): Promise<VoiceResult> {
  if (active || changing) return fail('busy')
  if (!supported()) return fail('unsupported')
  const settings = getVoiceSettings()
  if (!settings.enabled) return fail('disabled')
  if (!settings.modelId) return fail('modelRequired')
  if (
    typeof chatId !== 'string' ||
    typeof id !== 'string' ||
    !id ||
    id.length > 100 ||
    !getChat(chatId)
  )
    return fail('unknown')
  // Claim before awaiting the OS prompt or model loading, so cancel/navigation
  // invalidates even a late permission response or Bluetooth open completion.
  const recording: Recording = {
    id,
    chatId,
    sender,
    autoStop: options?.autoStop
      ? { gate: new SpeechGate(1500), elapsed: 0, heard: false }
      : undefined,
    sequence: 0,
    pending: 0,
    stopping: false,
    cancelled: false
  }
  active = recording
  watchSender(sender)
  try {
    // A listener holding the microphone yields to dictation before it opens.
    syncListeners()
    await listenerSync
    const worker = await loadEngine(settings.modelId)
    if (active !== recording || recording.cancelled) return fail('busy')
    if (!(await micAllowed())) throw 'permissionDenied'
    if (active !== recording || recording.cancelled) return fail('busy')
    recording.worker = worker
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        unloadEngine()
        reject('engineFailed')
      }, 15_000)
      recording.begin = () => {
        clearTimeout(timer)
        resolve()
      }
      recording.reject = () => {
        clearTimeout(timer)
        reject('engineFailed')
      }
      worker.postMessage({ type: 'begin', recordingId: id })
    })
    if (active !== recording || recording.cancelled) return fail('busy')
    const native = await import('@handy-computer/recorder')
    const picked = await pickDevice(native, settings)
    if (active !== recording || recording.cancelled) return fail('busy')
    const device = picked.id ? { id: picked.id } : undefined
    let fallback = picked.fallback
    let first = true
    const options = {
      sampleRate: 16000,
      channels: 'mono' as const,
      framesPerChunk: 1600,
      collect: false,
      onChunk: ({ samples }: { samples: Float32Array }): void => {
        if (active !== recording || recording.cancelled) return
        if (!getChat(recording.chatId)) {
          void stopVoice(false)
          return
        }
        if (first) {
          first = false
          send(sender, { type: 'recording', recordingId: id, phase: 'recording', fallback })
        }
        recording.pending += samples.length
        if (recording.pending > 16000 * 5) {
          void stopVoice(false, 'tooSlow')
          return
        }
        try {
          worker.postMessage({ type: 'audio', recordingId: id, samples })
        } catch {
          void stopVoice(false, 'engineFailed')
          return
        }
        const auto = recording.autoStop
        if (auto && !recording.stopping) {
          auto.elapsed += samples.length
          const edge = auto.gate.push(samples)
          if (edge === 'start') auto.heard = true
          // Finish after a pause once speech was heard, or when nothing is said.
          if (edge === 'end' || (!auto.heard && auto.elapsed > 16000 * 8)) void stopVoice(true)
        }
      },
      onFailure: (e: { code: string }): void => {
        if (active === recording && !recording.cancelled)
          void stopVoice(
            false,
            e.code === 'PermissionDenied' ? 'permissionDenied' : 'captureFailed'
          )
      }
    }
    let recorder: Recorder
    try {
      recording.opening = native.Recorder.open({ ...options, device: device?.id })
      recorder = await recording.opening
    } catch (e) {
      if (active !== recording || recording.cancelled) return fail('busy')
      if (!device || (e as { code?: string }).code !== 'DeviceUnavailable') throw e
      fallback = true
      recording.opening = native.Recorder.open(options)
      recorder = await recording.opening
    }
    recording.recorder = recorder
    if (active !== recording || recording.cancelled || recorder.failure) {
      await recorder.close()
      if (active === recording && !recording.cancelled) throw 'captureFailed'
      return fail('busy')
    }
    recorder.start()
    recording.timer = setTimeout(() => {
      if (active === recording) void stopVoice(true)
    }, 10 * 60_000)
    return { ok: true, value: undefined }
  } catch (e) {
    const code: VoiceError =
      typeof e === 'string'
        ? (e as VoiceError)
        : (e as { code?: string }).code === 'PermissionDenied'
          ? 'permissionDenied'
          : 'captureFailed'
    if (active === recording) await stopVoice(false, code)
    return fail(code)
  }
}

async function downloadModel(id: string): Promise<VoiceResult> {
  if (download || changing) return fail('busy')
  if (!getVoiceSettings().enabled) return fail('disabled')
  const model = VOICE_MODELS.find((m) => m.id === id)
  if (!model) return fail('modelRequired')
  const job = {
    modelId: id,
    received: 0,
    total: model.files.reduce((n, f) => n + f.bytes, 0),
    controller: new AbortController()
  }
  download = job
  lastError = null
  const temp = join(root(), id + '.partial')
  try {
    if (await installed(id)) return { ok: true, value: undefined }
    job.controller.signal.throwIfAborted()
    await rm(temp, { recursive: true, force: true })
    await mkdir(temp, { recursive: true })
    await publish()
    let lastUpdate = 0
    for (const file of model.files) {
      const response = await fetch(
        `https://huggingface.co/${model.repository}/resolve/${model.revision}/${file.name}`,
        {
          signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(30 * 60_000)])
        }
      )
      if (!response.ok || !response.body) throw 'downloadFailed'
      const hash = createHash('sha256')
      let bytes = 0
      const handle = await open(join(temp, file.name), 'w')
      try {
        for await (const chunk of response.body) {
          job.controller.signal.throwIfAborted()
          bytes += chunk.length
          if (bytes > file.bytes) throw 'integrityFailed'
          hash.update(chunk)
          let offset = 0
          while (offset < chunk.length) {
            const written = (await handle.write(chunk, offset)).bytesWritten
            if (!written) throw 'downloadFailed'
            offset += written
          }
          job.received += chunk.length
          if (Date.now() - lastUpdate > 150) {
            lastUpdate = Date.now()
            void publish()
          }
        }
      } finally {
        await handle.close()
      }
      if (bytes !== file.bytes || hash.digest('hex') !== file.sha256) throw 'integrityFailed'
    }
    job.controller.signal.throwIfAborted()
    await writeFile(join(temp, 'verified'), model.revision)
    await rm(directory(id), { recursive: true, force: true })
    await rename(temp, directory(id))
    if (getVoiceSettings().modelId === id) warmEngine()
    return { ok: true, value: undefined }
  } catch (e) {
    const cancelled = job.controller.signal.aborted
    if (!cancelled) lastError = e === 'integrityFailed' ? 'integrityFailed' : 'downloadFailed'
    await rm(temp, { recursive: true, force: true }).catch(() => undefined)
    if (cancelled) return { ok: true, value: undefined }
    return fail(lastError ?? 'downloadFailed')
  } finally {
    if (download === job) download = null
    await publish()
  }
}

export function shutdownVoice(): void {
  download?.controller.abort()
  shortcuts.forEach((key) => globalShortcut.unregister(key))
  shortcuts = []
  listeners = []
  void releaseCapture()
  void stopVoice(false)
  unloadEngine()
}

export async function resetVoice(): Promise<void> {
  shutdownVoice()
  await stopVoice(false)
  setVoiceSettings(normalizeVoice(null))
  lastError = null
  await publish()
}

export function registerVoiceIpc(): void {
  lastError = bindHotkeys(getVoiceSettings())
  warmEngine()
  // Asleep or locked, nobody is talking to Roxy: close the microphone until back.
  const leave = (): void => {
    away = true
    void stopVoice(false)
    listenerSync = listenerSync.then(releaseCapture).catch(() => undefined)
  }
  const back = (): void => {
    away = false
    syncListeners()
  }
  powerMonitor.on('suspend', leave)
  powerMonitor.on('lock-screen', leave)
  powerMonitor.on('resume', back)
  powerMonitor.on('unlock-screen', back)
  // Any app window (main, overlay, VTuber) may use voice; events go back to the sender.
  const trusted = (e: IpcMainInvokeEvent): boolean =>
    !!BrowserWindow.fromWebContents(e.sender) &&
    !e.sender.isDestroyed() &&
    e.senderFrame === e.sender.mainFrame &&
    [
      process.env.ELECTRON_RENDERER_URL?.replace(/\/$/, '') + '/',
      pathToFileURL(join(__dirname, '../renderer/index.html')).href
    ].includes(e.sender.getURL().split('#')[0])
  const handle = (
    channel: string,
    action: (e: IpcMainInvokeEvent, ...args: any[]) => unknown
  ): void => {
    ipcMain.handle(channel, (e, ...args) => (trusted(e) ? action(e, ...args) : fail('disabled')))
  }
  handle(CHANNELS.voiceState, () => voiceState())
  handle(CHANNELS.voiceUpdate, async (_e, patch: Partial<VoiceSettings>) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return fail('unknown')
    if (changing) return fail('busy')
    changing = true
    try {
      const before = getVoiceSettings()
      const next = normalizeVoice({ ...before, ...patch })
      const error = bindHotkeys(next)
      if (error) return fail(error)
      try {
        setVoiceSettings(next)
      } catch {
        bindHotkeys(before)
        return fail('unknown')
      }
      await stopVoice(false)
      // Reopen listeners on the new engine or microphone; other fields don't touch capture.
      const capturing = (s: VoiceSettings): string =>
        JSON.stringify([s.enabled, s.modelId, s.microphone])
      if (capturing(before) !== capturing(next))
        listenerSync = listenerSync.then(releaseCapture).catch(() => undefined)
      warmEngine()
      if (!next.enabled) download?.controller.abort()
      lastError = null
      await publish()
      return { ok: true, value: next }
    } finally {
      changing = false
      syncListeners()
    }
  })
  handle(CHANNELS.voiceDevices, async (): Promise<VoiceResult<VoiceDevice[]>> => {
    if (!getVoiceSettings().enabled) return fail('disabled')
    try {
      if (
        process.platform === 'darwin' &&
        permission() !== 'granted' &&
        !(await systemPreferences.askForMediaAccess('microphone'))
      )
        return fail('permissionDenied')
      const native = await import('@handy-computer/recorder')
      await publish()
      return {
        ok: true,
        value: (await native.listInputDevices())
          .filter((d) => !d.isMonitor)
          .map(({ id, name, occurrence, isDefault }) => ({ id, name, occurrence, isDefault }))
      }
    } catch {
      return fail('deviceUnavailable')
    }
  })
  handle(CHANNELS.voicePrivacy, () => {
    if (process.platform === 'darwin')
      return shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'
      )
    if (process.platform === 'win32') return shell.openExternal('ms-settings:privacy-microphone')
    return undefined
  })
  handle(CHANNELS.voiceDownload, (_e, id: string) => downloadModel(id))
  handle(CHANNELS.voiceCancelDownload, () => {
    download?.controller.abort()
  })
  handle(CHANNELS.voiceRemove, async (_e, id: string) => {
    if (changing || download?.modelId === id || !VOICE_MODELS.some((m) => m.id === id))
      return fail('busy')
    changing = true
    try {
      await stopVoice(false)
      if (engine?.modelId === id) unloadEngine()
      await rm(directory(id), { recursive: true, force: true })
      if (getVoiceSettings().modelId === id)
        setVoiceSettings({ ...getVoiceSettings(), modelId: null })
      await publish()
      return { ok: true, value: undefined }
    } catch {
      return fail('unknown')
    } finally {
      changing = false
      syncListeners()
    }
  })
  handle(CHANNELS.voiceStart, (e, id: string, chatId: string, options?: VoiceStartOptions) =>
    startVoice(e.sender, id, chatId, { autoStop: options?.autoStop === true })
  )
  handle(CHANNELS.voiceStop, async (e, id: string, finalize: boolean) => {
    if (active?.id === id && active.sender === e.sender) await stopVoice(finalize === true)
  })
  handle(CHANNELS.voiceListen, (e, id: string) => listen(e.sender, id))
  handle(CHANNELS.voiceUnlisten, (e, id: string) => {
    if (listeners.some((l) => l.id === id && l.sender === e.sender)) unlisten(id)
  })
}
