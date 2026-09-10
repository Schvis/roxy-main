/**
 * Standalone, frameless, transparent VTuber avatar window.
 * Floats anywhere on the desktop outside the main Roxy window with no background.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Eye,
  EyeOff,
  X,
  MessageSquare,
  MessageSquareOff,
  Activity
} from 'lucide-react'
import { useRoxyStore } from '../lib/store'
import { useTranslation } from 'react-i18next'
import { Live2dCanvas } from './Live2dCanvas'
import { cameraManager, type CameraDeviceInfo } from '../lib/vision'
import { VadConversationSession, type VadState } from '../lib/vad-session'
import { cn } from '../lib/cn'
import { api } from '../lib/api'

export function VtuberStandalone(): JSX.Element {
  const { t } = useTranslation()
  const settings = useRoxyStore((s) => s.settings)
  const setVtuberEnabled = useRoxyStore((s) => s.setVtuberEnabled)
  const setVtuberVisionEnabled = useRoxyStore((s) => s.setVtuberVisionEnabled)
  const setVtuberVadEnabled = useRoxyStore((s) => s.setVtuberVadEnabled)
  const setVtuberShowChatBubble = useRoxyStore((s) => s.setVtuberShowChatBubble)
  const setVtuberShowStatus = useRoxyStore((s) => s.setVtuberShowStatus)
  const setVtuberFollowCursor = useRoxyStore((s) => s.setVtuberFollowCursor)
  const submit = useRoxyStore((s) => s.submit)

  const showBubble = settings?.vtuberShowChatBubble ?? true
  const showStatus = settings?.vtuberShowStatus ?? true
  const followCursor = settings?.vtuberFollowCursor ?? true

  const [cameraActive, setCameraActive] = useState(false)
  const [showCameraPip, setShowCameraPip] = useState(false)
  const [cameraDevices, setCameraDevices] = useState<CameraDeviceInfo[]>([])
  const [selectedCamera, setSelectedCamera] = useState(settings?.vtuberCameraDevice || 'default')
  const [vadState, setVadState] = useState<VadState>('idle')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [bubbleText, setBubbleText] = useState<string>('')
  const [bubbleVisible, setBubbleVisible] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [headPos, setHeadPos] = useState({ x: 170, y: 70, width: 120, height: 80 })
  const [customPos, setCustomPos] = useState<{ x: number; y: number } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const isDraggingBubble = useRef(false)
  const hasDraggedBubble = useRef(false)
  const bubbleDragStart = useRef({ mouseX: 0, mouseY: 0, bubbleX: 0, bubbleY: 0 })
  const vadSessionRef = useRef<VadConversationSession | null>(null)
  const pipVideoRef = useRef<HTMLVideoElement>(null)
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Dragging state for moving the Electron window
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  // Initialize VAD session
  useEffect(() => {
    const session = new VadConversationSession((state) => {
      setVadState(state)
      setIsSpeaking(state === 'speaking_avatar')
    })
    vadSessionRef.current = session

    return () => {
      session.destroy()
      vadSessionRef.current = null
    }
  }, [])

  // Sync TTS speaking state to avatar lip-sync and chat bubble
  useEffect(() => {
    if (!api?.tts?.onSpeakingState) return
    const unlisten = api.tts.onSpeakingState((status) => {
      setIsSpeaking(status.speaking)
      if (status.speaking) {
        setIsThinking(false)
        if (status.text?.trim()) {
          setBubbleText(status.text.trim())
          setBubbleVisible(true)
          if (bubbleTimeoutRef.current) {
            clearTimeout(bubbleTimeoutRef.current)
            bubbleTimeoutRef.current = null
          }
        }
      } else {
        if (bubbleTimeoutRef.current) {
          clearTimeout(bubbleTimeoutRef.current)
        }
        bubbleTimeoutRef.current = setTimeout(() => {
          setBubbleVisible(false)
        }, 3500)
      }
    })
    return () => {
      unlisten()
      if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current)
    }
  }, [])

  // Sync turn lifecycle to thinking indicator in chat bubble
  useEffect(() => {
    if (!api?.chats?.onTurnState) return
    const unlisten = api.chats.onTurnState(({ state }) => {
      if (state === 'thinking') {
        setIsThinking(true)
        setBubbleText('')
        setBubbleVisible(true)
        if (bubbleTimeoutRef.current) {
          clearTimeout(bubbleTimeoutRef.current)
          bubbleTimeoutRef.current = null
        }
      } else if (state === 'idle') {
        setIsThinking(false)
        if (!isSpeaking) {
          if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current)
          bubbleTimeoutRef.current = setTimeout(() => {
            setBubbleVisible(false)
          }, 3500)
        }
      }
    })
    return () => unlisten()
  }, [isSpeaking])

  // When an assistant message updates in chat (supports non-TTS and transcript sync)
  useEffect(() => {
    if (!api?.messages?.onUpdated) return
    const unlisten = api.messages.onUpdated(async ({ chatId }) => {
      // When TTS is enabled, speech bubble text only appears when TTS is ready and speaking
      const currentSettings = settings ?? (await api?.settings?.getAll?.().catch(() => null))
      if (currentSettings?.ttsEnabled) return

      try {
        const msgs = await api.messages.list(chatId)
        const last = msgs[msgs.length - 1]
        if (last && last.role === 'assistant' && last.content) {
          setIsThinking(false)
          if (!isSpeaking) {
            const clean = last.content
              .replace(/```[\s\S]*?```/g, '…')
              .replace(/!\[.*?\]\(.*?\)/g, '')
              .replace(/\[(.*?)\]\(.*?\)/g, '$1')
              .trim()
            if (clean) {
              setBubbleText(clean)
              setBubbleVisible(true)
              if (bubbleTimeoutRef.current) clearTimeout(bubbleTimeoutRef.current)
              bubbleTimeoutRef.current = setTimeout(() => {
                setBubbleVisible(false)
              }, 4500)
            }
          }
        }
      } catch {
        // ignore
      }
    })
    return () => unlisten()
  }, [isSpeaking, settings])

  useEffect(() => {
    if (settings?.vtuberVadEnabled) {
      void vadSessionRef.current?.start()
    } else {
      vadSessionRef.current?.stop()
    }
  }, [settings?.vtuberVadEnabled])

  // Camera lifecycle
  useEffect(() => {
    let unmounted = false
    async function initCamera(): Promise<void> {
      const devices = await cameraManager.listDevices()
      if (unmounted) return
      setCameraDevices(devices)

      if (settings?.vtuberVisionEnabled) {
        const stream = await cameraManager.start(selectedCamera)
        if (unmounted) return
        setCameraActive(!!stream)
        if (pipVideoRef.current && stream) {
          pipVideoRef.current.srcObject = stream
        }
      } else {
        cameraManager.stop()
        setCameraActive(false)
      }
    }
    void initCamera()
    return () => {
      unmounted = true
      cameraManager.stop()
    }
  }, [settings?.vtuberVisionEnabled, selectedCamera])

  // Camera PiP stream connection
  useEffect(() => {
    if (showCameraPip && pipVideoRef.current) {
      const stream = cameraManager.getStream()
      if (stream) {
        pipVideoRef.current.srcObject = stream
      }
    }
  }, [showCameraPip, cameraActive])

  // Handle window dragging via native IPC windowMove
  const handlePointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button, select, input, [data-resize-handle]')) return
    isDragging.current = true
    lastPos.current = { x: e.screenX, y: e.screenY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent): void => {
    if (!isDragging.current) return
    const dx = e.screenX - lastPos.current.x
    const dy = e.screenY - lastPos.current.y
    if (dx !== 0 || dy !== 0) {
      void api.windowMove(dx, dy)
      lastPos.current = { x: e.screenX, y: e.screenY }
    }
  }

  const handlePointerUp = (e: React.PointerEvent): void => {
    isDragging.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const handleSnapshotPrompt = async (): Promise<void> => {
    const frame = cameraManager.captureFrame()
    const images = frame ? [frame] : undefined
    const text = t('vtuber.snapshotQuery')
    const forwarded = await api.chats.submitPrompt(text, images)
    if (!forwarded) {
      await submit(text, images)
    }
  }

  const handleClose = async (): Promise<void> => {
    await setVtuberEnabled(false)
    await api.vtuber.closeWindow()
  }

  const getStatusInfo = (): { text: string; color: string; pulse: boolean } => {
    if (vadState === 'speaking_user') {
      return { text: t('vtuber.statusListening'), color: 'bg-emerald-500 text-white', pulse: true }
    }
    if (vadState === 'transcribing') {
      return { text: t('vtuber.statusTranscribing'), color: 'bg-amber-500 text-white', pulse: true }
    }
    if (vadState === 'thinking') {
      return { text: t('vtuber.statusThinking'), color: 'bg-blue-500 text-white', pulse: true }
    }
    if (vadState === 'speaking_avatar' || isSpeaking) {
      return { text: t('vtuber.statusSpeaking'), color: 'bg-purple-500 text-white', pulse: true }
    }
    if (settings?.vtuberVadEnabled) {
      return {
        text: t('vtuber.statusActive'),
        color: 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/40',
        pulse: false
      }
    }
    return { text: t('vtuber.statusIdle'), color: 'bg-surface-2/80 text-text-muted', pulse: false }
  }

  const status = getStatusInfo()

  const getBubblePlacement = (): {
    style: React.CSSProperties
    tailPosition: 'bottom' | 'top' | 'left' | 'right'
    tailOffset: number
    x: number
    y: number
  } => {
    const containerWidth = containerRef.current?.clientWidth || 340
    const containerHeight = containerRef.current?.clientHeight || 440
    const bubbleWidth = bubbleRef.current?.offsetWidth || 210
    const bubbleHeight = bubbleRef.current?.offsetHeight || 44

    // 0. User dragged bubble independently to a custom location
    if (customPos) {
      const x = Math.max(4, Math.min(containerWidth - bubbleWidth - 4, customPos.x))
      const y = Math.max(4, Math.min(containerHeight - bubbleHeight - 4, customPos.y))
      const bubbleCenterX = x + bubbleWidth / 2
      const bubbleCenterY = y + bubbleHeight / 2
      const dx = headPos.x - bubbleCenterX
      const dy = headPos.y - bubbleCenterY

      if (Math.abs(dy) > Math.abs(dx)) {
        if (dy > 0) {
          const offset = Math.max(16, Math.min(bubbleWidth - 16, headPos.x - x))
          return {
            style: { left: `${x}px`, top: `${y}px` },
            tailPosition: 'bottom',
            tailOffset: offset,
            x,
            y
          }
        } else {
          const offset = Math.max(16, Math.min(bubbleWidth - 16, headPos.x - x))
          return {
            style: { left: `${x}px`, top: `${y}px` },
            tailPosition: 'top',
            tailOffset: offset,
            x,
            y
          }
        }
      } else {
        if (dx > 0) {
          const offset = Math.max(12, Math.min(bubbleHeight - 12, headPos.y - y))
          return {
            style: { left: `${x}px`, top: `${y}px` },
            tailPosition: 'right',
            tailOffset: offset,
            x,
            y
          }
        } else {
          const offset = Math.max(12, Math.min(bubbleHeight - 12, headPos.y - y))
          return {
            style: { left: `${x}px`, top: `${y}px` },
            tailPosition: 'left',
            tailOffset: offset,
            x,
            y
          }
        }
      }
    }

    // 1. Head is panned way above the window top edge
    if (headPos.y < -20) {
      const x = Math.max(
        12,
        Math.min(containerWidth - bubbleWidth - 12, headPos.x - bubbleWidth / 2)
      )
      return {
        style: { left: `${x}px`, top: '8px' },
        tailPosition: 'top',
        tailOffset: Math.max(16, Math.min(bubbleWidth - 16, headPos.x - x)),
        x,
        y: 8
      }
    }

    // 2. Head has enough room above inside window for full wrapped text
    if (headPos.y >= bubbleHeight + 16) {
      const x = Math.max(
        12,
        Math.min(containerWidth - bubbleWidth - 12, headPos.x - bubbleWidth / 2)
      )
      const y = headPos.y - bubbleHeight - 8
      return {
        style: { left: `${x}px`, top: `${y}px` },
        tailPosition: 'bottom',
        tailOffset: Math.max(16, Math.min(bubbleWidth - 16, headPos.x - x)),
        x,
        y
      }
    }

    // 3. Message is long or head is near top: place to the side of head/body
    const spaceRight = containerWidth - (headPos.x + headPos.width / 2)
    const spaceLeft = headPos.x - headPos.width / 2

    if (spaceRight >= bubbleWidth + 12 || spaceRight >= spaceLeft) {
      const x = Math.min(
        containerWidth - bubbleWidth - 8,
        Math.max(8, headPos.x + headPos.width / 2 + 8)
      )
      const y = Math.max(
        8,
        Math.min(containerHeight - bubbleHeight - 12, Math.max(8, headPos.y - 10))
      )
      return {
        style: { left: `${x}px`, top: `${y}px` },
        tailPosition: 'left',
        tailOffset: Math.max(12, Math.min(bubbleHeight - 12, Math.max(12, headPos.y + 16 - y))),
        x,
        y
      }
    } else {
      const x = Math.max(8, headPos.x - headPos.width / 2 - bubbleWidth - 8)
      const y = Math.max(
        8,
        Math.min(containerHeight - bubbleHeight - 12, Math.max(8, headPos.y - 10))
      )
      return {
        style: { left: `${x}px`, top: `${y}px` },
        tailPosition: 'right',
        tailOffset: Math.max(12, Math.min(bubbleHeight - 12, Math.max(12, headPos.y + 16 - y))),
        x,
        y
      }
    }
  }

  const placement = getBubblePlacement()

  const handleBubblePointerDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    if (e.button !== 0) return
    isDraggingBubble.current = true
    hasDraggedBubble.current = false
    const currentLeft = bubbleRef.current ? bubbleRef.current.offsetLeft : placement.x
    const currentTop = bubbleRef.current ? bubbleRef.current.offsetTop : placement.y
    bubbleDragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      bubbleX: currentLeft,
      bubbleY: currentTop
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handleBubblePointerMove = (e: React.PointerEvent): void => {
    if (!isDraggingBubble.current) return
    e.stopPropagation()
    const dx = e.clientX - bubbleDragStart.current.mouseX
    const dy = e.clientY - bubbleDragStart.current.mouseY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasDraggedBubble.current = true
    }
    setCustomPos({
      x: bubbleDragStart.current.bubbleX + dx,
      y: bubbleDragStart.current.bubbleY + dy
    })
  }

  const handleBubblePointerUp = (e: React.PointerEvent): void => {
    if (!isDraggingBubble.current) return
    isDraggingBubble.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  const handleBubbleDoubleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setCustomPos(null)
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex h-full w-full flex-col items-center justify-center select-none bg-transparent overflow-visible cursor-grab active:cursor-grabbing"
    >
      {/* Top Floating Controls & Status (fade in on hover or speech) */}
      <div
        className={cn(
          'absolute top-2 z-20 flex items-center gap-2 transition-opacity duration-200',
          hovered || ((isSpeaking || vadState !== 'idle') && showStatus)
            ? 'opacity-100'
            : 'opacity-0'
        )}
      >
        {/* Status Pill */}
        {showStatus && (
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium shadow-lg backdrop-blur-md',
              status.color
            )}
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                status.pulse ? 'animate-ping bg-current' : 'bg-current'
              )}
            />
            <span>{status.text}</span>
          </div>
        )}

        {/* Window action buttons */}
        <div className="flex items-center gap-1 rounded-full bg-black/60 p-0.5 backdrop-blur-md border border-white/10 shadow-lg">
          <button
            type="button"
            onClick={() => void handleClose()}
            className="p-1 rounded-full text-white/80 hover:bg-danger/60 hover:text-white transition-colors"
            title={t('vtuber.close')}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Dynamic Independent Chat Bubble */}
      {showBubble && (
        <div
          ref={bubbleRef}
          onPointerDown={handleBubblePointerDown}
          onPointerMove={handleBubblePointerMove}
          onPointerUp={handleBubblePointerUp}
          onDoubleClick={handleBubbleDoubleClick}
          onClick={() => {
            if (!hasDraggedBubble.current) {
              setBubbleVisible(false)
            }
          }}
          style={placement.style}
          className={cn(
            'pointer-events-auto absolute z-30 flex max-w-[85%] flex-col items-center transition-all duration-150',
            bubbleVisible && (bubbleText || isThinking)
              ? 'scale-100 opacity-100'
              : 'scale-90 opacity-0 pointer-events-none'
          )}
        >
          <div className="group/bubble relative rounded-2xl bg-black/85 px-3.5 py-2.5 text-xs font-normal text-white shadow-2xl backdrop-blur-md border border-white/20 break-words whitespace-pre-wrap leading-relaxed select-text cursor-grab active:cursor-grabbing">
            {isThinking && !bubbleText ? (
              <div className="flex items-center gap-1.5 py-1 px-1">
                <span className="h-1.5 w-1.5 rounded-full bg-white/75 animate-bounce [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/75 animate-bounce [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 rounded-full bg-white/75 animate-bounce" />
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words">{bubbleText}</p>
            )}

            {/* Dynamic Tail pointing toward head */}
            {placement.tailPosition === 'bottom' && (
              <div
                className="absolute -bottom-1 h-2.5 w-2.5 rotate-45 border-r border-b border-white/20 bg-black/85 pointer-events-none"
                style={{
                  left: `${placement.tailOffset}px`,
                  transform: 'translateX(-50%) rotate(45deg)'
                }}
              />
            )}
            {placement.tailPosition === 'top' && (
              <div
                className="absolute -top-1 h-2.5 w-2.5 rotate-45 border-l border-t border-white/20 bg-black/85 pointer-events-none"
                style={{
                  left: `${placement.tailOffset}px`,
                  transform: 'translateX(-50%) rotate(45deg)'
                }}
              />
            )}
            {placement.tailPosition === 'left' && (
              <div
                className="absolute -left-1 h-2.5 w-2.5 rotate-45 border-l border-b border-white/20 bg-black/85 pointer-events-none"
                style={{
                  top: `${placement.tailOffset}px`,
                  transform: 'translateY(-50%) rotate(45deg)'
                }}
              />
            )}
            {placement.tailPosition === 'right' && (
              <div
                className="absolute -right-1 h-2.5 w-2.5 rotate-45 border-r border-t border-white/20 bg-black/85 pointer-events-none"
                style={{
                  top: `${placement.tailOffset}px`,
                  transform: 'translateY(-50%) rotate(45deg)'
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Transparent Live2D Avatar Canvas */}
      <div className="relative flex-1 h-full w-full flex items-center justify-center overflow-visible bg-transparent">
        <Live2dCanvas
          modelPath={settings?.vtuberModelPath}
          speaking={isSpeaking}
          followCursor={followCursor}
          onHeadMove={setHeadPos}
          className="h-full w-full bg-transparent drop-shadow-[0_10px_25px_rgba(0,0,0,0.5)]"
        />

        {/* Camera PiP if active */}
        {showCameraPip && cameraActive && (
          <div className="absolute bottom-12 left-2 z-20 w-28 rounded-lg overflow-hidden border border-white/20 shadow-2xl bg-black">
            <video
              ref={pipVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-20 object-cover"
            />
            {cameraDevices.length > 1 && (
              <select
                value={selectedCamera}
                onChange={(e) => setSelectedCamera(e.target.value)}
                className="w-full bg-surface-2 text-[10px] text-text py-0.5 px-1 outline-none"
              >
                {cameraDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      {/* Bottom Floating Toolbar (fade in on hover) */}
      <div
        className={cn(
          'absolute bottom-2 z-20 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-md border border-white/10 shadow-xl transition-opacity duration-200',
          hovered ? 'opacity-100' : 'opacity-0'
        )}
      >
        <button
          type="button"
          onClick={() => void setVtuberVadEnabled(!settings?.vtuberVadEnabled)}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
            settings?.vtuberVadEnabled
              ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-400/40'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          )}
          title={settings?.vtuberVadEnabled ? t('vtuber.vadDisable') : t('vtuber.vadEnable')}
        >
          {settings?.vtuberVadEnabled ? (
            <Mic className="h-3.5 w-3.5" />
          ) : (
            <MicOff className="h-3.5 w-3.5" />
          )}
          <span className="text-[11px]">{t('vtuber.vadLabel')}</span>
        </button>

        <button
          type="button"
          onClick={() => {
            const next = !settings?.vtuberVisionEnabled
            void setVtuberVisionEnabled(next)
            if (next) setShowCameraPip(true)
          }}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
            settings?.vtuberVisionEnabled
              ? 'bg-blue-500/30 text-blue-300 border border-blue-400/40'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          )}
          title={
            settings?.vtuberVisionEnabled ? t('vtuber.cameraDisable') : t('vtuber.cameraEnable')
          }
        >
          {settings?.vtuberVisionEnabled ? (
            <Video className="h-3.5 w-3.5" />
          ) : (
            <VideoOff className="h-3.5 w-3.5" />
          )}
          <span className="text-[11px]">{t('vtuber.visionLabel')}</span>
        </button>

        <button
          type="button"
          onClick={() => void setVtuberShowChatBubble(!showBubble)}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
            showBubble
              ? 'bg-purple-500/30 text-purple-300 border border-purple-400/40'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          )}
          title={showBubble ? t('vtuber.bubbleDisable') : t('vtuber.bubbleEnable')}
        >
          {showBubble ? (
            <MessageSquare className="h-3.5 w-3.5" />
          ) : (
            <MessageSquareOff className="h-3.5 w-3.5" />
          )}
          <span className="text-[11px]">{t('vtuber.bubbleLabel')}</span>
        </button>

        <button
          type="button"
          onClick={() => void setVtuberShowStatus(!showStatus)}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
            showStatus
              ? 'bg-amber-500/30 text-amber-300 border border-amber-400/40'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          )}
          title={showStatus ? t('vtuber.statusDisable') : t('vtuber.statusEnable')}
        >
          <Activity className="h-3.5 w-3.5" />
          <span className="text-[11px]">{t('vtuber.statusLabel')}</span>
        </button>

        <button
          type="button"
          onClick={() => void setVtuberFollowCursor(!followCursor)}
          className={cn(
            'flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
            followCursor
              ? 'bg-cyan-500/30 text-cyan-300 border border-cyan-400/40'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          )}
          title={followCursor ? t('vtuber.followCursorDisable') : t('vtuber.followCursorEnable')}
        >
          {followCursor ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          <span className="text-[11px]">{t('vtuber.followCursorLabel')}</span>
        </button>

        {settings?.vtuberVisionEnabled && cameraActive && (
          <button
            type="button"
            onClick={() => void handleSnapshotPrompt()}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white/80 hover:bg-white/15 hover:text-white transition-colors"
            title={t('vtuber.snapshot')}
          >
            <Eye className="h-3.5 w-3.5" />
            <span className="text-[11px]">{t('vtuber.see')}</span>
          </button>
        )}
      </div>

      {/* Resize Handle at Bottom Right */}
      <VtuberResizeHandle title={t('vtuber.resize')} />
    </div>
  )
}

function VtuberResizeHandle({ title }: { title: string }): JSX.Element {
  const [isResizing, setIsResizing] = useState(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const handlePointerDown = (e: React.PointerEvent): void => {
    e.stopPropagation()
    if (e.button !== 0) return
    setIsResizing(true)
    lastPos.current = { x: e.screenX, y: e.screenY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent): void => {
    if (!isResizing) return
    const dx = e.screenX - lastPos.current.x
    const dy = e.screenY - lastPos.current.y
    if (dx !== 0 || dy !== 0) {
      void api.windowResize(dx, dy)
      lastPos.current = { x: e.screenX, y: e.screenY }
    }
  }

  const handlePointerUp = (e: React.PointerEvent): void => {
    setIsResizing(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // ignore
    }
  }

  return (
    <div
      data-resize-handle
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title={title}
      className="absolute bottom-0 right-0 z-30 flex h-6 w-6 cursor-nwse-resize items-end justify-end p-1 text-white/40 transition-colors hover:text-white"
    >
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5 fill-current drop-shadow-md">
        <path d="M16 16L16 2L2 16Z" fillOpacity="0.4" />
        <path d="M16 16L16 8L8 16Z" fillOpacity="0.8" />
      </svg>
    </div>
  )
}
