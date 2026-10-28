/**
 * Fork additions to upstream's composer dictation (see docs/voice-hands-free.md):
 * the overlay route, auto-send, hold-to-talk and the wake word. Wraps upstream's
 * `useVoiceComposer` through its `extension` parameter, so lib/voice.ts stays as
 * upstream ships it apart from a few hook lines.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import type { VoiceError, VoiceStartOptions } from '@shared/voice'
import { matchWakeWord } from '@shared/voice-handsfree'
import { api } from './api'
import { useRoxyStore } from './store'
import { updateComposerDraft } from './composerDrafts'
import { matchesKeybindDown, matchesKeybindRelease } from './keybind'
import { useVoiceComposer, useVoiceState } from './voice'

/** What the fork plugs into upstream's `useVoiceComposer`. */
export interface VoiceComposerExtension {
  /** Routes where a composer may take dictation. */
  routes: readonly string[]
  /** Options for the dictation about to start. */
  startOptions(): VoiceStartOptions
  /** A dictation this composer owned has stopped, with the text it wrote. */
  onStopped(text: string, error?: VoiceError): void
}

/** The main window and the overlay. */
const VOICE_ROUTES = ['/', '/overlay']

/**
 * Upstream's composer dictation plus hold-to-talk, auto-send and wake word.
 * `onSend` submits the composer draft (auto-send and wake phrases with a request).
 */
export function useVoiceHandsFree(
  chatId: string,
  textarea: RefObject<HTMLTextAreaElement>,
  onSend: () => void
): ReturnType<typeof useVoiceComposer> & {
  /** Hold-to-talk is down: the draft is voice-owned until release. */
  holding: boolean
} {
  const state = useVoiceState()
  const { pathname } = useLocation()
  const settings = useRef(state?.settings)
  settings.current = state?.settings
  const send = useRef(onSend)
  send.current = onSend
  /** Auto-stop for the next start; null means the auto-send default. */
  const nextAutoStop = useRef<boolean | null>(null)
  const [holding, setHolding] = useState(false)
  const holdingRef = useRef(false)
  const release = (): void => {
    holdingRef.current = false
    setHolding(false)
  }
  // Stable: upstream reads it from effects that only re-run per chat.
  const extension = useRef<VoiceComposerExtension>({
    routes: VOICE_ROUTES,
    // With auto-send, a pause ends the dictation, as there is no second click to wait for.
    startOptions: () => ({
      autoStop: nextAutoStop.current ?? settings.current?.autoSend === true
    }),
    onStopped: (text, error) => {
      release()
      // Let the final transcript render into the draft before sending it.
      if (!error && settings.current?.autoSend && text.trim()) setTimeout(() => send.current(), 0)
    }
  }).current
  const voice = useVoiceComposer(chatId, textarea, undefined, extension)
  const latest = useRef(voice)
  latest.current = voice

  /** Start dictating with an explicit auto-stop choice (hold-to-talk, wake word). */
  const start = (autoStop: boolean): void => {
    if (latest.current.phase !== 'idle') return
    nextAutoStop.current = autoStop
    latest.current.toggle()
    nextAutoStop.current = null
  }
  /** This composer is the one on screen for the active chat. */
  const visible = (): boolean => {
    const element = textarea.current
    return (
      VOICE_ROUTES.includes(pathname) &&
      useRoxyStore.getState().activeChatId === chatId &&
      !!element?.getClientRects().length &&
      getComputedStyle(element).visibility !== 'hidden'
    )
  }

  // Hold-to-talk: in-window only, so the release is always seen.
  const holdKey = state?.settings.enabled ? state.settings.holdKey : ''
  useEffect(() => {
    if (!holdKey) return
    const down = (event: KeyboardEvent): void => {
      if (holdingRef.current) {
        if (event.repeat) event.preventDefault()
        return
      }
      if (!matchesKeybindDown(event, holdKey) || latest.current.phase !== 'idle' || !visible())
        return
      event.preventDefault()
      event.stopPropagation()
      holdingRef.current = true
      setHolding(true)
      start(false)
    }
    // Released before the microphone opened cancels; otherwise it finishes.
    const finish = (): void => {
      release()
      if (latest.current.phase !== 'idle') latest.current.toggle()
    }
    const up = (event: KeyboardEvent): void => {
      if (!holdingRef.current || !matchesKeybindRelease(event, holdKey)) return
      event.preventDefault()
      event.stopPropagation()
      finish()
    }
    const blur = (): void => {
      if (holdingRef.current) finish()
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [holdKey, chatId, pathname])

  // Wake word: main window only, while this composer is the one on screen.
  const ready =
    !!state?.supported &&
    !!state.settings.enabled &&
    !!state.settings.modelId &&
    state.installed.includes(state.settings.modelId)
  const active = useRoxyStore((s) => s.activeChatId === chatId)
  const [wakeError, setWakeError] = useState<VoiceError | null>(null)
  const wakeOn = ready && !!state?.settings.wakeWord && pathname === '/' && active
  useEffect(() => {
    setWakeError(null)
    if (!wakeOn) return
    const id = crypto.randomUUID()
    const off = api.voice.onEvent((event) => {
      if (event.type === 'listener' && event.listenerId === id && event.phase === 'stopped') {
        if (event.error) setWakeError(event.error)
        return
      }
      if (event.type !== 'utterance' || event.listenerId !== id) return
      if (latest.current.phase !== 'idle') return
      const wake = matchWakeWord(event.text, settings.current?.wakeWords)
      if (!wake.matched || !visible()) return
      if (!wake.query) {
        // Only the phrase: dictate the request, ending on the next pause.
        start(true)
        return
      }
      useRoxyStore.setState((store) => ({
        composerDrafts: updateComposerDraft(store.composerDrafts, store.chats, chatId, (draft) => {
          const prefix = draft.value.trimEnd()
          return { ...draft, value: prefix ? `${prefix} ${wake.query}` : wake.query }
        })
      }))
      if (settings.current?.autoSend) setTimeout(() => send.current(), 0)
      else textarea.current?.focus()
    })
    void api.voice
      .listen(id)
      .then((result) => {
        if (!result.ok) setWakeError(result.error)
      })
      .catch(() => undefined)
    return () => {
      off()
      void api.voice.unlisten(id).catch(() => undefined)
    }
  }, [wakeOn, chatId])

  return {
    ...voice,
    error: voice.error ?? wakeError,
    holding,
    interrupt: () => {
      release()
      voice.interrupt()
    }
  }
}
