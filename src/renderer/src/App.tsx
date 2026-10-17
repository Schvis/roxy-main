import { lazy, Suspense, useEffect, useState, useRef } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useRoxyStore } from './lib/store'
import roxy from './assets/roxy.png'
import overlayIcon from './assets/overlay.png'
import Onboarding from './routes/Onboarding'
import Chat from './routes/Chat'
import { ChatView } from './components/ChatView'
import { cn } from './lib/cn'
import { api } from './lib/api'
import { initTtsPlayer } from './lib/tts-player'

const Integrations = lazy(() => import('./routes/Integrations'))
const Skills = lazy(() => import('./routes/Skills'))
const Mcp = lazy(() => import('./routes/Mcp'))
const Themes = lazy(() => import('./routes/Themes'))
const Settings = lazy(() => import('./routes/Settings'))
const GitPage = lazy(() => import('./routes/GitPage'))
const VtuberStandalone = lazy(() =>
  import('./components/VtuberStandalone').then((module) => ({ default: module.VtuberStandalone }))
)
const StandaloneTerminal = lazy(() =>
  import('./components/StandaloneTerminal').then((module) => ({
    default: module.StandaloneTerminal
  }))
)

function FloatingIcon(): JSX.Element {
  const [isDragging, setIsDragging] = useState(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const hasMoved = useRef(false)
  const imgRef = useRef<HTMLImageElement>(null)

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return // Only left click
    setIsDragging(true)
    hasMoved.current = false
    lastPos.current = { x: e.screenX, y: e.screenY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    const dx = e.screenX - lastPos.current.x
    const dy = e.screenY - lastPos.current.y
    if (dx !== 0 || dy !== 0) {
      if (!hasMoved.current) {
        hasMoved.current = true
        void api.toggleOverlay(false)
      }
      void api.windowMove(dx, dy)
      lastPos.current = { x: e.screenX, y: e.screenY }
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const handleClick = () => {
    if (!hasMoved.current) {
      void api.toggleOverlay()
    }
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <img
        ref={imgRef}
        src={overlayIcon}
        alt="Roxy"
        className="h-20 w-20 drop-shadow-md hover:scale-105 transition-transform cursor-pointer select-none object-contain"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleClick}
        draggable={false}
      />
    </div>
  )
}

function Splash(): JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center bg-bg">
      <img
        src={roxy}
        alt="Roxy"
        className="h-14 w-14 animate-pulse sq sq-2xl rounded-2xl object-cover inset-ring-1 inset-ring-border"
      />
    </div>
  )
}

function LazyScreen({ children }: { children: React.ReactNode }): JSX.Element {
  return <Suspense fallback={<Splash />}>{children}</Suspense>
}

function ResizeHandle(): JSX.Element {
  const [isResizing, setIsResizing] = useState(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    setIsResizing(true)
    lastPos.current = { x: e.screenX, y: e.screenY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isResizing) return
    const dx = e.screenX - lastPos.current.x
    const dy = e.screenY - lastPos.current.y
    if (dx !== 0 || dy !== 0) {
      void api.windowResize(dx, dy)
      lastPos.current = { x: e.screenX, y: e.screenY }
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsResizing(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
      style={{ WebkitAppRegion: 'no-drag' } as any}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg viewBox="0 0 16 16" className="absolute bottom-1 right-1 h-2.5 w-2.5 text-text-muted/50">
        <path d="M16 16L16 0L0 16Z" fill="currentColor" />
      </svg>
    </div>
  )
}

function AppRoutes({ onboarded }: { onboarded: boolean }): JSX.Element {
  const { pathname } = useLocation()
  const chatVisible = onboarded && pathname === '/'
  const overlayVisible = onboarded && pathname === '/overlay'
  const floatingIconVisible = onboarded && pathname === '/floating-icon'
  const vtuberVisible = pathname === '/vtuber'
  const terminalVisible = pathname === '/terminal'
  const isAuxiliary = overlayVisible || floatingIconVisible || vtuberVisible || terminalVisible

  useEffect(() => {
    if (overlayVisible || floatingIconVisible || vtuberVisible) {
      document.documentElement.style.setProperty('background-color', 'transparent', 'important')
      document.body.style.setProperty('background-color', 'transparent', 'important')
    } else {
      document.documentElement.style.removeProperty('background-color')
      document.body.style.removeProperty('background-color')
    }
  }, [overlayVisible, floatingIconVisible, vtuberVisible])

  return (
    <div
      className={cn(
        'relative h-screen w-screen overflow-hidden text-text',
        overlayVisible || floatingIconVisible || vtuberVisible ? 'bg-transparent p-2' : 'bg-bg'
      )}
    >
      {/* Chat is the expensive screen: a cold mount rebuilds up to 30 markdown/tool
          messages, the whole sidebar, two ResizeObservers, and the transcript's
          scroll measurements before the first frame can paint. Settings used to
          replace this tree, so its Back button was synchronous but still looked
          frozen while all of that work ran again.

          Keep Chat mounted and laid out behind secondary routes instead.
          `visibility:hidden` suppresses paint, hit-testing, focus and accessibility
          exposure without `display:none`'s cold-layout penalty. Returning to `/`
          is now only a layer reveal, and component-local state such as transcript
          pagination and scroll position survives the trip. */}
      {onboarded && !isAuxiliary && (
        <div
          className={
            chatVisible ? 'absolute inset-0' : 'pointer-events-none invisible absolute inset-0'
          }
        >
          <Chat />
        </div>
      )}

      {onboarded && overlayVisible && (
        <div className="animate-modal-in absolute inset-2 z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl">
          <ChatView isOverlay />
          <ResizeHandle />
        </div>
      )}

      {onboarded && floatingIconVisible && (
        <div className="absolute inset-0 z-20">
          <FloatingIcon />
        </div>
      )}

      {vtuberVisible && (
        <div className="absolute inset-0 z-30 flex h-full w-full items-center justify-center bg-transparent overflow-visible">
          <LazyScreen>
            <VtuberStandalone />
          </LazyScreen>
        </div>
      )}

      {terminalVisible && (
        <div className="absolute inset-0 z-30 flex h-full w-full flex-col bg-bg">
          <LazyScreen>
            <StandaloneTerminal />
          </LazyScreen>
        </div>
      )}

      {!chatVisible && !isAuxiliary && (
        <div className="absolute inset-0 z-10 bg-bg">
          <Suspense fallback={<Splash />}>
            <Routes>
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/" element={onboarded ? null : <Navigate to="/onboarding" replace />} />
              <Route
                path="/overlay"
                element={onboarded ? null : <Navigate to="/onboarding" replace />}
              />
              <Route
                path="/floating-icon"
                element={onboarded ? null : <Navigate to="/onboarding" replace />}
              />
              <Route path="/vtuber" element={<VtuberStandalone />} />
              <Route path="/terminal" element={<StandaloneTerminal />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/mcp" element={<Mcp />} />
              <Route path="/themes" element={<Themes />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/git" element={<GitPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </div>
      )}
    </div>
  )
}

export default function App(): JSX.Element {
  const ready = useRoxyStore((s) => s.ready)
  const settings = useRoxyStore((s) => s.settings)
  const bootstrap = useRoxyStore((s) => s.bootstrap)
  const ensureModels = useRoxyStore((s) => s.ensureModels)
  const providers = useRoxyStore((s) => s.providers)

  useEffect(() => {
    bootstrap()
    initTtsPlayer()
  }, [bootstrap])

  useEffect(() => {
    const copilots = providers.filter((p) => p.seedId === 'github-copilot')
    if (!ready || !copilots.length) return
    const refresh = (): void => {
      if (document.visibilityState !== 'hidden') copilots.forEach((p) => void ensureModels(p.id))
    }
    refresh()
    const timer = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [ready, providers, ensureModels])

  if (!ready) return <Splash />

  const onboarded = settings?.onboardingCompleted ?? false

  return (
    <HashRouter>
      <AppRoutes onboarded={onboarded} />
    </HashRouter>
  )
}
