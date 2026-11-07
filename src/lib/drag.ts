/** Hold one cursor everywhere for the length of a gesture, so it can't flicker as the pointer crosses other elements. */
export function lockCursor(cursor: string | undefined) {
  const root = document.documentElement
  if (!cursor) {
    root.classList.remove('cursor-locked')
    root.style.removeProperty('--locked-cursor')
    return
  }
  root.style.setProperty('--locked-cursor', cursor)
  root.classList.add('cursor-locked')
}

/**
 * Track a pointer drag in screen pixels. `end(moved)` fires on release.
 * `cursor` is held app-wide from the first movement until release.
 */
export function drag(
  e: { clientX: number; clientY: number; pointerId?: number },
  move: (dx: number, dy: number, ev: PointerEvent) => void,
  end?: (moved: boolean, ev: PointerEvent) => void,
  threshold = 3,
  cursor?: string,
) {
  const sx = e.clientX
  const sy = e.clientY
  let moved = false
  const onMove = (ev: PointerEvent) => {
    const dx = ev.clientX - sx
    const dy = ev.clientY - sy
    if (!moved && Math.hypot(dx, dy) < threshold) return
    if (!moved) lockCursor(cursor)
    moved = true
    move(dx, dy, ev)
  }
  const onUp = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    if (moved) lockCursor(undefined)
    end?.(moved, ev)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
