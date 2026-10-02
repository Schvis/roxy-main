export type ChatDock = 'left' | 'right' | 'bottom'

export function chatDockAtPoint(
  rect: { left: number; right: number; top: number; bottom: number; width: number; height: number },
  x: number,
  y: number
): ChatDock | null {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null
  if (y >= rect.top + rect.height * 0.75) return 'bottom'
  return x < rect.left + rect.width / 2 ? 'left' : 'right'
}
