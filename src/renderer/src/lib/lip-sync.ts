/**
 * Lip-sync controller for VTuber model.
 * Bridges audio output (Web Audio API AnalyserNode) or procedural speech signals
 * to Live2D mouth opening parameters.
 */
import { api } from './api'

export class LipSyncController {
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private sourceNode: MediaElementAudioSourceNode | null = null
  private freqData: Uint8Array | null = null
  private animFrameId: number | null = null
  private onMouthOpen: (value: number) => void
  private isSpeaking = false
  private proceduralInterval: any = null
  private targetMouth = 0
  private currentMouth = 0
  private cleanupSpeakingListener: (() => void) | null = null

  constructor(onMouthOpen: (value: number) => void) {
    this.onMouthOpen = onMouthOpen
    this.initSpeakingListener()
  }

  private initSpeakingListener(): void {
    if (api?.tts?.onSpeakingState) {
      this.cleanupSpeakingListener = api.tts.onSpeakingState((state) => {
        this.setSpeaking(state.speaking)
      })
    }
  }

  /** Connect an HTMLAudioElement to Web Audio AnalyserNode for real-time FFT lip-sync. */
  connectAudioElement(audioElement: HTMLAudioElement): void {
    try {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!this.audioContext) {
        this.audioContext = new AudioContextClass()
      }
      if (this.audioContext.state === 'suspended') {
        void this.audioContext.resume()
      }

      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.smoothingTimeConstant = 0.4
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount)

      this.sourceNode = this.audioContext.createMediaElementSource(audioElement)
      this.sourceNode.connect(this.analyser)
      this.analyser.connect(this.audioContext.destination)

      this.startAnalysisLoop()
    } catch (err) {
      console.warn('[LipSync] Failed to connect audio element to AnalyserNode:', err)
    }
  }

  /** Set speaking state manually or via IPC */
  setSpeaking(speaking: boolean): void {
    this.isSpeaking = speaking
    if (speaking) {
      this.startProceduralFlap()
    } else {
      this.stopProceduralFlap()
    }
  }

  /** Start procedural mouth flapping when voice daemon speaks on hardware/external sink. */
  private startProceduralFlap(): void {
    if (this.proceduralInterval) return

    let phase = 0
    this.proceduralInterval = setInterval(() => {
      if (!this.isSpeaking) {
        this.targetMouth = 0
        return
      }
      phase += 0.35
      // Natural speech cadence combining high and low frequency oscillation
      const wave = Math.sin(phase) * 0.4 + Math.sin(phase * 2.3) * 0.3 + Math.random() * 0.3
      this.targetMouth = Math.max(0, Math.min(0.9, wave))
    }, 45)

    this.startSmoothingLoop()
  }

  private stopProceduralFlap(): void {
    if (this.proceduralInterval) {
      clearInterval(this.proceduralInterval)
      this.proceduralInterval = null
    }
    this.targetMouth = 0
  }

  private startSmoothingLoop(): void {
    if (this.animFrameId) return
    const step = (): void => {
      // Lerp current mouth toward target
      this.currentMouth += (this.targetMouth - this.currentMouth) * 0.35
      if (Math.abs(this.currentMouth) < 0.01 && this.targetMouth === 0) {
        this.currentMouth = 0
      }
      this.onMouthOpen(this.currentMouth)

      if (this.isSpeaking || this.currentMouth > 0.01) {
        this.animFrameId = requestAnimationFrame(step)
      } else {
        this.animFrameId = null
        this.onMouthOpen(0)
      }
    }
    this.animFrameId = requestAnimationFrame(step)
  }

  private startAnalysisLoop(): void {
    const analyze = (): void => {
      if (!this.analyser || !this.freqData) return

      this.analyser.getByteFrequencyData(this.freqData as any)
      // Focus on voice formant frequencies (bins 2 through 32)
      let sum = 0
      const start = 2
      const end = Math.min(32, this.freqData.length)
      for (let i = start; i < end; i++) {
        sum += this.freqData[i]
      }
      const avg = sum / (end - start)
      // Normalize and boost
      const raw = avg / 180
      this.targetMouth = Math.min(1.0, raw * 1.5)

      this.currentMouth += (this.targetMouth - this.currentMouth) * 0.4
      this.onMouthOpen(this.currentMouth)

      requestAnimationFrame(analyze)
    }
    requestAnimationFrame(analyze)
  }

  destroy(): void {
    this.stopProceduralFlap()
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId)
      this.animFrameId = null
    }
    if (this.cleanupSpeakingListener) {
      this.cleanupSpeakingListener()
      this.cleanupSpeakingListener = null
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        void this.audioContext.close()
      } catch {
        // ignore
      }
    }
  }
}
