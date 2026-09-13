/**
 * Canvas component for Live2D avatar rendering.
 * Loads PixiJS + Live2D model, or falls back gracefully to a responsive
 * animated anime avatar with real-time lip-sync and blinking.
 */
import { useEffect, useRef, useState } from 'react'
import { ensureLive2dLoaded, Live2dModelController, resolveModelUrl } from '../lib/live2d-loader'
import { LipSyncController } from '../lib/lip-sync'
import { getHeadpatMessage } from '../config/headpat-messages'
import { getChestMessage } from '../config/chest-messages'
import { api } from '../lib/api'

// Default Roxy Live2D model bundled locally
export const DEFAULT_LIVE2D_MODEL = './models/live2d/roxy/Roxy_V1.model3.json'

interface Live2dCanvasProps {
  modelPath?: string
  speaking?: boolean
  className?: string
  followCursor?: boolean
  /** Standing blush amount, 0..1 (ParamCheek). */
  blush?: number
  /** Called once the Live2D controller is ready, for imperative control (e.g. setBlush). */
  onControllerReady?: (controller: Live2dModelController | null) => void
  onHeadMove?: (pos: { x: number; y: number; width: number; height: number }) => void
  onHeadpatMessage?: (text: string) => void
  onPokeMessage?: (text: string) => void
}

export function Live2dCanvas({
  modelPath,
  speaking = false,
  className = '',
  followCursor = true,
  blush = 0,
  onControllerReady,
  onHeadMove,
  onHeadpatMessage,
  onPokeMessage
}: Live2dCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [modelLoaded, setModelLoaded] = useState(false)
  const [mouthOpen, setMouthOpen] = useState(0)
  const [blinkValue, setBlinkValue] = useState(1)
  const [fallbackZoom, setFallbackZoom] = useState(1.0)
  const [fallbackPan, setFallbackPan] = useState({ x: 0, y: 0 })
  const [isHeadHovered, setIsHeadHovered] = useState(false)
  const [isChestHovered, setIsChestHovered] = useState(false)
  const [isHeadpattingFallback, setIsHeadpattingFallback] = useState(false)
  const [isPokingFallback, setIsPokingFallback] = useState(false)
  const [fallbackTilt, setFallbackTilt] = useState(0)
  const isPanning = useRef(false)
  const lastPanPos = useRef({ x: 0, y: 0 })
  const isHeadpattingRef = useRef(false)
  const isPokingRef = useRef(false)
  const headpatStartTimeRef = useRef(0)
  const pokeStartTimeRef = useRef(0)
  const lastAudioPlayTimeRef = useRef(0)
  const lastPokeAudioPlayTimeRef = useRef(0)
  const headpatAudioRef = useRef<HTMLAudioElement | null>(null)
  const pokeAudioRef = useRef<HTMLAudioElement | null>(null)
  const activePath = modelPath?.trim() || DEFAULT_LIVE2D_MODEL
  const controllerRef = useRef<Live2dModelController | null>(null)
  const lipSyncRef = useRef<LipSyncController | null>(null)
  const pixiAppRef = useRef<any>(null)

  // Initialize lip-sync controller
  useEffect(() => {
    const lipSync = new LipSyncController((val) => {
      setMouthOpen(val)
      if (controllerRef.current) {
        controllerRef.current.setMouthOpenY(val)
      }
    })
    lipSyncRef.current = lipSync
    return () => {
      lipSync.destroy()
    }
  }, [])

  // Sync external speaking state
  useEffect(() => {
    lipSyncRef.current?.setSpeaking(speaking)
  }, [speaking])

  // Sync standing blush amount
  useEffect(() => {
    controllerRef.current?.setBlush(blush)
  }, [blush, modelLoaded])

  // Fallback avatar blinking loop if Live2D engine not active
  useEffect(() => {
    if (modelLoaded) return

    let timeoutId: any = null
    const runBlink = (): void => {
      setBlinkValue(0)
      setTimeout(() => {
        setBlinkValue(1)
        timeoutId = setTimeout(runBlink, Math.random() * 3000 + 2500)
      }, 120)
    }
    timeoutId = setTimeout(runBlink, 2000)
    return () => clearTimeout(timeoutId)
  }, [modelLoaded])

  // Native wheel listener to zoom model with cursor focus
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheelNative = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.12 : 0.89

      if (controllerRef.current) {
        controllerRef.current.adjustZoom(factor, cx, cy)
      }

      setFallbackZoom((prev) => Math.max(0.3, Math.min(6.0, prev * factor)))
    }

    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheelNative)
    }
  }, [])

  const handleDoubleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (controllerRef.current) {
      controllerRef.current.resetZoomAndPan()
    }
    setFallbackZoom(1.0)
    setFallbackPan({ x: 0, y: 0 })
  }

  /** Stop any currently-playing headpat voiceline. */
  const stopHeadpatAudio = (): void => {
    if (headpatAudioRef.current) {
      try {
        headpatAudioRef.current.pause()
        headpatAudioRef.current.src = ''
      } catch {
        // ignore
      }
      headpatAudioRef.current = null
    }
  }

  /** Stop any currently-playing poke (chest) voiceline. */
  const stopPokeAudio = (): void => {
    if (pokeAudioRef.current) {
      try {
        pokeAudioRef.current.pause()
        pokeAudioRef.current.src = ''
      } catch {
        // ignore
      }
      pokeAudioRef.current = null
    }
  }

  const triggerHeadpatAudio = async (): Promise<void> => {
    try {
      // Headpat and poke voicelines are mutually exclusive: cancel any poke audio.
      stopPokeAudio()

      let audio: HTMLAudioElement | null = null
      let fileName = ''
      let mappedText = ''

      if (api?.vtuber?.getHeadpatAudio) {
        const res = await api.vtuber.getHeadpatAudio().catch(() => null)
        if (res?.audioBase64) {
          audio = new Audio(`data:${res.format || 'audio/mp3'};base64,${res.audioBase64}`)
          fileName = res.name
          mappedText = res.text || ''
        }
      }

      if (!audio) {
        const idx = Math.floor(Math.random() * 4) + 1
        fileName = `headpat${idx}.mp3`
        audio = new Audio(`./voicelines/headpat/${fileName}`)
      }

      if (!mappedText && fileName) {
        mappedText = getHeadpatMessage(fileName)
      }

      if (headpatAudioRef.current) {
        stopHeadpatAudio()
      }

      headpatAudioRef.current = audio
      lipSyncRef.current?.setSpeaking(true)

      if (mappedText?.trim()) {
        onHeadpatMessage?.(mappedText.trim())
      }

      const cleanup = (): void => {
        if (headpatAudioRef.current === audio) {
          headpatAudioRef.current = null
          lipSyncRef.current?.setSpeaking(false)
        }
      }

      audio.onended = cleanup
      audio.onerror = cleanup
      await audio.play().catch(() => {
        cleanup()
      })
    } catch (err) {
      console.warn('[Live2D] Failed to play headpat audio:', err)
      lipSyncRef.current?.setSpeaking(false)
    }
  }

  const triggerPokeAudio = async (): Promise<void> => {
    try {
      // Headpat and poke voicelines are mutually exclusive: cancel any headpat audio.
      stopHeadpatAudio()

      let audio: HTMLAudioElement | null = null
      let fileName = ''
      let mappedText = ''

      if (api?.vtuber?.getChestAudio) {
        const res = await api.vtuber.getChestAudio().catch(() => null)
        if (res?.audioBase64) {
          audio = new Audio(`data:${res.format || 'audio/mp3'};base64,${res.audioBase64}`)
          fileName = res.name
          mappedText = res.text || ''
        }
      }

      if (!audio) {
        const idx = Math.floor(Math.random() * 4) + 1
        fileName = `chest${idx}.mp3`
        audio = new Audio(`./voicelines/chest/${fileName}`)
      }

      if (!mappedText && fileName) {
        mappedText = getChestMessage(fileName)
      }

      if (pokeAudioRef.current) {
        stopPokeAudio()
      }

      pokeAudioRef.current = audio
      lipSyncRef.current?.setSpeaking(true)

      if (mappedText?.trim()) {
        onPokeMessage?.(mappedText.trim())
      }

      const cleanup = (): void => {
        if (pokeAudioRef.current === audio) {
          pokeAudioRef.current = null
          lipSyncRef.current?.setSpeaking(false)
        }
      }

      audio.onended = cleanup
      audio.onerror = cleanup
      await audio.play().catch(() => {
        cleanup()
      })
    } catch (err) {
      console.warn('[Live2D] Failed to play chest audio:', err)
      lipSyncRef.current?.setSpeaking(false)
    }
  }

  const checkHeadHit = (clientX: number, clientY: number): boolean => {
    const el = containerRef.current
    if (!el) return false
    const rect = el.getBoundingClientRect()
    const localX = clientX - rect.left
    const localY = clientY - rect.top

    if (modelLoaded && controllerRef.current) {
      return controllerRef.current.isHeadHit(localX, localY)
    }

    const w = el.clientWidth || 340
    const h = el.clientHeight || 440
    const headCenterX = w / 2 + fallbackPan.x
    const headCenterY = h / 2 + fallbackPan.y - 120 * fallbackZoom
    const halfW = 65 * fallbackZoom
    const halfH = 55 * fallbackZoom
    return (
      Math.abs(localX - headCenterX) <= halfW &&
      localY >= headCenterY - halfH &&
      localY <= headCenterY + halfH
    )
  }

  const checkChestHit = (clientX: number, clientY: number): boolean => {
    const el = containerRef.current
    if (!el) return false
    const rect = el.getBoundingClientRect()
    const localX = clientX - rect.left
    const localY = clientY - rect.top

    if (modelLoaded && controllerRef.current) {
      return controllerRef.current.isChestHit(localX, localY)
    }

    const w = el.clientWidth || 340
    const h = el.clientHeight || 440
    const chestCenterX = w / 2 + fallbackPan.x
    const chestCenterY = h / 2 + fallbackPan.y + 55 * fallbackZoom
    const halfW = 42 * fallbackZoom
    const halfH = 26 * fallbackZoom
    return (
      Math.abs(localX - chestCenterX) <= halfW &&
      localY >= chestCenterY - halfH &&
      localY <= chestCenterY + halfH
    )
  }

  const handlePointerDown = (e: React.PointerEvent): void => {
    if (e.button === 2 || e.button === 1 || (e.button === 0 && e.altKey)) {
      e.stopPropagation()
      isPanning.current = true
      lastPanPos.current = { x: e.clientX, y: e.clientY }
      return
    }

    if (e.button !== 0) return

    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const localX = e.clientX - rect.left
    const localY = e.clientY - rect.top

    const hit = checkHeadHit(e.clientX, e.clientY)
    if (!hit) {
      const chestHit = checkChestHit(e.clientX, e.clientY)
      if (!chestHit) {
        // Don't stop propagation: allows parent to drag the window
        return
      }

      // Chest hit: intercept pointer event and poke Roxy
      e.stopPropagation()
      // Poke and headpat are mutually exclusive: cancel any in-progress headpat.
      if (isHeadpattingRef.current) {
        isHeadpattingRef.current = false
        if (modelLoaded && controllerRef.current) {
          controllerRef.current.endHeadpat()
        } else {
          setIsHeadpattingFallback(false)
          setFallbackTilt(0)
        }
      }
      stopHeadpatAudio()
      isPokingRef.current = true
      pokeStartTimeRef.current = performance.now()
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        // ignore
      }

      if (modelLoaded && controllerRef.current) {
        controllerRef.current.startPoke(localX, localY)
      } else {
        setIsPokingFallback(true)
      }

      const now = performance.now()
      if (now - lastPokeAudioPlayTimeRef.current > 350) {
        lastPokeAudioPlayTimeRef.current = now
        void triggerPokeAudio()
      }
      return
    }

    // Head hit: intercept pointer event and pet Roxy
    e.stopPropagation()
    // Poke and headpat are mutually exclusive: cancel any in-progress poke.
    if (isPokingRef.current) {
      isPokingRef.current = false
      if (modelLoaded && controllerRef.current) {
        controllerRef.current.endPoke()
      } else {
        setIsPokingFallback(false)
      }
    } else if (controllerRef.current?.getIsPoking()) {
      controllerRef.current.endPoke()
    }
    stopPokeAudio()
    isHeadpattingRef.current = true
    headpatStartTimeRef.current = performance.now()
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch {
      // ignore
    }

    if (modelLoaded && controllerRef.current) {
      controllerRef.current.startHeadpat(localX, localY)
    } else {
      const w = el.clientWidth || 340
      const headCenterX = w / 2 + fallbackPan.x
      const halfW = 65 * fallbackZoom
      const relX = Math.max(-1, Math.min(1, (localX - headCenterX) / halfW))
      setFallbackTilt(relX * 3.5)
      setIsHeadpattingFallback(true)
    }

    const now = performance.now()
    if (now - lastAudioPlayTimeRef.current > 350) {
      lastAudioPlayTimeRef.current = now
      void triggerHeadpatAudio()
    }
  }

  const handlePointerMove = (e: React.PointerEvent): void => {
    if (isPanning.current) {
      const dx = e.clientX - lastPanPos.current.x
      const dy = e.clientY - lastPanPos.current.y
      lastPanPos.current = { x: e.clientX, y: e.clientY }
      controllerRef.current?.pan(dx, dy)
      setFallbackPan((p) => ({ x: p.x + dx, y: p.y + dy }))
      return
    }

    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const localX = e.clientX - rect.left
    const localY = e.clientY - rect.top

    if (isPokingRef.current) {
      e.stopPropagation()
      if (modelLoaded && controllerRef.current) {
        controllerRef.current.updatePoke(localX, localY)
      }

      // If user keeps poking, play the next voiceline after a cooldown
      const now = performance.now()
      if (now - lastPokeAudioPlayTimeRef.current > 3500 && !pokeAudioRef.current) {
        lastPokeAudioPlayTimeRef.current = now
        void triggerPokeAudio()
      }
      return
    }

    if (isHeadpattingRef.current) {
      e.stopPropagation()
      if (modelLoaded && controllerRef.current) {
        controllerRef.current.updateHeadpat(localX, localY)
      } else {
        const w = el.clientWidth || 340
        const headCenterX = w / 2 + fallbackPan.x
        const halfW = 65 * fallbackZoom
        const relX = Math.max(-1, Math.min(1, (localX - headCenterX) / halfW))
        setFallbackTilt(relX * 3.5)
      }

      // If user holds down and continues petting, play next voiceline after cooldown
      const now = performance.now()
      if (now - lastAudioPlayTimeRef.current > 3500 && !headpatAudioRef.current) {
        lastAudioPlayTimeRef.current = now
        void triggerHeadpatAudio()
      }
      return
    }

    // While poking (even without the button held via pulse), keep the reaction live to the mouse
    if (controllerRef.current?.getIsPoking()) {
      if (modelLoaded && controllerRef.current) {
        controllerRef.current.updatePoke(localX, localY)
      }
    }

    // Update hover state
    const hovered = checkHeadHit(e.clientX, e.clientY)
    setIsHeadHovered(hovered)
    setIsChestHovered(!hovered && checkChestHit(e.clientX, e.clientY))

    if (controllerRef.current?.getIsPoking()) return

    if (!followCursor) return
    if (!controllerRef.current) return
    const head = controllerRef.current.getHeadPosition()
    const dx = e.clientX - rect.left - head.x
    const dy = e.clientY - rect.top - head.y
    const distance = Math.hypot(dx, dy)
    if (distance < 2) {
      controllerRef.current.setGaze(0, 0)
      return
    }
    const maxRadius = Math.max(160, rect.width * 0.5)
    const factor = Math.min(1.0, distance / maxRadius)
    controllerRef.current.setGaze((dx / distance) * factor, -((dy / distance) * factor))
  }

  const handlePointerUp = (e: React.PointerEvent): void => {
    if (isPanning.current) {
      isPanning.current = false
    }

    if (isPokingRef.current) {
      e.stopPropagation()
      isPokingRef.current = false
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }

      const heldDuration = performance.now() - pokeStartTimeRef.current
      const el = containerRef.current
      const localX = el ? e.clientX - el.getBoundingClientRect().left : undefined
      const localY = el ? e.clientY - el.getBoundingClientRect().top : undefined

      if (modelLoaded && controllerRef.current) {
        if (heldDuration < 300) {
          controllerRef.current.pulsePoke(1200, localX, localY)
        } else {
          controllerRef.current.endPoke()
        }
      } else {
        if (heldDuration < 300) {
          setTimeout(() => {
            setIsPokingFallback(false)
          }, 1200)
        } else {
          setIsPokingFallback(false)
        }
      }
    }

    if (isHeadpattingRef.current) {
      e.stopPropagation()
      isHeadpattingRef.current = false
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {
        // ignore
      }

      const heldDuration = performance.now() - headpatStartTimeRef.current
      const el = containerRef.current
      const localX = el ? e.clientX - el.getBoundingClientRect().left : undefined
      const localY = el ? e.clientY - el.getBoundingClientRect().top : undefined

      if (modelLoaded && controllerRef.current) {
        if (heldDuration < 300) {
          controllerRef.current.pulseHeadpat(1300, localX, localY)
        } else {
          controllerRef.current.endHeadpat()
        }
      } else {
        if (heldDuration < 300) {
          setTimeout(() => {
            setIsHeadpattingFallback(false)
            setFallbackTilt(0)
          }, 1300)
        } else {
          setIsHeadpattingFallback(false)
          setFallbackTilt(0)
        }
      }
    }
  }

  const handlePointerCancel = (e: React.PointerEvent): void => {
    handlePointerUp(e)
  }

  const handleContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
  }

  useEffect(() => {
    controllerRef.current?.setFollowCursor(followCursor)
  }, [followCursor])

  // Screen-wide cursor tracking across entire monitor / multi-monitor desktop
  useEffect(() => {
    if (!followCursor || !api?.screen?.onCursorPosition) return

    void api.screen.startCursorTracking?.()

    const unlisten = api.screen.onCursorPosition((point) => {
      if (!containerRef.current || !controllerRef.current) return
      if (isPanning.current || isHeadpattingRef.current || controllerRef.current.getIsHeadpatting())
        return

      const rect = containerRef.current.getBoundingClientRect()
      const winX = window.screenX ?? (window as any).screenLeft ?? 0
      const winY = window.screenY ?? (window as any).screenTop ?? 0

      const head = controllerRef.current.getHeadPosition()
      const centerX = winX + rect.left + head.x
      const centerY = winY + rect.top + head.y

      const dx = point.x - centerX
      const dy = point.y - centerY
      const distance = Math.hypot(dx, dy)

      if (distance < 2) {
        controllerRef.current.setGaze(0, 0)
        return
      }

      const maxRadius = 550
      const factor = Math.min(1.0, distance / maxRadius)
      const targetX = (dx / distance) * factor
      const targetY = -((dy / distance) * factor)

      controllerRef.current.setGaze(targetX, targetY)
    })

    return () => {
      unlisten()
      void api.screen.stopCursorTracking?.()
    }
  }, [followCursor])

  // Load Live2D model when possible
  useEffect(() => {
    let unmounted = false
    const activePath = resolveModelUrl(modelPath?.trim() || DEFAULT_LIVE2D_MODEL)

    async function initLive2d(): Promise<void> {
      if (!canvasRef.current) return

      const ready = await ensureLive2dLoaded()
      if (!ready || unmounted) return

      const w = window as any
      if (!w.PIXI?.Application) return

      try {
        if (!pixiAppRef.current) {
          const initW = containerRef.current?.clientWidth || 340
          const initH = containerRef.current?.clientHeight || 440
          const app = new w.PIXI.Application({
            view: canvasRef.current,
            transparent: true,
            backgroundAlpha: 0,
            autoStart: true,
            width: initW,
            height: initH,
            antialias: true
          })
          pixiAppRef.current = app
        }

        const controller = new Live2dModelController(pixiAppRef.current, activePath)
        controller.setOnHeadMove(onHeadMove ?? null)
        controller.setFollowCursor(followCursor)
        const success = await controller.load()
        if (unmounted) {
          controller.destroy()
          return
        }

        if (success) {
          controllerRef.current = controller
          controller.setBlush(blush)
          onControllerReady?.(controller)
          setModelLoaded(true)
        }
      } catch (err) {
        console.warn('[Live2D] Failed to create canvas application:', err)
      }
    }

    void initLive2d()

    return () => {
      unmounted = true
      if (headpatAudioRef.current) {
        try {
          headpatAudioRef.current.pause()
          headpatAudioRef.current.src = ''
        } catch {
          // ignore
        }
        headpatAudioRef.current = null
      }
      if (pokeAudioRef.current) {
        try {
          pokeAudioRef.current.pause()
          pokeAudioRef.current.src = ''
        } catch {
          // ignore
        }
        pokeAudioRef.current = null
      }
      if (controllerRef.current) {
        controllerRef.current.destroy()
        controllerRef.current = null
        onControllerReady?.(null)
      }
      if (pixiAppRef.current) {
        pixiAppRef.current.destroy(false, { children: true })
        pixiAppRef.current = null
      }
    }
  }, [modelPath])

  useEffect(() => {
    controllerRef.current?.setOnHeadMove(onHeadMove ?? null)
  }, [onHeadMove])

  // Fallback avatar head position sync
  useEffect(() => {
    if (modelLoaded || !onHeadMove) return
    const w = containerRef.current?.clientWidth || 340
    const h = containerRef.current?.clientHeight || 440
    onHeadMove({
      x: w / 2 + fallbackPan.x,
      y: h / 2 + fallbackPan.y - 120 * fallbackZoom,
      width: 120 * fallbackZoom,
      height: 80 * fallbackZoom
    })
  }, [modelLoaded, fallbackZoom, fallbackPan, onHeadMove])

  // Handle container and window resize
  useEffect(() => {
    if (!containerRef.current) return

    const handleResize = (): void => {
      if (!containerRef.current || !pixiAppRef.current) return
      const w = containerRef.current.clientWidth || 340
      const h = containerRef.current.clientHeight || 440
      if (w > 0 && h > 0) {
        try {
          pixiAppRef.current.renderer?.resize(w, h)
          controllerRef.current?.resize()
        } catch {
          // ignore
        }
      }
    }

    const ro = new ResizeObserver(() => {
      handleResize()
    })
    ro.observe(containerRef.current)
    window.addEventListener('resize', handleResize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [modelLoaded])

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      className={`relative flex h-full w-full items-center justify-center overflow-hidden select-none ${
        isHeadpattingRef.current || isPokingRef.current
          ? 'cursor-grabbing'
          : isHeadHovered || isChestHovered
            ? 'cursor-grab'
            : ''
      } ${className}`}
    >
      <canvas
        ref={canvasRef}
        className={`w-full h-full block ${modelLoaded ? 'opacity-100' : 'opacity-0 pointer-events-none absolute'}`}
      />

      {/* Fallback Animated VTuber Avatar */}
      {!modelLoaded && (
        <div
          className="flex h-full w-full flex-col items-center justify-center p-4 transition-transform duration-75"
          style={{
            transform: `translate(${fallbackPan.x}px, ${fallbackPan.y}px) scale(${fallbackZoom})`,
            transformOrigin: 'center center'
          }}
        >
          <svg viewBox="0 0 200 240" className="max-h-[85%] max-w-[85%] drop-shadow-xl">
            {/* Hair back */}
            <path d="M30 110 C 20 180, 40 230, 60 235 C 50 180, 55 120, 65 110 Z" fill="#5b78a7" />
            <path
              d="M170 110 C 180 180, 160 230, 140 235 C 150 180, 145 120, 135 110 Z"
              fill="#5b78a7"
            />

            {/* Neck & Shoulders (leans away when poked on the chest) */}
            <g
              style={{
                transform: isPokingFallback ? 'rotate(3deg) translateX(2px)' : 'none',
                transformOrigin: '100px 190px',
                transition: isPokingFallback
                  ? 'transform 0.12s ease-out'
                  : 'transform 0.5s ease-in-out'
              }}
            >
              <path d="M75 160 L 125 160 L 140 230 L 60 230 Z" fill="#2d3748" />
              <path d="M85 145 L 115 145 L 110 170 L 90 170 Z" fill="#fed7aa" />
            </g>

            {/* Head group: tilts gently side-to-side relative to mouse without moving body */}
            <g
              style={{
                transform: isHeadpattingFallback ? `rotate(${fallbackTilt || 2.5}deg)` : 'none',
                transformOrigin: '100px 135px',
                transition: isHeadpattingRef.current
                  ? 'transform 0.12s ease-out'
                  : 'transform 0.6s ease-in-out'
              }}
            >
              {/* Face base */}
              <path
                d="M60 85 C 60 145, 90 165, 100 165 C 110 165, 140 145, 140 85 C 140 40, 60 40, 60 85 Z"
                fill="#ffedd5"
              />

              {/* Left Eye */}
              <g transform="translate(78, 100)">
                {isHeadpattingFallback ? (
                  <>
                    <path
                      d="M -8 1 Q 0 -6 8 1"
                      stroke="#1e3a8a"
                      strokeWidth="3"
                      fill="none"
                      strokeLinecap="round"
                    />
                    <path
                      d="M -10 -16 Q 0 -20 10 -15"
                      stroke="#475569"
                      strokeWidth="2"
                      fill="none"
                    />
                  </>
                ) : blinkValue > 0.3 ? (
                  <>
                    <ellipse cx="0" cy="0" rx="8" ry="12" fill="#1e3a8a" />
                    <ellipse cx="0" cy="2" rx="6" ry="9" fill="#3b82f6" />
                    <circle cx="-2" cy="-4" r="3" fill="#ffffff" />
                    <circle cx="2" cy="3" r="1.5" fill="#ffffff" />
                    {/* Eyebrow */}
                    <path
                      d="M -10 -16 Q 0 -20 10 -15"
                      stroke="#475569"
                      strokeWidth="2"
                      fill="none"
                    />
                  </>
                ) : (
                  <path d="M -8 0 Q 0 4 8 0" stroke="#1e293b" strokeWidth="3" fill="none" />
                )}
              </g>

              {/* Right Eye */}
              <g transform="translate(122, 100)">
                {isHeadpattingFallback ? (
                  <>
                    <path
                      d="M -8 1 Q 0 -6 8 1"
                      stroke="#1e3a8a"
                      strokeWidth="3"
                      fill="none"
                      strokeLinecap="round"
                    />
                    <path
                      d="M -10 -15 Q 0 -20 10 -16"
                      stroke="#475569"
                      strokeWidth="2"
                      fill="none"
                    />
                  </>
                ) : blinkValue > 0.3 ? (
                  <>
                    <ellipse cx="0" cy="0" rx="8" ry="12" fill="#1e3a8a" />
                    <ellipse cx="0" cy="2" rx="6" ry="9" fill="#3b82f6" />
                    <circle cx="-2" cy="-4" r="3" fill="#ffffff" />
                    <circle cx="2" cy="3" r="1.5" fill="#ffffff" />
                    {/* Eyebrow */}
                    <path
                      d="M -10 -15 Q 0 -20 10 -16"
                      stroke="#475569"
                      strokeWidth="2"
                      fill="none"
                    />
                  </>
                ) : (
                  <path d="M -8 0 Q 0 4 8 0" stroke="#1e293b" strokeWidth="3" fill="none" />
                )}
              </g>

              {/* Blush */}
              <ellipse
                cx="72"
                cy="115"
                rx={isHeadpattingFallback ? 9 : 6}
                ry={isHeadpattingFallback ? 5 : 3}
                fill="#f43f5e"
                opacity={isHeadpattingFallback ? 0.75 : 0.4}
              />
              <ellipse
                cx="128"
                cy="115"
                rx={isHeadpattingFallback ? 9 : 6}
                ry={isHeadpattingFallback ? 5 : 3}
                fill="#f43f5e"
                opacity={isHeadpattingFallback ? 0.75 : 0.4}
              />

              {/* Nose */}
              <circle cx="100" cy="118" r="1.5" fill="#fca5a5" />

              {/* Mouth with real-time lip-sync mouth flap */}
              <g transform="translate(100, 138)">
                {mouthOpen > 0.1 ? (
                  <path
                    d={`M -${8 + mouthOpen * 4} 0 Q 0 ${mouthOpen * 22} ${8 + mouthOpen * 4} 0 Z`}
                    fill="#e11d48"
                  />
                ) : isHeadpattingFallback ? (
                  <path
                    d="M -7 -1 Q 0 4 7 -1"
                    stroke="#be123c"
                    strokeWidth="2.5"
                    fill="none"
                    strokeLinecap="round"
                  />
                ) : (
                  <path d="M -6 0 Q 0 3 6 0" stroke="#be123c" strokeWidth="2" fill="none" />
                )}
              </g>

              {/* Hair bangs / front */}
              <path
                d="M55 75 C 55 35, 145 35, 145 75 C 135 60, 125 70, 115 65 C 105 75, 95 65, 85 70 C 75 60, 65 70, 55 75 Z"
                fill="#6b8bc2"
              />
              {/* Side bangs */}
              <path d="M 58 75 Q 52 115 56 140 Q 64 125 64 90 Z" fill="#6b8bc2" />
              <path d="M 142 75 Q 148 115 144 140 Q 136 125 136 90 Z" fill="#6b8bc2" />
            </g>
          </svg>

          <span className="text-[11px] text-text-muted mt-2 font-mono">
            {activePath.split('/').pop()?.split('.')[0] || 'Roxy VTuber'}
          </span>
        </div>
      )}
    </div>
  )
}
