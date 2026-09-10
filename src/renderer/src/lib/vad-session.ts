/**
 * Continuous Voice Activity Detection (VAD) conversation loop.
 * Detects user speech bursts, transcribes via Faster-Whisper, captures
 * webcam snapshot when vision is active, and submits to Gemini/Roxy chat.
 */
import { api } from './api'
import { downsampleTo16k, encodeWav } from './audio-recorder'
import { cameraManager } from './vision'
import { useRoxyStore } from './store'
import type { ComposerImage } from './images'

export type VadState =
  | 'idle'
  | 'listening'
  | 'speaking_user'
  | 'transcribing'
  | 'thinking'
  | 'speaking_avatar'

export class VadConversationSession {
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private processor: ScriptProcessorNode | null = null
  private running = false
  private pausedForAvatar = false
  private state: VadState = 'idle'
  private onStateChange: (state: VadState) => void

  private actualSampleRate = 16000
  private audioBuffer: Float32Array[] = []
  private bufferLength = 0
  private isCollecting = false
  private collectStartTime = 0
  private lastVoiceTime = 0
  private isProcessing = false
  private noiseFloor = 0.003
  private cleanupSpeakingListener: (() => void) | null = null
  private cleanupTurnListener: (() => void) | null = null
  private thinkingTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(onStateChange: (state: VadState) => void) {
    this.onStateChange = onStateChange
    this.initListeners()
  }

  private clearThinkingTimeout(): void {
    if (this.thinkingTimeout) {
      clearTimeout(this.thinkingTimeout)
      this.thinkingTimeout = null
    }
  }

  private setState(state: VadState): void {
    if (state !== 'thinking') {
      this.clearThinkingTimeout()
    } else if (!this.thinkingTimeout) {
      this.thinkingTimeout = setTimeout(() => {
        if (this.state === 'thinking') {
          console.warn('[VAD] Thinking state timed out; reverting to listening')
          this.pausedForAvatar = false
          this.resetBuffer()
          if (this.running) {
            this.setState('listening')
          } else {
            this.setState('idle')
          }
        }
      }, 60000)
    }
    this.state = state
    this.onStateChange(state)
  }

  getState(): VadState {
    return this.state
  }

  private resetBuffer(): void {
    this.audioBuffer = []
    this.bufferLength = 0
    this.isCollecting = false
    this.collectStartTime = 0
    this.lastVoiceTime = 0
  }

  private initListeners(): void {
    if (api?.chats?.onTurnState && !this.cleanupTurnListener) {
      this.cleanupTurnListener = api.chats.onTurnState(({ state }) => {
        if (state === 'thinking') {
          this.pausedForAvatar = true
          this.resetBuffer()
          this.setState('thinking')
        } else if (state === 'speaking') {
          this.pausedForAvatar = true
          this.resetBuffer()
          this.setState('speaking_avatar')
        } else if (state === 'idle') {
          this.pausedForAvatar = false
          this.resetBuffer()
          if (this.running) {
            this.setState('listening')
          } else {
            this.setState('idle')
          }
        }
      })
    }

    if (api?.tts?.onSpeakingState && !this.cleanupSpeakingListener) {
      this.cleanupSpeakingListener = api.tts.onSpeakingState((status) => {
        if (status.speaking) {
          this.pausedForAvatar = true
          this.resetBuffer()
          this.setState('speaking_avatar')
        } else {
          if (this.state === 'speaking_avatar') {
            this.pausedForAvatar = true
            this.resetBuffer()
            this.setState('thinking')
          }
        }
      })
    }
  }

  async start(): Promise<boolean> {
    if (this.running) return true
    this.initListeners()

    try {
      const selectedDevice = useRoxyStore.getState().settings?.voiceInputDevice
      const audioConstraint: MediaTrackConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
      if (selectedDevice && selectedDevice !== 'default') {
        audioConstraint.deviceId = { ideal: selectedDevice }
      }

      this.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint })

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.audioContext = new AudioContextClass()
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume()
      }
      this.actualSampleRate = this.audioContext.sampleRate

      const source = this.audioContext.createMediaStreamSource(this.stream)
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1)

      const highpass = this.audioContext.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 85

      source.connect(highpass)
      highpass.connect(this.processor)

      const mute = this.audioContext.createGain()
      mute.gain.value = 0
      this.processor.connect(mute)
      mute.connect(this.audioContext.destination)

      this.processor.onaudioprocess = (e): void => {
        if (
          !this.running ||
          this.pausedForAvatar ||
          this.isProcessing ||
          (this.state !== 'listening' && this.state !== 'speaking_user')
        ) {
          return
        }

        const input = e.inputBuffer.getChannelData(0)
        let sum = 0
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i]
        }
        const rms = Math.sqrt(sum / input.length)

        const chunk = new Float32Array(input)
        this.audioBuffer.push(chunk)
        this.bufferLength += chunk.length

        // Keep rolling buffer of max 8 seconds
        const maxSamples = this.actualSampleRate * 8
        while (this.bufferLength > maxSamples && this.audioBuffer.length > 0) {
          const removed = this.audioBuffer.shift()
          if (removed) this.bufferLength -= removed.length
        }

        const now = Date.now()
        const speechThreshold = Math.max(0.005, Math.min(0.03, this.noiseFloor * 2.2))
        if (rms < speechThreshold) {
          this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02
        }

        if (rms >= speechThreshold) {
          this.lastVoiceTime = now
          if (!this.isCollecting) {
            this.isCollecting = true
            this.collectStartTime = now
            this.setState('speaking_user')
          }
        }

        if (this.isCollecting) {
          const speechDuration = now - this.collectStartTime
          const silenceDuration = now - this.lastVoiceTime

          // User spoke for at least 400ms and has paused for at least 650ms, or hit 10s max speech
          const userFinished = speechDuration >= 400 && silenceDuration >= 650
          const hitMax = speechDuration >= 10000

          if (userFinished || hitMax) {
            this.isCollecting = false
            if (!this.isProcessing) {
              void this.processSpeechBurst()
            }
          }
        }
      }

      this.running = true
      this.pausedForAvatar = false
      this.resetBuffer()
      this.setState('listening')
      return true
    } catch (err) {
      console.warn('[VAD] Failed to start microphone listener:', err)
      this.stop()
      return false
    }
  }

  private async processSpeechBurst(): Promise<void> {
    if (this.isProcessing || !this.running || this.bufferLength === 0 || this.pausedForAvatar) {
      return
    }

    this.isProcessing = true
    this.setState('transcribing')

    try {
      const merged = new Float32Array(this.bufferLength)
      let offset = 0
      for (const chunk of this.audioBuffer) {
        merged.set(chunk, offset)
        offset += chunk.length
      }

      this.resetBuffer()

      const downsampled = downsampleTo16k(merged, this.actualSampleRate)
      const wav = encodeWav(downsampled, 16000)

      const settings = useRoxyStore.getState().settings
      const lang =
        settings?.voiceLang && settings.voiceLang !== 'auto' ? settings.voiceLang : undefined

      const res = await api.stt.transcribe(wav, {
        model: settings?.voiceModel ?? 'base',
        language: lang,
        task: 'transcribe',
        beamSize: 2
      })

      const text = res?.text?.trim()
      if (text && text.length >= 2) {
        this.pausedForAvatar = true
        this.resetBuffer()
        this.setState('thinking')

        // If vision auto-capture is enabled, snapshot the camera frame
        const images: ComposerImage[] = []
        if (settings?.vtuberVisionEnabled) {
          const frame = cameraManager.captureFrame()
          if (frame) {
            images.push(frame)
          }
        }

        const forwarded = await api.chats.submitPrompt(text, images.length > 0 ? images : undefined)
        if (!forwarded) {
          const store = useRoxyStore.getState()
          if (store.activeChatId) {
            await store.submit(text, images.length > 0 ? images : undefined)
          } else {
            this.pausedForAvatar = false
            this.resetBuffer()
            if (this.running) {
              this.setState('listening')
            } else {
              this.setState('idle')
            }
          }
        }
      } else {
        this.pausedForAvatar = false
        this.resetBuffer()
        if (this.running) {
          this.setState('listening')
        } else {
          this.setState('idle')
        }
      }
    } catch (err) {
      console.warn('[VAD] Speech processing error:', err)
      this.pausedForAvatar = false
      this.resetBuffer()
      if (this.running) {
        this.setState('listening')
      } else {
        this.setState('idle')
      }
    } finally {
      this.isProcessing = false
    }
  }

  stop(): void {
    this.running = false
    this.pausedForAvatar = false
    this.clearThinkingTimeout()
    this.setState('idle')
    this.resetBuffer()
    this.isProcessing = false

    this.cleanupSpeakingListener?.()
    this.cleanupSpeakingListener = null
    this.cleanupTurnListener?.()
    this.cleanupTurnListener = null

    if (this.processor) {
      this.processor.disconnect()
      this.processor.onaudioprocess = null
      this.processor = null
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        void this.audioContext.close()
      } catch {
        // ignore
      }
      this.audioContext = null
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop()
      }
      this.stream = null
    }
  }

  destroy(): void {
    this.stop()
  }
}
