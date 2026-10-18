import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useLocation } from 'react-router-dom'
import { matchWakeWord, mergeVoiceDraft, type VoiceError, type VoiceState } from '@shared/voice'
import { api } from './api'
import { useRoxyStore } from './store'
import { updateComposerDraft } from './composerDrafts'
import { matchesKeybindDown, matchesKeybindRelease } from './keybind'

export function useVoiceState(): VoiceState | null {
  const [state, setState] = useState<VoiceState | null>(null)
  useEffect(() => {
    if (!api.voice) return
    let live = true
    let revision = 0
    const refresh = (): void => {
      const current = revision
      void api.voice
        .state()
        .then((next) => {
          if (live && current === revision) setState(next)
        })
        .catch(() => undefined)
    }
    const off = api.voice.onEvent((event) => {
      if (event.type === 'state') {
        revision++
        setState(event.state)
      }
    })
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      live = false
      off()
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return state
}

/** Routes where a composer may take dictation: the main window and the overlay. */
const VOICE_ROUTES = ['/', '/overlay']

export function useVoiceComposer(
  chatId: string,
  textarea: RefObject<HTMLTextAreaElement>,
  onSend: () => void
): {
  enabled: boolean
  phase: 'idle' | 'starting' | 'recording' | 'stopping'
  slowPhase: 'starting' | 'stopping' | null
  error: VoiceError | null
  fallback: boolean
  /** Hold-to-talk is down: the draft is voice-owned until release. */
  holding: boolean
  toggle: () => void
  interrupt: () => void
} {
  const state = useVoiceState()
  const { pathname } = useLocation()
  const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'stopping'>('idle')
  const [slowPhase, setSlowPhase] = useState<'starting' | 'stopping' | null>(null)
  useEffect(() => {
    setSlowPhase(null)
    if (phase !== 'starting' && phase !== 'stopping') return
    const timer = setTimeout(() => setSlowPhase(phase), 2000)
    return () => clearTimeout(timer)
  }, [phase])
  const [error, setError] = useState<VoiceError | null>(null)
  const [fallback, setFallback] = useState(false)
  const [holding, setHolding] = useState(false)
  const owned = useRef<{ id: string; start: number; text: string; sequence: number } | null>(null)
  const latest = useRef({ toggle: (): void => {}, start: (_autoStop: boolean): void => {} })
  const send = useRef(onSend)
  send.current = onSend
  const settings = useRef(state?.settings)
  settings.current = state?.settings
  const holdingRef = useRef(false)
  const interrupt = (): void => {
    const recording = owned.current
    owned.current = null
    holdingRef.current = false
    setHolding(false)
    if (!recording) return
    setPhase('idle')
    void api.voice.stop(recording.id, false).catch(() => undefined)
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
  const finish = (): void => {
    const recording = owned.current
    if (!recording || phase === 'stopping') return
    setPhase('stopping')
    void api.voice.stop(recording.id, true).catch(() => {
      interrupt()
      setError('engineFailed')
    })
  }
  const start = (autoStop = false): void => {
    if (owned.current) return
    if (!state?.settings.enabled) return
    if (!state.supported) {
      setError('unsupported')
      return
    }
    if (!state.settings.modelId || !state.installed.includes(state.settings.modelId)) {
      setError('modelRequired')
      return
    }
    if (!visible() || !textarea.current) return
    const id = crypto.randomUUID()
    const value = useRoxyStore.getState().composerDrafts[chatId]?.value ?? ''
    owned.current = {
      id,
      start: textarea.current.selectionStart ?? value.length,
      text: '',
      sequence: 0
    }
    setError(null)
    setFallback(false)
    setPhase('starting')
    textarea.current.focus()
    void api.voice
      .start(id, chatId, { autoStop })
      .then((result) => {
        if (owned.current?.id !== id) return
        if (!result.ok) {
          interrupt()
          setError(result.error)
        }
      })
      .catch(() => {
        if (owned.current?.id === id) {
          interrupt()
          setError('unknown')
        }
      })
  }
  const toggle = (): void => {
    if (owned.current) {
      if (phase === 'starting') interrupt()
      else finish()
      return
    }
    // With auto-send, a pause ends the dictation, as there is no second click to wait for.
    start(state?.settings.autoSend === true)
  }
  latest.current = { toggle, start }
  const latestFinish = useRef(finish)
  latestFinish.current = () => {
    // Released before the microphone opened: nothing was said, cancel instead.
    if (phase === 'starting') interrupt()
    else finish()
  }
  useLayoutEffect(() => {
    if (!VOICE_ROUTES.includes(pathname)) interrupt()
  }, [pathname])
  useEffect(() => {
    if (!api.voice) return
    const off = api.voice.onEvent((event) => {
      if (event.type === 'toggle') {
        const element = textarea.current
        if (
          element &&
          getComputedStyle(element).visibility !== 'hidden' &&
          !document.querySelector('[role="dialog"], [aria-modal="true"]')
        )
          latest.current.toggle()
        return
      }
      const recording = owned.current
      if (!recording || !('recordingId' in event) || event.recordingId !== recording.id) return
      if (event.type === 'recording') {
        if (event.phase === 'stopped') {
          owned.current = null
          holdingRef.current = false
          setHolding(false)
          setPhase('idle')
          if (event.error) setError(event.error)
          else if (settings.current?.autoSend && recording.text.trim())
            // Let the final transcript render into the draft before sending it.
            setTimeout(() => send.current(), 0)
        } else {
          setPhase((current) => (current === 'stopping' ? current : 'recording'))
          setFallback(event.fallback ?? false)
        }
      } else if (event.type === 'transcript' && event.sequence > recording.sequence) {
        recording.sequence = event.sequence
        let conflict = false
        useRoxyStore.setState((store) => ({
          composerDrafts: updateComposerDraft(
            store.composerDrafts,
            store.chats,
            chatId,
            (draft) => {
              const merged = mergeVoiceDraft(draft.value, recording, event.text)
              if (!merged) {
                conflict = true
                return draft
              }
              recording.text = merged.text
              return { ...draft, value: merged.value }
            }
          )
        }))
        if (conflict) interrupt()
      }
    })
    return () => {
      off()
      interrupt()
    }
  }, [chatId])
  useEffect(() => {
    if (state && !state.settings.enabled) interrupt()
  }, [state?.settings.enabled])

  // Hold-to-talk: in-window only, so the release is always seen.
  const holdKey = state?.settings.enabled ? state.settings.holdKey : ''
  useEffect(() => {
    if (!holdKey) return
    const down = (event: KeyboardEvent): void => {
      if (holdingRef.current) {
        if (event.repeat) event.preventDefault()
        return
      }
      if (!matchesKeybindDown(event, holdKey) || owned.current || !visible()) return
      event.preventDefault()
      event.stopPropagation()
      holdingRef.current = true
      setHolding(true)
      latest.current.start(false)
    }
    const up = (event: KeyboardEvent): void => {
      if (!holdingRef.current || !matchesKeybindRelease(event, holdKey)) return
      event.preventDefault()
      event.stopPropagation()
      holdingRef.current = false
      setHolding(false)
      if (owned.current) latestFinish.current()
    }
    const blur = (): void => {
      if (!holdingRef.current) return
      holdingRef.current = false
      setHolding(false)
      if (owned.current) latestFinish.current()
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
  const wakeOn = ready && !!state?.settings.wakeWord && pathname === '/' && active
  useEffect(() => {
    if (!wakeOn) return
    const id = crypto.randomUUID()
    const off = api.voice.onEvent((event) => {
      if (event.type === 'listener' && event.listenerId === id && event.phase === 'stopped') {
        if (event.error) setError(event.error)
        return
      }
      if (event.type !== 'utterance' || event.listenerId !== id || owned.current) return
      const wake = matchWakeWord(event.text, settings.current?.wakeWords)
      if (!wake.matched || !visible()) return
      if (!wake.query) {
        // Only the phrase: dictate the request, ending on the next pause.
        latest.current.start(true)
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
        if (!result.ok) setError(result.error)
      })
      .catch(() => undefined)
    return () => {
      off()
      void api.voice.unlisten(id).catch(() => undefined)
    }
  }, [wakeOn, chatId])

  return {
    enabled: state?.settings.enabled ?? false,
    phase,
    slowPhase: slowPhase === phase ? slowPhase : null,
    error,
    fallback,
    holding,
    toggle,
    interrupt
  }
}
