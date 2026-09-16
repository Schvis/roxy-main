import { useEffect, useState } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { api } from '../lib/api'
import { cn } from '../lib/cn'

export function WindowControls({ className }: { className?: string }): JSX.Element | null {
  const [isMaximized, setIsMaximized] = useState(false)
  const isMac = document.documentElement.dataset.platform === 'darwin'

  useEffect(() => {
    let alive = true
    void api.windowIsMaximized().then((max) => {
      if (alive) setIsMaximized(max)
    })
    const onResize = (): void => {
      void api.windowIsMaximized().then((max) => {
        if (alive) setIsMaximized(max)
      })
    }
    window.addEventListener('resize', onResize)
    return () => {
      alive = false
      window.removeEventListener('resize', onResize)
    }
  }, [])

  // On macOS, native traffic lights are rendered on top-left.
  if (isMac) return null

  return (
    <div
      className={cn('flex items-center h-full', className)}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={() => void api.windowMinimize()}
        title="Minimize"
        aria-label="Minimize"
        className="flex h-full w-10 items-center justify-center text-text-muted transition-colors hover:bg-white/10 hover:text-text focus-visible:outline-none"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => {
          void api.windowMaximize().then(() => {
            void api.windowIsMaximized().then(setIsMaximized)
          })
        }}
        title={isMaximized ? 'Restore' : 'Maximize'}
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        className="flex h-full w-10 items-center justify-center text-text-muted transition-colors hover:bg-white/10 hover:text-text focus-visible:outline-none"
      >
        {isMaximized ? <Copy className="h-3 w-3 -scale-y-100" /> : <Square className="h-3 w-3" />}
      </button>
      <button
        type="button"
        onClick={() => void api.windowClose()}
        title="Close"
        aria-label="Close"
        className="flex h-full w-10 items-center justify-center text-text-muted transition-colors hover:bg-danger hover:text-white focus-visible:outline-none"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
