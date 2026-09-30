import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui'

const PREVIEW_SIZE = 240
const OUTPUT_SIZE = 256

interface Props {
  file: File
  onApply: (dataUrl: string) => void
  onCancel: () => void
}

export function ProfileImageCropper({ file, onApply, onCancel }: Props): JSX.Element {
  const { t } = useTranslation()
  const [image, setImage] = useState<{ url: string; width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null)
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => setImage({ url, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => cancelRef.current()
    img.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  const baseScale = image ? Math.max(PREVIEW_SIZE / image.width, PREVIEW_SIZE / image.height) : 1
  const width = image ? image.width * baseScale * zoom : PREVIEW_SIZE
  const height = image ? image.height * baseScale * zoom : PREVIEW_SIZE
  const clamp = (x: number, y: number): { x: number; y: number } => ({
    x: Math.max((PREVIEW_SIZE - width) / 2, Math.min((width - PREVIEW_SIZE) / 2, x)),
    y: Math.max((PREVIEW_SIZE - height) / 2, Math.min((height - PREVIEW_SIZE) / 2, y))
  })

  const move = (event: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    setOffset(
      clamp(
        drag.current.originX + event.clientX - drag.current.x,
        drag.current.originY + event.clientY - drag.current.y
      )
    )
  }

  const apply = (): void => {
    if (!image) return
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT_SIZE
      canvas.height = OUTPUT_SIZE
      const context = canvas.getContext('2d')
      if (!context) return
      const scale = width / image.width
      const side = PREVIEW_SIZE / scale
      context.drawImage(
        img,
        (image.width - side) / 2 - offset.x / scale,
        (image.height - side) / 2 - offset.y / scale,
        side,
        side,
        0,
        0,
        OUTPUT_SIZE,
        OUTPUT_SIZE
      )
      onApply(canvas.toDataURL('image/png'))
    }
    img.src = image.url
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface-2 p-4">
      <div className="text-sm font-medium text-text">{t('settings.profile.cropTitle')}</div>
      <p className="mt-1 text-xs text-text-muted">{t('settings.profile.cropDescription')}</p>
      <div
        className="relative mx-auto mt-4 h-[240px] w-[240px] touch-none overflow-hidden rounded-xl bg-bg cursor-grab active:cursor-grabbing"
        role="img"
        aria-label={t('settings.profile.cropPreview')}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            originX: offset.x,
            originY: offset.y
          }
        }}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        {image && (
          <img
            src={image.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{
              width,
              height,
              left: (PREVIEW_SIZE - width) / 2 + offset.x,
              top: (PREVIEW_SIZE - height) / 2 + offset.y
            }}
          />
        )}
      </div>
      <label className="mx-auto mt-4 flex max-w-[240px] items-center gap-3 text-xs text-text-muted">
        {t('settings.profile.zoom')}
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(event) => {
            if (!image) return
            const next = Number(event.target.value)
            setOffset({
              x: Math.max(
                (PREVIEW_SIZE - image.width * baseScale * next) / 2,
                Math.min((image.width * baseScale * next - PREVIEW_SIZE) / 2, offset.x)
              ),
              y: Math.max(
                (PREVIEW_SIZE - image.height * baseScale * next) / 2,
                Math.min((image.height * baseScale * next - PREVIEW_SIZE) / 2, offset.y)
              )
            })
            setZoom(next)
          }}
          disabled={!image}
          className="min-w-0 flex-1 accent-accent"
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('settings.profile.cancelCrop')}
        </Button>
        <Button type="button" disabled={!image} onClick={apply}>
          {t('settings.profile.applyCrop')}
        </Button>
      </div>
    </div>
  )
}
