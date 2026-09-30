import {
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileCode,
  Folder,
  Image as ImageIcon,
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
import { createContextAttachment } from '@shared/context'
import { loadActiveFile, normalizeRoot } from '../lib/ide-state'
import type { ChatContextAttachment } from '@shared/types'
import { resolveSessionConfig } from '@shared/session-config'

import { restoreComposerDraft, updateComposerDraft } from '../lib/composerDrafts'
import { BotAvatar } from './BotAvatar'
import roxy from '../assets/roxy.png'
import { HOST_USERNAME } from '@shared/bots'
import { MENTION, isKnownMention, mentionedBots } from '@shared/mentions'

const EMPTY_ATTACHMENTS: ChatContextAttachment[] = []

export function Composer({
  chatId,
  onSend,
  sending,
  onStop,
  variant = 'session',
  onOpenCommands
}: {
  chatId: string
  onSend: (text: string, images?: ComposerImage[], force?: boolean) => void | Promise<void>
  sending?: boolean
  onStop?: () => void
  onOpenCommands?: () => void
  /**
   * `'bot'` strips the controls that only mean something for a project session,
   * so a bot's window reads as a different kind of place at a glance:
   *
   * - Build/Plan is a *code* mode (Plan narrows tools to read-only over a repo).
   *   A bot has no workstream - it already hides the workstream strip below -
   *   so the choice would name something that does not exist here.
   * - Model and effort edit the bot chat's standing inference config, including
   *   scheduled runs. Context budget remains in Bot settings.
   *
   * The meter stays - it describes the conversation you are actually looking at.
   */
  variant?: 'session' | 'bot'
}): JSX.Element {
  const { t } = useTranslation()
  const voiceKeybind = useRoxyStore((s) => s.settings?.voiceKeybind ?? 'Alt+V')
  const voiceAutoSend = useRoxyStore((s) => s.settings?.voiceAutoSend ?? false)
  const voiceLang = useRoxyStore((s) => s.settings?.voiceLang ?? 'auto')
  const voiceWakeWord = useRoxyStore((s) => s.settings?.voiceWakeWord ?? false)
  const draft = useRoxyStore((s) => s.composerDrafts[chatId])
  const value = draft?.value ?? ''
  const images = draft?.images ?? []
  const updateDraft = (
    update: (current: { value: string; images: ComposerImage[] }) => {
      value: string
      images: ComposerImage[]
    }
  ): void => {
    useRoxyStore.setState((state) => ({
      composerDrafts: updateComposerDraft(state.composerDrafts, state.chats, chatId, update)
    }))
  }
  const setValue = (next: string | ((current: string) => string)): void => {
    updateDraft((current) => ({
      ...current,
      value: typeof next === 'function' ? next(current.value) : next
    }))
  }
  const setImages = (
    next: ComposerImage[] | ((current: ComposerImage[]) => ComposerImage[])
  ): void => {
    updateDraft((current) => ({
      ...current,
      images: typeof next === 'function' ? next(current.images) : next
    }))
  }
  const [dragging, setDragging] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
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

  const activeChatId = useRoxyStore((s) => s.activeChatId)
  const ideMode = useRoxyStore((s) => s.settings?.ideMode ?? false)
  const ideSelectedFile = useRoxyStore((s) => s.ideSelectedFile)
  const ideSelectedLine = useRoxyStore((s) => s.ideSelectedLine)
  const ideSelectedRoot = useRoxyStore((s) => s.ideSelectedRoot)
  const chats = useRoxyStore((s) => s.chats)
  const settings = useRoxyStore((s) => s.settings)
  const providers = useRoxyStore((s) => s.providers)
  const modelCatalog = useRoxyStore((s) => s.modelCatalog)
  const imageMode = useMemo(() => {
    const config = resolveSessionConfig(
      chats.find((chat) => chat.id === activeChatId),
      settings
    )
    const provider = providers.find((item) => item.id === config.providerId) ?? providers[0]
    if (!provider || !config.model) return false
    return (
      modelCatalog[provider.id]?.find((model) => model.id === config.model)?.imageCapable === true
    )
  }, [activeChatId, chats, settings, providers, modelCatalog])
  const rawAttachments = useRoxyStore((s) =>
    s.activeChatId ? s.pendingContextAttachments[s.activeChatId] : undefined
  )
  const contextAttachments = rawAttachments ?? EMPTY_ATTACHMENTS
  const addPendingContextAttachment = useRoxyStore((s) => s.addPendingContextAttachment)
  const removePendingContextAttachment = useRoxyStore((s) => s.removePendingContextAttachment)
  const setContextPickerOpen = useRoxyStore((s) => s.setContextPickerOpen)

  const activeChat = chats.find((c) => c.id === activeChatId)
  const parentChat = activeChat?.parentId
    ? chats.find((c) => c.id === activeChat.parentId)
    : undefined
  const workspaceRoot =
    activeChat?.worktreePath ??
    activeChat?.workspacePath ??
    parentChat?.worktreePath ??
    parentChat?.workspacePath ??
    null
  const effectiveRoot = ideSelectedRoot || workspaceRoot

  const currentFile = useMemo(() => {
    if (!ideMode) return null
    const root = effectiveRoot
    const normRoot = root ? root.replace(/\\/g, '/').replace(/\/+$/, '') : ''
    if (
      ideSelectedFile &&
      !ideSelectedFile.directory &&
      (!ideSelectedRoot || !root || normalizeRoot(ideSelectedRoot) === normalizeRoot(root))
    ) {
      const normPath = ideSelectedFile.path.replace(/\\/g, '/').replace(/^\/+/, '')
      const fullPath = normRoot ? `${normRoot}/${normPath}` : normPath
      return {
        path: ideSelectedFile.path,
        fullPath,
        name: ideSelectedFile.name || ideSelectedFile.path.split('/').pop() || ideSelectedFile.path,
        line: ideSelectedLine
      }
    }
    const saved = loadActiveFile(root)
    if (saved) {
      const normPath = saved.path.replace(/\\/g, '/').replace(/^\/+/, '')
      const fullPath = normRoot ? `${normRoot}/${normPath}` : normPath
      return {
        path: saved.path,
        fullPath,
        name: saved.name || saved.path.split('/').pop() || saved.path,
        line: saved.line
      }
    }
    return null
  }, [ideMode, ideSelectedFile, ideSelectedLine, ideSelectedRoot, effectiveRoot])

  const isCurrentFileAttached = Boolean(
    currentFile &&
    contextAttachments.some(
      (a) =>
        a.path === currentFile.path ||
        (a.fullPath && currentFile.fullPath && a.fullPath === currentFile.fullPath) ||
        (a.fullPath && currentFile.path && a.fullPath.endsWith(currentFile.path))
    )
  )

  const [contextMenuOpen, setContextMenuOpen] = useState(false)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextMenuAnchor = useMenuAnchor(contextMenuRef, contextMenuOpen, 240, { gap: 8 })

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
    if (!contextMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (!contextMenuRef.current?.contains(e.target as Node)) {
        setContextMenuOpen(false)
      }
    }
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') setContextMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenuOpen])

  useEffect(() => {
    return () => {
      recorderRef.current?.cancel()
    }
  }, [])

  const handleAttachCurrentFile = (): void => {
    setContextMenuOpen(false)
    if (activeChatId && currentFile) {
      const target = currentFile.fullPath || currentFile.path
      addPendingContextAttachment(
        activeChatId,
        createContextAttachment('file', target, effectiveRoot, currentFile.line)
      )
    }
  }

  const handleOpenContextPicker = (): void => {
    setContextMenuOpen(false)
    setContextPickerOpen(true)
  }
  const bots = useRoxyStore((s) => s.bots)
  const recipients = [{ id: HOST_USERNAME, username: HOST_USERNAME }, ...bots]
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionDismissed, setMentionDismissed] = useState(false)
  const [focused, setFocused] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [error, setError] = useState('')
  const syncMirrorScroll = (): void => {
    if (ref.current && mirror.current) mirror.current.scrollTop = ref.current.scrollTop
  }
  useLayoutEffect(syncMirrorScroll, [value])
  /** Explicit pick when several known @bots appear; cleared when no longer mentioned. */
  const [pickedSendId, setPickedSendId] = useState<string | null>(null)
  // A mention can start anywhere, as long as the "@" opens a word (start of
  // input or after whitespace) — matching how you actually type "ask @bob to…".
  const prefix = /(?:^|[\s,;:!?()[\]{}\u00bf\u00a1])@([a-z0-9_-]*)$/i.exec(value.slice(0, caret))
  const mentions =
    focused && prefix && !mentionDismissed
      ? recipients.filter((bot) => bot.username.startsWith(prefix[1].toLowerCase())).slice(0, 8)
      : []
  const selectedMention = Math.min(mentionIndex, Math.max(0, mentions.length - 1))
  const chooseMention = (username: string): void => {
    if (!prefix) return
    // Replace just the partial mention, keeping whatever surrounds it.
    const head = value.slice(0, caret - prefix[1].length - 1) + `@${username} `
    const rest = value.slice(caret).replace(/^[a-z0-9_-]*\s*/i, '')
    setValue(head + rest)
    setCaret(head.length)
    setMentionDismissed(true)
    const picked = bots.find((bot) => bot.username.toLowerCase() === username.toLowerCase())
    setPickedSendId(picked?.id ?? null)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(head.length, head.length)
    })
  }

  // Take the caret only for the chat that asked for it (a bot just created),
  // then clear the request so switching back later does not refocus.
  const focusChatId = useRoxyStore((s) => s.composerFocusChatId)
  useEffect(() => {
    if (!focusChatId || focusChatId !== activeChatId) return
    ref.current?.focus()
    useRoxyStore.setState({ composerFocusChatId: null })
  }, [focusChatId, activeChatId])

  const addFiles = async (files: File[]): Promise<void> => {
    if (imageMode) return
    if (files.length === 0) return
    const read = await Promise.all(files.map(readImageFile))
    const valid = read.filter((x): x is ComposerImage => x !== null)
    if (valid.length) setImages((prev) => [...prev, ...valid])
  }

  const removeImage = (id: string): void => setImages((prev) => prev.filter((i) => i.id !== id))

  // Project sessions only: known @bots in the draft. Mentions stay visual for
  // default Enter (Roxy); "Send to @…" is the explicit guest route.
  const knownTargets = variant === 'session' ? mentionedBots(value, bots) : []
  const sendTarget =
    knownTargets.length === 1
      ? knownTargets[0]
      : (knownTargets.find((bot) => bot.id === pickedSendId) ?? null)

  useEffect(() => {
    if (!pickedSendId) return
    const stillMentioned = (variant === 'session' ? mentionedBots(value, bots) : []).some(
      (bot) => bot.id === pickedSendId
    )
    if (!stillMentioned) setPickedSendId(null)
  }, [pickedSendId, value, bots, variant])

  const submit = async (toBotId?: string, force = false): Promise<void> => {
    const text = value.trim()
    if (submittingRef.current || (!text && images.length === 0 && contextAttachments.length === 0))
      return
    if (toBotId) {
      const allowed =
        knownTargets.length === 1
          ? knownTargets[0].id === toBotId
          : knownTargets.some((bot) => bot.id === toBotId) && sendTarget?.id === toBotId
      if (!allowed) {
        setError(t('composer.chooseSendTo'))
        return
      }
    }
    // Clear immediately so a long direct turn never locks the composer. If the
    // enqueue fails, restore this draft without dropping its image attachments.
    const snapshotImages = images
    setValue('')
    setImages([])
    setMentionDismissed(true)
    setPickedSendId(null)
    setError('')
    submittingRef.current = true
    setSubmitting(true)
    const acceptedBefore = useRoxyStore.getState().acceptedSends[chatId] ?? 0
    try {
      if (toBotId) {
        await useRoxyStore
          .getState()
          .submitToCollaborator(text, toBotId, snapshotImages.length ? snapshotImages : undefined)
      } else {
        await onSend(text, snapshotImages.length ? snapshotImages : undefined, force)
      }
    } catch (e) {
      // Later turn failures are not send failures: the user message may already
      // be durable. Restoring it would make retry submit a duplicate.
      if ((useRoxyStore.getState().acceptedSends[chatId] ?? 0) === acceptedBefore) {
        useRoxyStore.setState((state) => ({
          composerDrafts: restoreComposerDraft(
            state.composerDrafts,
            state.chats,
            chatId,
            text,
            snapshotImages
          )
        }))
      }
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  useEffect(() => {
    // A direct send stays pending for the whole streamed turn. Unlock once the
    // turn starts so follow-ups can queue; already-running queue sends unlock
    // in their own finally block instead.
    if (sending && submittingRef.current) {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [sending])

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
    if (event.nativeEvent.isComposing) return
    if (mentions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex(
          (selectedMention + (event.key === 'ArrowDown' ? 1 : -1) + mentions.length) %
            mentions.length
        )
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        chooseMention(mentions[selectedMention].username)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMentionDismissed(true)
        return
      }
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
      void submit(undefined, isForce)
    }
  }

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    if (isRecording || isTranscribing || isHoldingKeyRef.current) {
      event.preventDefault()
      return
    }
    const files = imageMode ? [] : imageFilesFrom(event.clipboardData)
    if (files.length > 0) {
      event.preventDefault()
      void addFiles(files)
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    setDragging(false)
    if (imageMode) return
    const files = imageFilesFrom(event.dataTransfer)
    if (files.length > 0) {
      event.preventDefault()
      void addFiles(files)
    }
    const allFiles = Array.from(event.dataTransfer.files ?? [])
    const nonImages = allFiles.filter((f) => !f.type.startsWith('image/'))
    if (nonImages.length > 0 && activeChatId) {
      event.preventDefault()
      for (const f of nonImages) {
        const diskPath = (f as { path?: string }).path || f.name
        addPendingContextAttachment(
          activeChatId,
          createContextAttachment('file', diskPath, effectiveRoot)
        )
      }
    }
  }

  // Only known collaborators get a tint. A mention never chooses the responder.
  const placeholder = sending
    ? onStop
      ? t('composer.queuePlaceholderStop')
      : t('composer.queuePlaceholder')
    : t('composer.placeholder')
  const highlighted = value
    .split(new RegExp(`(${MENTION.source})`, MENTION.flags))
    .map((chunk, i) => {
      if (
        i % 2 === 0 ||
        !isKnownMention(
          chunk,
          bots.map((bot) => bot.username)
        )
      )
        return (
          <span key={i} className="text-text">
            {chunk}
          </span>
        )
      return (
        <span key={i} className="text-accent">
          {chunk}
        </span>
      )
    })
    // A trailing newline is invisible in a div but real in a textarea.
    .concat(value.endsWith('\n') ? [<span key="pad">{'\u200b'}</span>] : [])

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
                requestAnimationFrame(syncMirrorScroll)
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
            requestAnimationFrame(syncMirrorScroll)
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
  const showStop =
    !!sending && !!onStop && !value.trim() && images.length === 0 && contextAttachments.length === 0
  const canSend = !!value.trim() || images.length > 0 || contextAttachments.length > 0

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
        // `sq-frame`, not `sq`: the controls row below renders popovers
        // (model, mode, effort, context, usage) that open upward, well outside
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
        className={`relative mx-auto w-full max-w-3xl min-w-0 sq-frame sq-2xl sq-ring sq-fill-surface-2 edge edge-panel shadow-raised rounded-2xl border bg-surface-2 transition ${
          dragging
            ? 'border-accent [--sq-ring:var(--color-accent)] inset-ring-1 inset-ring-accent/40'
            : 'border-border focus-within:border-border-strong focus-within:[--sq-ring:var(--edge-strong)]'
        }`}
      >
        {(contextAttachments.length > 0 ||
          images.length > 0 ||
          (ideMode && currentFile && !isCurrentFileAttached)) && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 pt-3">
            {ideMode && currentFile && !isCurrentFileAttached && (
              <button
                type="button"
                onClick={handleAttachCurrentFile}
                className="press-scale inline-flex items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-xs text-accent hover:bg-accent/20 transition-colors shadow-xs"
                title={t('composer.attachCurrentFile', {
                  path: currentFile.fullPath || currentFile.path
                })}
              >
                <Plus className="h-3 w-3 shrink-0" />
                <FileCode className="h-3.5 w-3.5 shrink-0" />
                <span className="font-mono text-[11px] truncate max-w-[220px]">
                  {currentFile.name}
                  {currentFile.line ? `:${currentFile.line}` : ''}
                </span>
              </button>
            )}
            {contextAttachments.map((item) => {
              const fullPathToDisplay = item.fullPath || item.path
              const displayName = item.name || item.path.split('/').pop() || item.path
              return (
                <span
                  key={item.id}
                  className="group inline-flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-xs text-text shadow-xs"
                  title={fullPathToDisplay}
                >
                  {item.type === 'folder' ? (
                    <Folder className="h-3.5 w-3.5 shrink-0 text-accent" />
                  ) : (
                    <FileCode className="h-3.5 w-3.5 shrink-0 text-accent" />
                  )}
                  <span className="rounded bg-accent/20 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent shrink-0">
                    {t('chat.contextAttached')}
                  </span>
                  <span
                    className="max-w-[220px] truncate font-mono text-[11px]"
                    title={fullPathToDisplay}
                  >
                    {displayName}
                    {item.line ? `:${item.line}` : ''}
                  </span>
                  {activeChatId && (
                    <button
                      type="button"
                      onClick={() => removePendingContextAttachment(activeChatId, item.id)}
                      title={t('composer.removeContext')}
                      className="press-scale -mr-0.5 ml-0.5 rounded p-0.5 text-text-subtle hover:bg-white/10 hover:text-text shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              )
            })}
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

        {mentions.length > 0 && (
          <div
            id="bot-mentions"
            role="listbox"
            aria-label={t('bots.mentionLabel')}
            className="absolute bottom-full left-0 z-40 mb-2 w-64 max-w-full rounded-xl border border-border bg-surface p-1 shadow-2xl"
          >
            {mentions.map((bot, index) => (
              <button
                type="button"
                key={bot.id}
                id={`bot-mention-${bot.id}`}
                role="option"
                aria-selected={index === selectedMention}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => chooseMention(bot.username)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm',
                  index === selectedMention
                    ? 'bg-elevated text-text'
                    : 'text-text-muted hover:bg-white/5'
                )}
              >
                {bot.username === HOST_USERNAME ? (
                  <img src={roxy} alt="" aria-hidden className="h-6 w-6 shrink-0 object-cover" />
                ) : (
                  <BotAvatar username={bot.username} size={24} />
                )}
                <span className="truncate">@{bot.username}</span>
              </button>
            ))}
          </div>
        )}
        {/* A textarea can't style parts of its own value, so an identical,
            aria-hidden layer sits behind it and paints the @mentions. Every
            metric below must match the textarea's exactly or the text drifts. */}
        <div className="relative">
          <div
            ref={mirror}
            aria-hidden
            className="pointer-events-none absolute inset-0 max-h-[168px] overflow-hidden whitespace-pre-wrap break-words px-4 pt-3 text-sm text-transparent [scrollbar-gutter:stable]"
          >
            {value ? highlighted : <span className="text-text-subtle">{placeholder}</span>}
          </div>
          {/* Native content sizing avoids collapsing the flex sibling canvas to
              measure scrollHeight on every keystroke. */}
          <textarea
            ref={ref}
            value={value}
            rows={1}
            readOnly={isRecording || isTranscribing || isHoldingKeyRef.current}
            aria-label={t('composer.placeholder')}
            aria-autocomplete="list"
            aria-controls={mentions.length ? 'bot-mentions' : undefined}
            aria-activedescendant={
              mentions.length ? `bot-mention-${mentions[selectedMention].id}` : undefined
            }
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onChange={(e) => {
              if (isRecording || isTranscribing || isHoldingKeyRef.current) return
              const nextValue = e.target.value
              const caretAtEnd =
                e.target.selectionStart === nextValue.length &&
                e.target.selectionEnd === nextValue.length
              setValue(nextValue)
              setError('')
              setCaret(e.target.selectionStart)
              setMentionIndex(0)
              setMentionDismissed(false)
              requestAnimationFrame(() => {
                // Controlled field sizing does not reliably keep a wrapped end
                // caret visible once the textarea reaches its height cap.
                if (
                  caretAtEnd &&
                  ref.current &&
                  document.activeElement === ref.current &&
                  ref.current.value === nextValue &&
                  ref.current.selectionStart === nextValue.length &&
                  ref.current.selectionEnd === nextValue.length
                ) {
                  ref.current.scrollTop = ref.current.scrollHeight
                }
                syncMirrorScroll()
              })
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onScroll={() => {
              syncMirrorScroll()
            }}
            className="relative block max-h-[168px] w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 text-sm text-transparent caret-text outline-none [field-sizing:content] [scrollbar-gutter:stable]"
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2 pt-1.5">
          {/* Chrome-less controls, matching the workstream strip below. Two
              things do the work the borders used to: gap-1 (further apart and
              five bare labels just scatter across the row) and px-1.5 on every
              control, which against the row's px-2.5 puts each label's first
              glyph exactly on the textarea's px-4 text column. */}
          <div className="flex items-center gap-1 min-w-0">
            {!imageMode && (
              <div ref={contextMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setContextMenuOpen((o) => !o)}
                  title={t('composer.addContext')}
                  aria-label={t('composer.addContext')}
                  aria-expanded={contextMenuOpen}
                  className={cn(
                    'press-scale flex h-6 shrink-0 items-center justify-center sq sq-md rounded-md px-1.5 text-text-muted transition-colors hover:bg-white/5 hover:text-text',
                    contextMenuOpen && 'bg-white/10 text-text'
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>

                {contextMenuOpen && (
                  <div
                    className="animate-pop-in absolute bottom-full left-0 z-50 mb-2 flex min-w-[220px] flex-col sq-frame sq-xl sq-fill-elevated sq-ring edge edge-strong edge-panel rounded-xl border border-border bg-elevated shadow-float p-1 text-xs"
                    style={contextMenuAnchor}
                  >
                    {ideMode && (
                      <>
                        {currentFile ? (
                          <button
                            type="button"
                            disabled={isCurrentFileAttached}
                            onClick={handleAttachCurrentFile}
                            className={cn(
                              'press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors',
                              isCurrentFileAttached
                                ? 'opacity-50 cursor-not-allowed text-text-subtle'
                                : 'text-text hover:bg-white/5'
                            )}
                            title={t('composer.attachCurrentFile', {
                              path: currentFile.fullPath || currentFile.path
                            })}
                          >
                            <FileCode className="h-3.5 w-3.5 shrink-0 text-accent" />
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="truncate font-mono text-xs font-medium">
                                {currentFile.fullPath || currentFile.path}
                              </span>
                              <span className="truncate text-[10px] text-text-subtle">
                                {currentFile.name}
                                {currentFile.line ? `:${currentFile.line}` : ''}
                              </span>
                            </div>
                            {isCurrentFileAttached && (
                              <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                            )}
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 px-2.5 py-1.5 text-text-subtle">
                            <FileCode className="h-3.5 w-3.5 shrink-0 opacity-40" />
                            <span className="truncate text-[11px]">
                              {t('composer.noCurrentFile')}
                            </span>
                          </div>
                        )}

                        <div className="my-1 border-t border-border/40" />
                      </>
                    )}

                    <button
                      type="button"
                      onClick={handleOpenContextPicker}
                      className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text hover:bg-white/5 transition-colors"
                    >
                      <Folder className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                      <span>{t('composer.attachFilesOrFolders')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setContextMenuOpen(false)
                        fileRef.current?.click()
                      }}
                      className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text hover:bg-white/5 transition-colors"
                    >
                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                      <span>{t('composer.attachImages')}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            {!imageMode && !isCompact && (
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

                    {!imageMode && (
                      <div className="flex flex-wrap items-center gap-1 p-0.5">
                        {variant === 'session' && <AgentPicker />}
                        {variant === 'session' && <PromptPicker />}
                        <ThinkingPicker />
                        {variant === 'session' && <ContextPicker />}
                        <ContextMeter />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : !imageMode ? (
              <>
                {variant === 'session' && <AgentPicker />}
                {variant === 'session' && <PromptPicker />}
                <ThinkingPicker />
                {variant === 'session' && <ContextPicker />}
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
            ) : null}
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
                onClick={() => void submit()}
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
                onClick={() => void submit(undefined, true)}
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
            <div className="flex max-w-[min(100%,22rem)] flex-col items-end gap-1">
              {knownTargets.length > 1 && !sendTarget && (
                <div
                  role="group"
                  aria-label={t('composer.chooseSendTo')}
                  className="flex flex-wrap justify-end gap-1"
                >
                  <span className="px-1 text-[11px] text-text-muted">
                    {t('composer.chooseSendTo')}
                  </span>
                  {knownTargets.map((bot) => (
                    <button
                      key={bot.id}
                      type="button"
                      onClick={() => setPickedSendId(bot.id)}
                      className="press-scale rounded-md bg-white/5 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-white/10"
                    >
                      @{bot.username}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-1.5">
                {sendTarget && (
                  <button
                    type="button"
                    onClick={() => void submit(sendTarget.id)}
                    disabled={!canSend || submitting}
                    title={t('composer.sendToHint')}
                    className="press-scale h-8 shrink-0 rounded-lg bg-accent/15 px-2.5 text-xs font-medium text-accent hover:bg-accent/25 disabled:opacity-30"
                  >
                    {t('composer.sendTo', { username: sendTarget.username })}
                  </button>
                )}
                <button
                  onClick={() => void submit()}
                  disabled={!canSend || submitting}
                  title={sending ? t('composer.addToQueue') : t('composer.send')}
                  className="press-scale flex h-8 w-8 shrink-0 items-center justify-center sq sq-lg rounded-lg bg-white text-black hover:bg-white/90 disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mx-auto mt-2 max-w-3xl text-xs text-danger">
          {error}
        </p>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        disabled={imageMode}
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
