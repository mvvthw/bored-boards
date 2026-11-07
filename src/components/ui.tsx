import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size] as const
}

/** The single text input used everywhere: recessed pill with an optional leading icon. */
export function TextField({
  icon,
  size = 'md',
  inputRef,
  ...input
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & { icon?: ReactNode; size?: 'md' | 'sm'; inputRef?: React.Ref<HTMLInputElement> }) {
  return (
    <label className={`field${size === 'sm' ? ' field-sm' : ''}`}>
      {icon}
      <input ref={inputRef} spellCheck={false} {...input} />
    </label>
  )
}

export function Dialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog glass">{children}</div>
    </div>,
    document.body,
  )
}

export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void }

export function Menu({ anchor, items, header, onClose }: { anchor: DOMRect; items: MenuItem[]; header?: string; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
    }
  }, [onClose])
  const left = Math.min(anchor.right - 200, window.innerWidth - 216)
  return createPortal(
    <div className="menu glass" style={{ top: anchor.bottom + 6, left: Math.max(16, left) }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {header && <div className="menu-header">{header}</div>}
      {items.map((it) => (
        <button
          key={it.label}
          className={`menu-item${it.danger ? ' danger' : ''}`}
          onClick={() => {
            onClose()
            it.onSelect()
          }}
        >
          <span className="menu-icon">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}

/* ---------- toasts ---------- */

type Toast = { id: number; text: string }
let push: (t: string) => void = () => {}
export const toast = (text: string) => push(text)

export function Toaster() {
  const [list, setList] = useState<Toast[]>([])
  useEffect(() => {
    push = (text) => {
      const id = Date.now() + Math.random()
      setList((l) => [...l, { id, text }])
      setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3200)
    }
  }, [])
  return createPortal(
    <div className="toaster">
      {list.map((t) => (
        <div key={t.id} className="toast glass">
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  )
}
