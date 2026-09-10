/**
 * Client-side microphone recorder for speech-to-text.
 * Captures audio stream and encodes to 16kHz mono WAV ArrayBuffer.
 */
import { useRoxyStore } from './store'

export function downsampleTo16k(buffer: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === 16000) return buffer
  const ratio = sampleRate / 16000
  const newLength = Math.round(buffer.length / ratio)
  const result = new Float32Array(newLength)
  let offsetResult = 0
  let offsetBuffer = 0
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio)
    let accum = 0
    let count = 0
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i]
      count++
    }
    result[offsetResult] = count > 0 ? accum / count : (buffer[offsetBuffer] ?? 0)
    offsetResult++
    offsetBuffer = nextOffsetBuffer
  }
  return result
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  const writeString = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  // RIFF identifier
  writeString(0, 'RIFF')
  // RIFF chunk length
  view.setUint32(4, 36 + samples.length * 2, true)
  // RIFF type
  writeString(8, 'WAVE')
  // format chunk identifier
  writeString(12, 'fmt ')
  // format chunk length
  view.setUint32(16, 16, true)
  // sample format (1 = PCM)
  view.setUint16(20, 1, true)
  // channel count (1 = mono)
  view.setUint16(22, 1, true)
  // sample rate
  view.setUint32(24, sampleRate, true)
  // byte rate (sampleRate * channels * bytesPerSample = sampleRate * 1 * 2)
  view.setUint32(28, sampleRate * 2, true)
  // block align (channels * bytesPerSample = 2)
  view.setUint16(32, 2, true)
  // bits per sample
  view.setUint16(34, 16, true)
  // data chunk identifier
  writeString(36, 'data')
  // data chunk length
  view.setUint32(40, samples.length * 2, true)

  // write 16-bit PCM samples
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    offset += 2
  }

  return buffer
}

export interface AudioRecorderOptions {
  silenceDetection?: boolean
  silenceDurationMs?: number
  silenceThreshold?: number
  onSilence?: () => void
  deviceId?: string
}

export class AudioRecorder {
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private recordedChunks: Float32Array[] = []
  private totalLength = 0
  private recording = false
  private actualSampleRate = 16000

  private hasSpoken = false
  private lastSpeechTime = 0
  private silenceTriggered = false

  async start(options?: AudioRecorderOptions): Promise<void> {
    if (this.recording) return
    this.recordedChunks = []
    this.totalLength = 0
    this.hasSpoken = false
    this.lastSpeechTime = 0
    this.silenceTriggered = false

    const silenceDetection = options?.silenceDetection ?? Boolean(options?.onSilence)
    const silenceDurationMs = options?.silenceDurationMs ?? 1800
    const silenceThreshold = options?.silenceThreshold ?? 0.006
    const onSilence = options?.onSilence

    const selectedDevice = options?.deviceId ?? useRoxyStore.getState().settings?.voiceInputDevice
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
      console.warn('[AudioRecorder] Constrained getUserMedia failed, attempting fallback:', err)
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio:
            selectedDevice && selectedDevice !== 'default'
              ? { deviceId: { ideal: selectedDevice } }
              : true
        })
      } catch (fallbackErr) {
        console.warn('[AudioRecorder] Fallback failed, opening default audio stream:', fallbackErr)
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
      if (!this.recording) return
      const input = e.inputBuffer.getChannelData(0)
      const chunk = new Float32Array(input)
      this.recordedChunks.push(chunk)
      this.totalLength += chunk.length

      if (silenceDetection && !this.silenceTriggered) {
        let sum = 0
        for (let i = 0; i < input.length; i++) {
          sum += input[i] * input[i]
        }
        const rms = Math.sqrt(sum / input.length)
        const now = Date.now()

        if (rms >= silenceThreshold) {
          this.hasSpoken = true
          this.lastSpeechTime = now
        } else if (this.hasSpoken && now - this.lastSpeechTime >= silenceDurationMs) {
          this.silenceTriggered = true
          onSilence?.()
        }
      }
    }

    const mute = this.audioContext.createGain()
    mute.gain.value = 0
    this.processor.connect(mute)
    mute.connect(this.audioContext.destination)
    this.recording = true
  }

  async stop(): Promise<ArrayBuffer | null> {
    if (!this.recording) return null
    this.recording = false

    this.processor?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close()
    }

    this.processor = null
    this.source = null
    this.stream = null
    this.audioContext = null

    if (this.totalLength === 0 || (this.silenceTriggered && !this.hasSpoken)) {
      this.recordedChunks = []
      this.totalLength = 0
      return null
    }

    const merged = new Float32Array(this.totalLength)
    let offset = 0
    for (const chunk of this.recordedChunks) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    this.recordedChunks = []

    const downsampled = downsampleTo16k(merged, this.actualSampleRate)
    return encodeWav(downsampled, 16000)
  }

  cancel(): void {
    this.recording = false
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
    this.recordedChunks = []
    this.totalLength = 0
  }

  isRecording(): boolean {
    return this.recording
  }
}
