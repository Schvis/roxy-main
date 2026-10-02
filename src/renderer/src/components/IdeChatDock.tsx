import type { HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { GripVertical } from 'lucide-react'

export type ChatDragProps = Pick<
  HTMLAttributes<HTMLButtonElement>,
  'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onLostPointerCapture' | 'onKeyDown'
> & { disabled?: boolean; pending?: boolean; error?: boolean }

export function IdeChatDrag({ pending, error, ...props }: ChatDragProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
      <button
        type="button"
        title={t('ide.dragChat')}
        aria-label={t('ide.dragChat')}
        className="flex h-7 w-7 touch-none items-center justify-center rounded-lg cursor-grab active:cursor-grabbing hover:bg-elevated hover:text-text focus-visible:outline-accent disabled:opacity-50"
        {...props}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {pending && <span role="status">{t('ide.saving')}</span>}
      {error && (
        <span role="alert" className="text-danger">
          {t('ide.dockError')}
        </span>
      )}
    </div>
  )
}
