/**
 * Hands-free VTuber conversation on the local streaming voice engine.
 * Main detects each spoken utterance and transcribes it; this loop snapshots the
 * webcam when vision is active and submits the text to the active chat. The
 * microphone is released while Roxy thinks or speaks, so she never hears herself.
 */
import type { VoiceEvent } from '@shared/voice'
import { api } from './api'
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
  private running = false
  private pausedForAvatar = false
  private state: VadState = 'idle'
  private onStateChange: (state: VadState) => void
  /** Current listener registration; null while paused or stopped. */
  private listenerId: string | null = null
  private cleanupVoiceListener: (() => void) | null = null
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
          this.resume()
        }
      }, 60000)
    }
    this.state = state
    this.onStateChange(state)
  }

  getState(): VadState {
    return this.state
  }

  /** Roxy is thinking or speaking: give the microphone back until she is done. */
  private pause(state: VadState): void {
    this.pausedForAvatar = true
    this.unlisten()
    this.setState(state)
  }

  private resume(): void {
    this.pausedForAvatar = false
    if (this.running) {
      void this.listen()
      this.setState('listening')
    } else {
      this.setState('idle')
    }
  }

  private initListeners(): void {
    if (api?.voice?.onEvent && !this.cleanupVoiceListener) {
      this.cleanupVoiceListener = api.voice.onEvent((event) => this.onVoiceEvent(event))
    }

    if (api?.chats?.onTurnState && !this.cleanupTurnListener) {
      this.cleanupTurnListener = api.chats.onTurnState(({ state }) => {
        if (state === 'thinking') this.pause('thinking')
        else if (state === 'speaking') this.pause('speaking_avatar')
        else if (state === 'idle') this.resume()
      })
    }

    if (api?.tts?.onSpeakingState && !this.cleanupSpeakingListener) {
      this.cleanupSpeakingListener = api.tts.onSpeakingState((status) => {
        if (status.speaking) this.pause('speaking_avatar')
        else if (this.state === 'speaking_avatar') this.pause('thinking')
      })
    }
  }

  private onVoiceEvent(event: VoiceEvent): void {
    if (!this.listenerId) return
    if (event.type === 'listener' && event.listenerId === this.listenerId) {
      if (event.phase === 'stopped') {
        // The microphone or engine failed; the toggle stays on but we stop listening.
        console.warn('[VAD] Voice listener stopped:', event.error)
        this.listenerId = null
        this.running = false
        this.setState('idle')
      } else if (!this.pausedForAvatar) {
        this.setState(
          event.phase === 'speech'
            ? 'speaking_user'
            : event.phase === 'processing'
              ? 'transcribing'
              : 'listening'
        )
      }
      return
    }
    if (event.type === 'utterance' && event.listenerId === this.listenerId) {
      void this.submit(event.text.trim())
    }
  }

  private async listen(): Promise<boolean> {
    if (this.listenerId) return true
    const id = crypto.randomUUID()
    this.listenerId = id
    try {
      const result = await api.voice.listen(id)
      if (result.ok) return true
      console.warn('[VAD] Voice listening unavailable:', result.error)
    } catch (err) {
      console.warn('[VAD] Voice listening failed:', err)
    }
    if (this.listenerId === id) this.listenerId = null
    return false
  }

  private unlisten(): void {
    const id = this.listenerId
    this.listenerId = null
    if (id) void api.voice.unlisten(id).catch(() => undefined)
  }

  async start(): Promise<boolean> {
    if (this.running) return true
    this.initListeners()
    this.running = true
    this.pausedForAvatar = false
    if (!(await this.listen())) {
      this.running = false
      this.setState('idle')
      return false
    }
    this.setState('listening')
    return true
  }

  private async submit(text: string): Promise<void> {
    if (!this.running || this.pausedForAvatar || text.length < 2) return
    this.pause('thinking')
    try {
      // If vision auto-capture is enabled, snapshot the camera frame
      const images: ComposerImage[] = []
      if (useRoxyStore.getState().settings?.vtuberVisionEnabled) {
        const frame = cameraManager.captureFrame()
        if (frame) images.push(frame)
      }
      const forwarded = await api.chats.submitPrompt(text, images.length > 0 ? images : undefined)
      if (!forwarded) {
        const store = useRoxyStore.getState()
        if (store.activeChatId) {
          await store.submit(text, images.length > 0 ? images : undefined)
        } else {
          this.resume()
        }
      }
    } catch (err) {
      console.warn('[VAD] Speech processing error:', err)
      this.resume()
    }
  }

  stop(): void {
    this.running = false
    this.pausedForAvatar = false
    this.clearThinkingTimeout()
    this.unlisten()
    this.setState('idle')
  }

  destroy(): void {
    this.stop()
    this.cleanupVoiceListener?.()
    this.cleanupVoiceListener = null
    this.cleanupSpeakingListener?.()
    this.cleanupSpeakingListener = null
    this.cleanupTurnListener?.()
    this.cleanupTurnListener = null
  }
}
