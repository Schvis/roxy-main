import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  ChevronDown,
  Loader2,
  Mic,
  MicOff,
  Monitor,
  Plus,
  Square,
  Terminal,
  X,
  Zap
} from 'lucide-react'
import { ModelPicker } from './ModelPicker'
import {
  ContextMeter,
  ContextPicker,
  ThinkingPicker,
  AgentPicker,
  PromptPicker
} from './InferenceControls'
import { imageFilesFrom, readImageFile, type ComposerImage } from '../lib/images'
import { api } from '../lib/api'
import { ImagePreview } from './ImagePreview'
import { AudioRecorder } from '../lib/audio-recorder'
import { WakeWordListener, matchWakeWord } from '../lib/wake-word'
import { useRoxyStore } from '../lib/store'
import { matchesKeybindDown, matchesKeybindRelease } from '../lib/keybind'
import { cn } from '../lib/cn'
import { useMenuAnchor } from '../lib/useMenuAnchor'

export function Composer({
  onSend,
  sending,
  onStop,
  onOpenCommands
}: {
  onSend: (text: string, images?: ComposerImage[], force?: boolean) => void
  sending?: boolean
  onStop?: () => void
  onOpenCommands?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const voiceKeybind = useRoxyStore((s) => s.settings?.voiceKeybind ?? 'Alt+V')
  const voiceAutoSend = useRoxyStore((s) => s.settings?.voiceAutoSend ?? false)
  const voiceLang = useRoxyStore((s) => s.settings?.voiceLang ?? 'auto')
  const voiceWakeWord = useRoxyStore((s) => s.settings?.voiceWakeWord ?? false)
  const [value, setValue] = useState('')
  const [images, setImages] = useState<ComposerImage[]>([])
  const [dragging, setDragging] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef<AudioRecorder | null>(null)
  const wakeWordListenerRef = useRef<WakeWordListener | null>(null)
  const isHoldingKeyRef = useRef(false)
  const isRecordingRef = useRef(false)
  const isTranscribingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const overflowMenuRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowAnchor = useMenuAnchor(overflowMenuRef, overflowOpen, 240, { gap: 8 })

  isRecordingRef.current = isRecording
  isTranscribingRef.current = isTranscribing

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width)
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const isCompact = containerWidth < 660

  useEffect(() => {
    if (!isCompact) setOverflowOpen(false)
  }, [isCompact])

  useEffect(() => {
    if (!overflowOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!overflowMenuRef.current?.contains(e.target as Node)) {
        setOverflowOpen(false)
      }
    }
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setOverflowOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [overflowOpen])

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel()
    }
  }, [])

  const addFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    const read = await Promise.all(files.map(readImageFile))
    const valid = read.filter((x): x is ComposerImage => x !== null)
    if (valid.length) setImages((prev) => [...prev, ...valid])
  }

  const removeImage = (id: string): void => setImages((prev) => prev.filter((i) => i.id !== id))

  const submit = (force = false): void => {
    const text = value.trim()
    if (!text && images.length === 0) return
    onSend(text, images.length ? images : undefined, force)
    setValue('')
    setImages([])
    if (ref.current) ref.current.style.height = 'auto'
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (isRecording || isTranscribing || isHoldingKeyRef.current) {
      if (event.key === 'Escape' && isRecording) {
        event.preventDefault()
        isHoldingKeyRef.current = false
        recorderRef.current?.cancel()
        setIsRecording(false)
      }
      event.preventDefault()
      return
    }

    // Escape stops the turn. The button alone was not enough: it hides as soon
    // as you type (the composer switches to "add to queue"), so drafting a
    // follow-up while a turn ran left no visible way to stop it — you had to
    // clear the box first to get the button back. The draft is preserved.
    if (event.key === 'Escape' && sending && onStop) {
      event.preventDefault()
      onStop()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      const isForce = event.ctrlKey || event.metaKey || event.altKey
      submit(isForce)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (isRecording || isTranscribing || isHoldingKeyRef.current) {
      event.preventDefault()
      return
    }
    const files = imageFilesFrom(event.clipboardData)
    if (files.length > 0) {
      event.preventDefault()
      void addFiles(files)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    const files = imageFilesFrom(event.dataTransfer)
    setDragging(false)
    if (files.length > 0) {
      event.preventDefault()
      void addFiles(files)
    }
  }

  const autoGrow = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`
  }

  const startRecording = async (): Promise<void> => {
    if (isRecordingRef.current || isTranscribingRef.current) return
    try {
      wakeWordListenerRef.current?.pause()
      if (!recorderRef.current) {
        recorderRef.current = new AudioRecorder()
      }
      await recorderRef.current.start({
        silenceDetection: true,
        silenceDurationMs: 1800,
        onSilence: () => {
          if (!isHoldingKeyRef.current && isRecordingRef.current) {
            void stopRecordingAndTranscribe()
          }
        }
      })
      setIsRecording(true)
      ref.current?.focus()
    } catch (err) {
      console.error('[STT] Microphone access error:', err)
      setIsRecording(false)
      wakeWordListenerRef.current?.resume()
    }
  }

  const stopRecordingAndTranscribe = async (): Promise<void> => {
    if (!isRecordingRef.current || isTranscribingRef.current) return
    setIsRecording(false)
    setIsTranscribing(true)
    try {
      const audioBuffer = await recorderRef.current?.stop()
      if (audioBuffer) {
        const currentSettings = useRoxyStore.getState().settings
        const effectiveLang = currentSettings?.voiceLang ?? voiceLang
        const shouldAutoSend = currentSettings?.voiceAutoSend ?? voiceAutoSend
        const langParam = effectiveLang && effectiveLang !== 'auto' ? effectiveLang : undefined
        const res = await api.stt.transcribe(audioBuffer, {
          language: langParam,
          task: 'transcribe'
        })
        if (res?.text) {
          const transcribed = res.text.trim()
          if (transcribed) {
            if (shouldAutoSend) {
              const currentVal = ref.current?.value.trimEnd() ?? value.trimEnd()
              const fullText = currentVal ? `${currentVal} ${transcribed}` : transcribed
              onSend(fullText, images.length ? images : undefined)
              setValue('')
              setImages([])
              if (ref.current) ref.current.style.height = 'auto'
            } else {
              setValue((prev) => {
                const trimmed = prev.trimEnd()
                const updated = trimmed ? `${trimmed} ${transcribed}` : transcribed
                setTimeout(autoGrow, 0)
                return updated
              })
              ref.current?.focus()
            }
          }
        }
      }
    } catch (err) {
      console.error('[STT] Transcription error:', err)
    } finally {
      setIsTranscribing(false)
      wakeWordListenerRef.current?.resume()
    }
  }

  const toggleRecording = async (): Promise<void> => {
    if (isRecording) {
      await stopRecordingAndTranscribe()
    } else {
      await startRecording()
    }
  }

  useEffect(() => {
    void api.stt.setRecordingState(isRecording)
  }, [isRecording])

  useEffect(() => {
    const unsubStart = api.stt.onStartRecording(() => {
      if (!isRecordingRef.current && !isTranscribingRef.current) {
        void startRecording()
      }
    })
    const unsubStop = api.stt.onStopRecording(() => {
      if (isRecordingRef.current) {
        void stopRecordingAndTranscribe()
      }
    })
    return () => {
      unsubStart()
      unsubStop()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent): void => {
      const currentKeybind = useRoxyStore.getState().settings?.voiceKeybind ?? voiceKeybind
      if (!currentKeybind) return

      if (isHoldingKeyRef.current) {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      if (matchesKeybindDown(e, currentKeybind)) {
        e.preventDefault()
        e.stopPropagation()
        if (!isRecordingRef.current && !isTranscribingRef.current) {
          isHoldingKeyRef.current = true
          void startRecording()
        }
      }
    }

    const handleKeyUp = (e: globalThis.KeyboardEvent): void => {
      const currentKeybind = useRoxyStore.getState().settings?.voiceKeybind ?? voiceKeybind
      if (!currentKeybind) return

      if (isHoldingKeyRef.current && matchesKeybindRelease(e, currentKeybind)) {
        e.preventDefault()
        e.stopPropagation()
        isHoldingKeyRef.current = false
        if (isRecordingRef.current) {
          void stopRecordingAndTranscribe()
        }
      }
    }

    const handleBlur = (): void => {
      if (isHoldingKeyRef.current) {
        isHoldingKeyRef.current = false
        if (isRecordingRef.current) {
          void stopRecordingAndTranscribe()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [voiceKeybind])

  useEffect(() => {
    if (!voiceWakeWord) {
      wakeWordListenerRef.current?.stop()
      wakeWordListenerRef.current = null
      return
    }

    const listener = new WakeWordListener()
    wakeWordListenerRef.current = listener

    void listener.start((initialQuery) => {
      const cleanQuery = initialQuery?.trim().replace(/^[,.?!:\s]+/, '')
      const isOnlyWakeWord =
        !cleanQuery ||
        Boolean(
          matchWakeWord(cleanQuery, useRoxyStore.getState().settings?.voiceWakeWords).matched &&
          !matchWakeWord(cleanQuery, useRoxyStore.getState().settings?.voiceWakeWords).query
        )

      if (!isOnlyWakeWord && cleanQuery) {
        const currentSettings = useRoxyStore.getState().settings
        const shouldAutoSend = currentSettings?.voiceAutoSend ?? voiceAutoSend
        if (shouldAutoSend) {
          const currentVal = ref.current?.value.trimEnd() ?? value.trimEnd()
          const fullText = currentVal ? `${currentVal} ${cleanQuery}` : cleanQuery
          onSend(fullText, images.length ? images : undefined)
          setValue('')
          setImages([])
          if (ref.current) ref.current.style.height = 'auto'
        } else {
          setValue((prev) => {
            const trimmed = prev.trimEnd()
            const updated = trimmed ? `${trimmed} ${cleanQuery}` : cleanQuery
            setTimeout(autoGrow, 0)
            return updated
          })
          ref.current?.focus()
        }
      } else {
        void startRecording()
      }
    })

    return () => {
      listener.stop()
      if (wakeWordListenerRef.current === listener) {
        wakeWordListenerRef.current = null
      }
    }
  }, [voiceWakeWord])

  // Stop needs a handler to be honest: a session can be busy with a turn this
  // composer doesn't own (a subagent's run is driven by its parent), and a Stop
  // button that does nothing is worse than none. Fall through to a disabled Send.
  const showStop = !!sending && !!onStop && !value.trim() && images.length === 0
  const canSend = !!value.trim() || images.length > 0

  return (
    <div className="w-full min-w-0 bg-bg px-4 pb-1.5 pt-2">
      <div
        ref={containerRef}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false)
        }}
        onDrop={onDrop}
        // `sq-frame`, not `sq`: the controls row below renders five popovers
        // (model, mode, effort, context, usage) that open UPWARD, well outside
        // this box. `.sq` masks, and a mask clips descendants, so it would erase
        // all five. `sq-frame` paints the fill instead of clipping.
        //
        // `sq-ring` repaints the border inside the squircle, so the color has to
        // travel as `--sq-ring` alongside each `border-*`. The drag ring is an
        // inset one so it follows the curve rather than boxing the corners.
        //
        // `edge` gives it the translucent, top-lit border, and `shadow-raised`
        // -- not `float` -- because the composer is anchored to the bottom of
        // the pane, not hovering over it. A float-weight shadow on a full-width
        // element that never moves reads as a permanent dark band under the box
        // rather than as depth. The edge already separates it from the
        // conversation; the shadow only has to sit it down.
        //
        // On focus the hairline brightens rather than changing hue: the box is
        // already the focus of the screen, so a colored ring on it is noise.
        className={`mx-auto w-full max-w-3xl min-w-0 sq-frame sq-2xl sq-ring sq-fill-surface-2 edge edge-panel shadow-raised rounded-2xl border bg-surface-2 transition ${
          dragging
            ? 'border-accent [--sq-ring:var(--color-accent)] inset-ring-1 inset-ring-accent/40'
            : 'border-border focus-within:border-border-strong focus-within:[--sq-ring:var(--edge-strong)]'
        }`}
      >
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {images.map((img) => (
              <ImagePreview
                key={img.id}
                src={img.dataUrl}
                name={img.name}
                className="group relative h-16 w-16 overflow-hidden sq sq-lg sq-ring rounded-lg border border-border bg-surface"
              >
                <img
                  src={img.dataUrl}
                  alt={img.name}
                  className="h-full w-full cursor-zoom-in object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeImage(img.id)}
                  title={t('composer.removeImage')}
                  className="press-scale absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </ImagePreview>
            ))}
          </div>
        )}

        <textarea
          ref={ref}
          value={value}
          rows={1}
          readOnly={isRecording || isTranscribing || isHoldingKeyRef.current}
          placeholder={
            isRecording
              ? t('composer.listening')
              : isTranscribing
                ? t('composer.transcribing')
                : sending
                  ? onStop
                    ? t('composer.queuePlaceholderStop')
                    : t('composer.queuePlaceholder')
                  : t('composer.placeholder')
          }
          onChange={(e) => {
            if (isRecording || isTranscribing || isHoldingKeyRef.current) return
            setValue(e.target.value)
            autoGrow()
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="block max-h-44 w-full min-w-0 resize-none bg-transparent px-4 pt-3 text-sm text-text outline-none placeholder:text-text-subtle"
        />

        <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1.5 min-w-0">
          {/* Chrome-less controls, matching the workstream strip below. Two
              things do the work the borders used to: gap-1 (further apart and
              five bare labels just scatter across the row) and px-1.5 on every
              control, which against the row's px-2.5 puts each label's first
              glyph exactly on the textarea's px-4 text column. */}
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title={t('composer.attachImages')}
              className="press-scale flex h-6 shrink-0 items-center justify-center sq sq-md rounded-md px-1.5 text-text-muted hover:bg-white/5 hover:text-text"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {!isCompact && (
              <button
                type="button"
                onClick={async () => {
                  const screen = await api.captureScreen()
                  if (screen) {
                    const res = await fetch(screen.dataUrl)
                    const blob = await res.blob()
                    const file = new File([blob], screen.name, { type: blob.type })
                    void addFiles([file])
                  }
                }}
                title={t('composer.readScreen')}
                className="press-scale flex h-6 shrink-0 items-center justify-center sq sq-md rounded-md px-1.5 text-text-muted hover:bg-white/5 hover:text-text"
              >
                <Monitor className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void toggleRecording()}
              disabled={isTranscribing}
              title={
                isTranscribing
                  ? t('composer.transcribing')
                  : isRecording
                    ? t('composer.stopRecording')
                    : `${t('composer.voiceInput')} (${voiceKeybind})`
              }
              className={`press-scale flex h-6 shrink-0 items-center justify-center sq sq-md rounded-md px-1.5 transition-colors ${
                isRecording
                  ? 'bg-red-500/20 text-red-400 animate-pulse'
                  : isTranscribing
                    ? 'text-accent'
                    : 'text-text-muted hover:bg-white/5 hover:text-text'
              }`}
            >
              {isTranscribing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isRecording ? (
                <MicOff className="h-3.5 w-3.5 text-red-400" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
            </button>
            <ModelPicker />
            {isCompact ? (
              <div ref={overflowMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setOverflowOpen((o) => !o)}
                  title={overflowOpen ? t('composer.showLess') : t('composer.showMore')}
                  aria-label={overflowOpen ? t('composer.showLess') : t('composer.showMore')}
                  aria-expanded={overflowOpen}
                  className={cn(
                    'press-scale flex h-6 shrink-0 items-center justify-center sq sq-md rounded-md px-1.5 text-text-muted transition-colors hover:bg-white/5 hover:text-text',
                    overflowOpen && 'bg-white/10 text-text'
                  )}
                >
                  <ChevronDown
                    className={cn(
                      'h-3.5 w-3.5 transition-transform duration-200',
                      overflowOpen && 'rotate-180'
                    )}
                  />
                </button>

                {overflowOpen && (
                  <div
                    className="animate-pop-in absolute bottom-full z-50 mb-2 flex flex-col sq-frame sq-xl sq-fill-elevated sq-ring edge edge-strong edge-panel rounded-xl border border-border bg-elevated shadow-float origin-bottom-left p-1.5"
                    style={overflowAnchor}
                  >
                    <button
                      type="button"
                      onClick={async () => {
                        setOverflowOpen(false)
                        const screen = await api.captureScreen()
                        if (screen) {
                          const res = await fetch(screen.dataUrl)
                          const blob = await res.blob()
                          const file = new File([blob], screen.name, { type: blob.type })
                          void addFiles([file])
                        }
                      }}
                      className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-muted hover:bg-white/5 hover:text-text transition-colors text-left"
                    >
                      <Monitor className="h-3.5 w-3.5 shrink-0" />
                      <span>{t('composer.readScreen')}</span>
                    </button>

                    {onOpenCommands && (
                      <button
                        type="button"
                        onClick={() => {
                          setOverflowOpen(false)
                          onOpenCommands()
                        }}
                        className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-muted hover:bg-white/5 hover:text-text transition-colors text-left"
                      >
                        <Terminal className="h-3.5 w-3.5 shrink-0" />
                        <span>{t('commands.commandLine')}</span>
                      </button>
                    )}

                    <div className="my-1 border-t border-border/40" />

                    <div className="flex flex-wrap items-center gap-1 p-0.5">
                      <AgentPicker />
                      <PromptPicker />
                      <ThinkingPicker />
                      <ContextPicker />
                      <ContextMeter />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <AgentPicker />
                <PromptPicker />
                <ThinkingPicker />
                <ContextPicker />
                <ContextMeter />
                {onOpenCommands && (
                  <button
                    type="button"
                    onClick={onOpenCommands}
                    title={t('commands.commandLine')}
                    className="press-scale flex h-6 shrink-0 items-center justify-center sq sq-md rounded-md px-1.5 text-text-muted hover:bg-white/5 hover:text-text transition-colors"
                  >
                    <Terminal className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
          {showStop ? (
            <button
              onClick={onStop}
              title={t('composer.stop')}
              className="press-scale flex h-8 w-8 shrink-0 items-center justify-center sq sq-lg rounded-lg bg-white text-black hover:bg-white/90"
            >
              <Square className="h-3 w-3 fill-current" />
            </button>
          ) : sending ? (
            <div className="flex items-center gap-1.5 shrink-0">
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  title={t('composer.stop')}
                  className="press-scale flex h-8 w-8 shrink-0 items-center justify-center sq sq-lg rounded-lg border border-border bg-surface text-text-muted hover:bg-white/5 hover:text-text"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              )}
              <button
                type="button"
                onClick={() => submit(false)}
                disabled={!canSend}
                title={t('composer.addToQueue')}
                className={cn(
                  'press-scale flex h-8 shrink-0 items-center justify-center sq sq-lg rounded-lg border border-border bg-surface text-text-muted hover:bg-white/5 hover:text-text disabled:opacity-30',
                  isCompact ? 'w-8' : 'gap-1.5 px-2.5 text-xs font-medium'
                )}
              >
                <ArrowUp className="h-3.5 w-3.5" />
                {!isCompact && <span>{t('composer.queue')}</span>}
              </button>
              <button
                type="button"
                onClick={() => submit(true)}
                disabled={!canSend}
                title={t('composer.forceSend')}
                className={cn(
                  'press-scale flex h-8 shrink-0 items-center justify-center sq sq-lg rounded-lg bg-white text-black hover:bg-white/90 disabled:opacity-30',
                  isCompact ? 'w-8' : 'gap-1.5 px-2.5 text-xs font-medium'
                )}
              >
                <Zap className="h-3.5 w-3.5 fill-current" />
                {!isCompact && <span>{t('composer.force')}</span>}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => submit(false)}
              disabled={!canSend}
              title={t('composer.send')}
              className="press-scale flex h-8 w-8 shrink-0 items-center justify-center sq sq-lg rounded-lg bg-white text-black hover:bg-white/90 disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
    </div>
  )
}
