import { api } from './api'

let currentAudio: HTMLAudioElement | null = null
let currentAudioId: string | null = null
let initialized = false

export function initTtsPlayer(): void {
  if (initialized || !api?.tts?.onPlayAudio) return
  initialized = true

  api.tts.onPlayAudio(({ id, audioBase64, format }) => {
    stopCurrentAudio()

    try {
      const mime = format || 'audio/mp3'
      const audio = new Audio(`data:${mime};base64,${audioBase64}`)
      currentAudio = audio
      currentAudioId = id

      let readyReported = false
      const reportReady = (): void => {
        if (!readyReported && currentAudioId === id) {
          readyReported = true
          const duration =
            Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 1
          void api.tts.notifyAudioReady(id, duration)
        }
      }

      audio.onloadedmetadata = () => reportReady()
      audio.oncanplay = () => reportReady()

      audio.onended = () => {
        if (currentAudioId === id) {
          currentAudio = null
          currentAudioId = null
        }
        void api.tts.notifyAudioEnded(id)
      }

      audio.onerror = (e) => {
        console.warn('[TTS Player] Audio playback error:', e)
        reportReady()
        if (currentAudioId === id) {
          currentAudio = null
          currentAudioId = null
        }
        void api.tts.notifyAudioEnded(id)
      }

      const playPromise = audio.play()
      if (playPromise) {
        playPromise.catch((err) => {
          console.warn('[TTS Player] audio.play() failed:', err)
          reportReady()
          if (currentAudioId === id) {
            currentAudio = null
            currentAudioId = null
          }
          void api.tts.notifyAudioEnded(id)
        })
      }
    } catch (err) {
      console.warn('[TTS Player] Failed to create audio:', err)
      void api.tts.notifyAudioReady(id, 1)
      void api.tts.notifyAudioEnded(id)
    }
  })

  api.tts.onStopAudio(() => {
    stopCurrentAudio()
  })
}

export function stopCurrentAudio(): void {
  if (currentAudio) {
    try {
      currentAudio.pause()
      currentAudio.src = ''
    } catch {
      // ignore
    }
    currentAudio = null
    currentAudioId = null
  }
}
