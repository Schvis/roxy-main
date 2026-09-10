/**
 * Lightweight background listener for the "Hey Roxy" wake word.
 * Uses Voice Activity Detection (VAD) to sample speech bursts
 * and matches wake word phrases.
 */
import { api } from './api'
import { downsampleTo16k, encodeWav } from './audio-recorder'
import { useRoxyStore } from './store'

function normalizeForMatching(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[,.?!:;'"_~`\-()¡¿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function matchWakeWord(
  text: string,
  customWakeWords?: string[]
): { matched: boolean; query: string } {
  let clean = normalizeForMatching(text)
  if (!clean) return { matched: false, query: '' }

  let hasMatched = false

  // Repeatedly strip leading wake phrases (handles repetitions like "roxy roxy" or "hey roxy roxy")
  let changed = true
  while (changed) {
    changed = false

    // 1. Custom or sampled wake words (longest first)
    if (customWakeWords && customWakeWords.length > 0) {
      const sorted = [...customWakeWords].sort((a, b) => b.length - a.length)
      for (const phrase of sorted) {
        const phraseClean = normalizeForMatching(phrase)
        if (!phraseClean) continue
        const escaped = phraseClean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const regex = new RegExp(`^(?:${escaped})(?:\\s+|$)`, 'i')
        if (regex.test(clean)) {
          clean = clean.replace(regex, '').trim()
          hasMatched = true
          changed = true
          break
        }
      }
      if (changed) continue
    }

    // 2. Default broad phonetic variations of "Hey Roxy" / "Roxy"
    const defaultPrefixRegex =
      /^(?:hey|hi|ok|okay|oye|ey|hola|ay)?\s*(?:roxy|roxi|roxie|rocky|roki|rocsi|rossi|proxie|proxy|rox)(?:\s+|$)/i
    if (defaultPrefixRegex.test(clean)) {
      clean = clean.replace(defaultPrefixRegex, '').trim()
      hasMatched = true
      changed = true
    }
  }

  if (hasMatched) {
    if (!clean) {
      return { matched: true, query: '' }
    }
    // Check if remaining clean is just another wake word variant
    const sub = matchWakeWord(clean, customWakeWords)
    if (sub.matched && !sub.query) {
      return { matched: true, query: '' }
    }
    return { matched: true, query: clean }
  }

  // Fallback: If wake word appears anywhere in text (e.g. prefix had filler "um hey roxy ...")
  const defaultRegex =
    /(?:^|\b)(?:hey|hi|ok|okay|oye|ey|hola|ay)?\s*(?:roxy|roxi|roxie|rocky|roki|rocsi|rossi|proxie|proxy|rox)(?:\b|\s|$)/i
  const match = clean.match(defaultRegex)
  if (match && match.index !== undefined) {
    const afterMatch = clean.slice(match.index + match[0].length).trim()
    if (!afterMatch) {
      return { matched: true, query: '' }
    }
    const sub = matchWakeWord(afterMatch, customWakeWords)
    if (sub.matched && !sub.query) {
      return { matched: true, query: '' }
    }
    return { matched: true, query: afterMatch }
  }

  return { matched: false, query: '' }
}

export class WakeWordListener {
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private listening = false
  private paused = false
  private onWake: ((query?: string) => void) | null = null

  private actualSampleRate = 16000
  private audioBuffer: Float32Array[] = []
  private bufferLength = 0
  private isCollecting = false
  private collectStartTime = 0
  private lastVoiceTime = 0
  private isProcessing = false
  private noiseFloor = 0.002

  async start(onWake: (query?: string) => void): Promise<void> {
    if (this.listening) return
    this.onWake = onWake
    this.paused = false
    this.audioBuffer = []
    this.bufferLength = 0
    this.isCollecting = false
    this.collectStartTime = 0
    this.lastVoiceTime = 0
    this.isProcessing = false
    this.noiseFloor = 0.002

    try {
      const selectedDevice = useRoxyStore.getState().settings?.voiceInputDevice
      const audioConstraint: MediaTrackConstraints = {}
      if (selectedDevice && selectedDevice !== 'default') {
        audioConstraint.deviceId = { ideal: selectedDevice }
      }
      audioConstraint.echoCancellation = true
      audioConstraint.noiseSuppression = true
      audioConstraint.autoGainControl = true

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint })
      } catch (err) {
        console.warn('[WakeWord] Constrained getUserMedia failed, attempting fallback:', err)
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({
            audio:
              selectedDevice && selectedDevice !== 'default'
                ? { deviceId: { ideal: selectedDevice } }
                : true
          })
        } catch (fallbackErr) {
          console.warn('[WakeWord] Fallback failed, opening default audio stream:', fallbackErr)
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        }
      }

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.audioContext = new AudioContextClass()
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }
      this.actualSampleRate = this.audioContext.sampleRate

      this.source = this.audioContext.createMediaStreamSource(this.stream)
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1)

      // Speech conditioning: 85Hz highpass filter to cut rumble + pre-amp boost
      const highpass = this.audioContext.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 85

      const preAmp = this.audioContext.createGain()
      preAmp.gain.value = 1.8

      this.source.connect(highpass)
      highpass.connect(preAmp)
      preAmp.connect(this.processor)

      this.processor.onaudioprocess = (e): void => {
        if (!this.listening || this.paused) return

        const input = e.inputBuffer.getChannelData(0)
        let sum = 0
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i]
        }
        const rms = Math.sqrt(sum / input.length)

        const chunk = new Float32Array(input)
        this.audioBuffer.push(chunk)
        this.bufferLength += chunk.length

        // Keep at most ~3.5 seconds of rolling audio in memory
        const maxSamples = this.actualSampleRate * 3.5
        while (this.bufferLength > maxSamples && this.audioBuffer.length > 0) {
          const removed = this.audioBuffer.shift()
          if (removed) this.bufferLength -= removed.length
        }

        const now = Date.now()
        // Track running ambient noise floor during quieter moments
        const speechThreshold = Math.max(0.004, Math.min(0.025, this.noiseFloor * 2.0))
        if (rms < speechThreshold) {
          this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02
        }

        // Track active speech burst
        if (rms >= speechThreshold) {
          this.lastVoiceTime = now
          if (!this.isCollecting) {
            this.isCollecting = true
            this.collectStartTime = now
          }
        }

        // Trigger wake check rapidly:
        // 1. Natural end of phrase: user spoke for >=450ms then paused for >=280ms
        // 2. Max continuous speech window: capped at 1300ms
        if (this.isCollecting) {
          const speechDuration = now - this.collectStartTime
          const silenceDuration = now - this.lastVoiceTime

          const pausedAfterSpeaking = speechDuration >= 450 && silenceDuration >= 280
          const hitMaxWindow = speechDuration >= 1300

          if (pausedAfterSpeaking || hitMaxWindow) {
            this.isCollecting = false
            if (!this.isProcessing) {
              void this.checkWakeWord()
            }
          }
        }
      }

      const mute = this.audioContext.createGain()
      mute.gain.value = 0
      this.processor.connect(mute)
      mute.connect(this.audioContext.destination)
      this.listening = true
    } catch (err) {
      console.warn('[WakeWord] Failed to start microphone listener:', err)
      this.stop()
    }
  }

  private async checkWakeWord(): Promise<void> {
    if (this.isProcessing || !this.listening || this.paused) return
    if (this.bufferLength === 0) return

    this.isProcessing = true
    try {
      const merged = new Float32Array(this.bufferLength)
      let offset = 0
      for (const chunk of this.audioBuffer) {
        merged.set(chunk, offset)
        offset += chunk.length
      }

      const downsampled = downsampleTo16k(merged, this.actualSampleRate)
      const wav = encodeWav(downsampled, 16000)

      const settings = useRoxyStore.getState().settings
      const customWords = settings?.voiceWakeWords
      const effectiveLang =
        settings?.voiceLang && settings.voiceLang !== 'auto' ? settings.voiceLang : undefined
      const promptBias = customWords?.length ? customWords.join(', ') : 'Hey Roxy.'

      const res = await api.stt.transcribe(wav, {
        model: settings?.voiceModel ?? 'base',
        language: effectiveLang,
        task: 'transcribe',
        initialPrompt: promptBias,
        beamSize: 1
      })
      const text = res?.text?.trim() ?? ''

      if (text) {
        console.log('[WakeWord] Heard speech:', text)
        const match = matchWakeWord(text, customWords)
        if (match.matched) {
          console.log('[WakeWord] Wake word detected! Query:', match.query)
          this.audioBuffer = []
          this.bufferLength = 0
          this.onWake?.(match.query)
          return
        }
      }

      // Preserve last ~1.0s of rolling audio so speech spanning window boundaries is not lost
      const keepSamples = this.actualSampleRate * 1.0
      while (this.bufferLength > keepSamples && this.audioBuffer.length > 0) {
        const removed = this.audioBuffer.shift()
        if (removed) this.bufferLength -= removed.length
      }
    } catch (err) {
      console.debug('[WakeWord] Background check error:', err)
    } finally {
      this.isProcessing = false
    }
  }

  pause(): void {
    this.paused = true
    this.isCollecting = false
    this.lastVoiceTime = 0
    this.audioBuffer = []
    this.bufferLength = 0
  }

  resume(): void {
    this.paused = false
    this.isCollecting = false
    this.lastVoiceTime = 0
    this.audioBuffer = []
    this.bufferLength = 0
    if (this.audioContext && this.audioContext.state === 'suspended') {
      void this.audioContext.resume()
    }
  }

  stop(): void {
    this.listening = false
    this.paused = false
    this.isCollecting = false
    this.isProcessing = false
    this.processor?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.close()
    }
    this.processor = null
    this.source = null
    this.stream = null
    this.audioContext = null
    this.audioBuffer = []
    this.bufferLength = 0
  }

  isListening(): boolean {
    return this.listening && !this.paused
  }
}
