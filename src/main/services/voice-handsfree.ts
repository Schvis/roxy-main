/**
 * Fork additions to upstream's voice service (see docs/voice-hands-free.md):
 * hands-free listeners for the wake word and VTuber conversation, dictation
 * auto-stop, and voice from any app window (overlay included) with events routed
 * back to the window that started the recording.
 *
 * voice.ts owns the engine and dictation; it creates this with `createHandsFree`
 * and calls the returned hooks at a few marked lines, keeping upstream merges small.
 */
import { BrowserWindow, powerMonitor, systemPreferences } from 'electron'
import type { IpcMainInvokeEvent, UtilityProcess, WebContents } from 'electron'
import type { Recorder } from '@handy-computer/recorder'
import { randomUUID } from 'node:crypto'
import { CHANNELS } from '../../shared/ipc'
import type { VoiceError, VoiceEvent, VoiceResult, VoiceSettings } from '../../shared/voice'
import type { VoiceStartOptions } from '../../shared/voice-handsfree'

/** What voice.ts lends the hands-free layer. */
export interface VoiceHost {
  settings(): VoiceSettings
  supported(): boolean
  /** Dictation is active or settings are changing: listeners must not hold the mic. */
  busy(): boolean
  loadEngine(modelId: string): Promise<UtilityProcess>
  unloadEngine(): void
  /** Cancel this dictation if it is still the active one. */
  cancel(recordingId: string): void
}

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
  /** Engine, model and microphone the capture was opened with. */
  key?: string
  utterance: {
    id: string
    text: string
    pending: number
    elapsed: number
    finishing: boolean
  } | null
}

type Dictation = {
  sender: WebContents
  autoStop?: { gate: SpeechGate; elapsed: number; heard: boolean; fired: boolean }
}

function send(target: WebContents | undefined, event: VoiceEvent): void {
  if (target && !target.isDestroyed()) target.send(CHANNELS.voiceEvent, event)
}

function permission(): string {
  return process.platform === 'darwin' || process.platform === 'win32'
    ? systemPreferences.getMediaAccessStatus('microphone')
    : 'unknown'
}

async function micAllowed(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  const access = permission()
  if (access === 'denied' || access === 'restricted') return false
  return access === 'granted' || (await systemPreferences.askForMediaAccess('microphone'))
}

const captureKey = (s: VoiceSettings): string =>
  JSON.stringify([s.enabled, s.modelId, s.microphone])

export function createHandsFree(host: VoiceHost): {
  isAppWindow(target: WebContents): boolean
  route(event: VoiceEvent): boolean
  onWorkerMessage(worker: UtilityProcess, message: Record<string, unknown>): boolean
  onWorkerExit(worker: UtilityProcess): void
  dictate(
    sender: WebContents,
    id: string,
    options: VoiceStartOptions | undefined,
    start: () => Promise<VoiceResult>
  ): Promise<VoiceResult>
  autoStop(recordingId: string, samples: Float32Array): boolean
  register(
    handle: (channel: string, action: (e: IpcMainInvokeEvent, ...args: any[]) => unknown) => void
  ): void
  shutdown(): void
} {
  let listeners: Listener[] = []
  let capture: Listener | null = null
  let listenerSync: Promise<void> = Promise.resolve()
  /** Suspended or locked: listeners keep their place but release the microphone. */
  let away = false
  const dictations = new Map<string, Dictation>()
  const watched = new WeakSet<WebContents>()

  /** Abandon a window's dictation and listeners when it goes away or navigates. */
  function watchSender(target: WebContents): void {
    if (watched.has(target)) return
    watched.add(target)
    const abandon = (): void => {
      for (const [id, d] of dictations) if (d.sender === target) host.cancel(id)
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

  function listenerReady(): boolean {
    const settings = host.settings()
    return host.supported() && settings.enabled && !!settings.modelId && !host.busy() && !away
  }

  /** Recompute which listener owns the microphone. Serialized; safe to call often. */
  function syncListeners(): Promise<void> {
    listenerSync = listenerSync
      .then(async () => {
        const wanted = listenerReady() ? (listeners.at(-1) ?? null) : null
        if (capture && (capture !== wanted || capture.key !== captureKey(host.settings())))
          await releaseCapture()
        if (wanted && capture !== wanted) await openCapture(wanted)
      })
      .catch(() => undefined)
    return listenerSync
  }

  function dropUtterance(listener: Listener): void {
    const utterance = listener.utterance
    listener.utterance = null
    if (!utterance) return
    try {
      listener.worker?.postMessage({ type: 'reset', recordingId: utterance.id })
    } catch {
      host.unloadEngine()
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
    listener.key = undefined
    listener.gate = new SpeechGate(700)
    listener.preroll = []
    await recorder?.close().catch(() => undefined)
  }

  async function openCapture(listener: Listener): Promise<void> {
    const settings = host.settings()
    const current = (): boolean =>
      capture === listener && listeners.includes(listener) && listenerReady()
    capture = listener
    listener.key = captureKey(settings)
    try {
      const worker = await host.loadEngine(settings.modelId!)
      if (!current()) return
      if (!(await micAllowed())) throw 'permissionDenied'
      const native = await import('@handy-computer/recorder')
      const devices = await native.listInputDevices()
      const selected = settings.microphone
      const device = selected
        ? (devices.find((d) => d.id === selected.id) ??
          devices.find((d) => d.name === selected.name && d.occurrence === selected.occurrence))
        : undefined
      if (!current()) return
      listener.worker = worker
      const options = {
        sampleRate: 16000,
        channels: 'mono' as const,
        framesPerChunk: 1600,
        collect: false,
        onChunk: ({ samples }: { samples: Float32Array }): void => listenerChunk(listener, samples),
        onFailure: (e: { code: string }): void => {
          if (capture !== listener) return
          failListener(
            listener,
            e.code === 'PermissionDenied' ? 'permissionDenied' : 'captureFailed'
          )
        }
      }
      let recorder: Recorder
      try {
        recorder = await native.Recorder.open({ ...options, device: device?.id })
      } catch (e) {
        if (!device || (e as { code?: string }).code !== 'DeviceUnavailable') throw e
        recorder = await native.Recorder.open(options)
      }
      if (!current()) {
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
    void syncListeners()
  }

  function listenerChunk(listener: Listener, samples: Float32Array): void {
    // A dictation owns the engine stream from the moment it starts.
    if (capture !== listener || !listener.worker || host.busy()) return
    const worker = listener.worker
    const utterance = listener.utterance
    if (utterance?.finishing) return
    const edge = listener.gate.push(samples)
    const post = (chunk: Float32Array, id: string): void => {
      try {
        worker.postMessage({ type: 'audio', recordingId: id, samples: chunk })
      } catch {
        host.unloadEngine()
      }
    }
    if (!utterance) {
      if (edge !== 'start') {
        listener.preroll.push(samples)
        if (listener.preroll.length > 3) listener.preroll.shift()
        return
      }
      const next = { id: randomUUID(), text: '', pending: 0, elapsed: 0, finishing: false }
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
    if (typeof id !== 'string' || !id || id.length > 100) return { ok: false, error: 'unknown' }
    if (!host.supported()) return { ok: false, error: 'unsupported' }
    const settings = host.settings()
    if (!settings.enabled) return { ok: false, error: 'disabled' }
    if (!settings.modelId) return { ok: false, error: 'modelRequired' }
    if (listeners.some((l) => l.id === id)) return { ok: true, value: undefined }
    watchSender(sender)
    listeners.push({ id, sender, gate: new SpeechGate(700), preroll: [], utterance: null })
    void syncListeners()
    return { ok: true, value: undefined }
  }

  function unlisten(sender: WebContents, id: string): void {
    const before = listeners.length
    listeners = listeners.filter((l) => !(l.id === id && l.sender === sender))
    if (listeners.length !== before) void syncListeners()
  }

  return {
    /** Any app window (main, overlay, VTuber) may use voice, not only the main one. */
    isAppWindow: (target) => !!BrowserWindow.fromWebContents(target) && !target.isDestroyed(),

    /** Deliver an event; false leaves it to upstream's main-window send. */
    route(event) {
      if (event.type === 'state') {
        for (const win of BrowserWindow.getAllWindows())
          if (!win.isDestroyed()) send(win.webContents, event)
        // Settings, engine or model changed: re-evaluate once the change has settled.
        setTimeout(() => void syncListeners(), 0)
        return true
      }
      if (event.type !== 'recording' && event.type !== 'transcript') return false
      const dictation = dictations.get(event.recordingId)
      if (!dictation) return false
      send(dictation.sender, event)
      if (event.type === 'recording' && event.phase === 'stopped') {
        dictations.delete(event.recordingId)
        void syncListeners()
      }
      return true
    },

    /** Claim engine messages for a listener's utterance; true when handled. */
    onWorkerMessage(worker, message) {
      const utterance = capture?.worker === worker ? capture.utterance : null
      if (!utterance || message.recordingId !== utterance.id) return false
      if (message.type === 'text' && typeof message.text === 'string') utterance.text = message.text
      else if (message.type === 'ack')
        utterance.pending = Math.max(0, utterance.pending - (message.frames as number))
      else if (message.type === 'finished') finishUtterance(capture!, worker)
      return true
    },

    onWorkerExit(worker) {
      if (capture?.worker !== worker) return
      void releaseCapture()
      void syncListeners()
    },

    /** Start a dictation for `sender`; listeners give it the microphone. */
    async dictate(sender, id, options, start) {
      if (typeof id === 'string' && id) {
        watchSender(sender)
        dictations.set(id, {
          sender,
          autoStop: options?.autoStop
            ? { gate: new SpeechGate(1500), elapsed: 0, heard: false, fired: false }
            : undefined
        })
      }
      // start() marks the dictation active before its first await, so a stop sent
      // right after still finds it; the listener then hands over the microphone.
      const pending = start()
      void syncListeners()
      const result = await pending
      if (!result.ok) {
        dictations.delete(id)
        void syncListeners()
      }
      return result
    },

    /** Feed dictation audio; true once a pause after speech (or 8 s of none) should finish it. */
    autoStop(recordingId, samples) {
      const auto = dictations.get(recordingId)?.autoStop
      if (!auto || auto.fired) return false
      auto.elapsed += samples.length
      const edge = auto.gate.push(samples)
      if (edge === 'start') auto.heard = true
      auto.fired = edge === 'end' || (!auto.heard && auto.elapsed > 16000 * 8)
      return auto.fired
    },

    register(handle) {
      handle(CHANNELS.voiceListen, (e, id: string) => listen(e.sender, id))
      handle(CHANNELS.voiceUnlisten, (e, id: string) => unlisten(e.sender, id))
      // Asleep or locked, nobody is talking to Roxy: close the microphone until back.
      const leave = (): void => {
        away = true
        void syncListeners()
      }
      const back = (): void => {
        away = false
        void syncListeners()
      }
      powerMonitor.on('suspend', leave)
      powerMonitor.on('lock-screen', leave)
      powerMonitor.on('resume', back)
      powerMonitor.on('unlock-screen', back)
    },

    shutdown() {
      listeners = []
      void releaseCapture()
    }
  }
}
