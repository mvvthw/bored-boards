import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLeaving } from './ui'

export type CtxEntry = { label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }
export type CtxItem = CtxEntry | 'sep'

/** A right-click menu at (x, y). Arrow keys + Enter work; it flips to stay on screen. */
export function ContextMenu({ x, y, items, title, onClose }: { x: number; y: number; items: CtxItem[]; title?: string; onClose: () => void }) {
  const leaving = useLeaving()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, origin: 'top left' })
  const entries = items.filter((i): i is CtxEntry => i !== 'sep')
  const [hi, _setHi] = useState(-1)
  const hiRef = useRef(-1)
  const setHi = (n: number) => {
    hiRef.current = n
    _setHi(n)
  }

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const right = x + w > window.innerWidth - 8
    const up = y + h > window.innerHeight - 8
    setPos({
      left: right ? Math.max(8, x - w) : x,
      top: up ? Math.max(8, y - h) : y,
      origin: `${up ? 'bottom' : 'top'} ${right ? 'right' : 'left'}`,
    })
  }, [x, y])

  useEffect(() => {
    if (leaving) return
    const close = (e: Event) => !ref.current?.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        const d = e.key === 'ArrowDown' ? 1 : -1
        let n = hiRef.current
        for (let k = 0; k < entries.length; k++) {
          n = (n + d + entries.length) % entries.length
          if (!entries[n].disabled) return setHi(n)
        }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        const it = entries[hiRef.current]
        if (it && !it.disabled) {
          onClose()
          it.onSelect()
        }
      }
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('wheel', close, { capture: true, passive: true })
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('wheel', close, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [leaving, onClose, entries])

  let n = -1
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className={`ctx-menu glass${leaving ? ' leaving' : ''}`}
      style={{ left: pos.left, top: pos.top, transformOrigin: pos.origin }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerLeave={() => setHi(-1)}
    >
      {title && <div className="ctx-title">{title}</div>}
      {items.map((it, i) => {
        if (it === 'sep') return <div key={'sep' + i} className="ctx-sep" />
        const idx = ++n
        return (
          <button
            key={it.label}
            role="menuitem"
            className={`ctx-item${it.danger ? ' danger' : ''}${idx === hi ? ' hi' : ''}`}
            disabled={it.disabled}
            onPointerEnter={() => !it.disabled && setHi(idx)}
            onClick={() => {
              onClose()
              it.onSelect()
            }}
          >
            <span className="ctx-icon">{it.icon}</span>
            <span className="ctx-label">{it.label}</span>
            {it.shortcut && <span className="ctx-shortcut">{it.shortcut}</span>}
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
