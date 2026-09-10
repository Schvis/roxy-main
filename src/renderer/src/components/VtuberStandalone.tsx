/**
 * Standalone, frameless, transparent VTuber avatar window.
 * Floats anywhere on the desktop outside the main Roxy window with no background.
 */
import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Video, VideoOff, Eye, X } from 'lucide-react'
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
  const submit = useRoxyStore((s) => s.submit)

  const [cameraActive, setCameraActive] = useState(false)
  const [showCameraPip, setShowCameraPip] = useState(false)
  const [cameraDevices, setCameraDevices] = useState<CameraDeviceInfo[]>([])
  const [selectedCamera, setSelectedCamera] = useState(settings?.vtuberCameraDevice || 'default')
  const [vadState, setVadState] = useState<VadState>('idle')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [hovered, setHovered] = useState(false)

  const vadSessionRef = useRef<VadConversationSession | null>(null)
  const pipVideoRef = useRef<HTMLVideoElement>(null)

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

  // Sync TTS speaking state to avatar lip-sync
  useEffect(() => {
    if (!api?.tts?.onSpeakingState) return
    const unlisten = api.tts.onSpeakingState((status) => {
      setIsSpeaking(status.speaking)
    })
    return () => unlisten()
  }, [])

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

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="relative flex h-full w-full flex-col items-center justify-center select-none bg-transparent cursor-grab active:cursor-grabbing"
    >
      {/* Top Floating Controls & Status (fade in on hover or speech) */}
      <div
        className={cn(
          'absolute top-2 z-20 flex items-center gap-2 transition-opacity duration-200',
          hovered || isSpeaking || vadState !== 'idle' ? 'opacity-100' : 'opacity-0'
        )}
      >
        {/* Status Pill */}
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

      {/* Transparent Live2D Avatar Canvas */}
      <div className="relative flex-1 h-full w-full flex items-center justify-center overflow-visible bg-transparent">
        <Live2dCanvas
          modelPath={settings?.vtuberModelPath}
          speaking={isSpeaking}
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
