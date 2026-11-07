import { createContext, useContext, useEffect, useLayoutEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/* ---------- presence: keep things mounted while they animate out ---------- */

export const EXIT_MS = 180
const LeavingCtx = createContext(false)
/** True while the surrounding <Presence> is playing this content's exit. Add a `leaving` class with it. */
export const useLeaving = () => useContext(LeavingCtx)

type Entry = { id: string; node: ReactNode; timer: number }

/**
 * Renders `children` while `id` is non-null. When `id` changes or goes null, the last content stays
 * mounted (frozen, marked leaving) for `ms` so it can animate out, while new content animates in.
 */
export function Presence({ id, children, ms = EXIT_MS }: { id: string | null; children?: ReactNode; ms?: number }) {
  const live = useRef<Entry | null>(null)
  const leaving = useRef<Entry[]>([])
  const [, bump] = useReducer((n: number) => n + 1, 0)

  if (live.current && live.current.id !== id) {
    const out = live.current
    leaving.current = [...leaving.current.filter((l) => l.id !== out.id), { ...out, timer: 0 }]
    live.current = null
  }
  if (id !== null) {
    // Coming back before the exit finished cancels it.
    leaving.current = leaving.current.filter((l) => {
      if (l.id !== id) return true
      clearTimeout(l.timer)
      return false
    })
    live.current = { id, node: children, timer: 0 }
  }

  useEffect(() => {
    for (const l of leaving.current) {
      if (l.timer) continue
      l.timer = window.setTimeout(() => {
        leaving.current = leaving.current.filter((x) => x !== l)
        bump()
      }, ms)
    }
  })
  useEffect(
    () => () =>
      leaving.current.forEach((l) => {
        clearTimeout(l.timer)
        l.timer = 0
      }),
    [],
  )

  return (
    <>
      {leaving.current.map((l) => (
        <LeavingCtx.Provider key={'out:' + l.id} value={true}>
          {l.node}
        </LeavingCtx.Provider>
      ))}
      {live.current && (
        <LeavingCtx.Provider key={'in:' + live.current.id} value={false}>
          {live.current.node}
        </LeavingCtx.Provider>
      )}
    </>
  )
}

export const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

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
  return (
    <Presence id={open ? 'dialog' : null}>
      <DialogFrame onClose={onClose}>{children}</DialogFrame>
    </Presence>
  )
}

function DialogFrame({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const leaving = useLeaving()
  return createPortal(
    <div className={`dialog-backdrop${leaving ? ' leaving' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog glass">{children}</div>
    </div>,
    document.body,
  )
}

export type MenuItem = { label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void }

export function Menu({ anchor, items, header, onClose }: { anchor: DOMRect; items: MenuItem[]; header?: string; onClose: () => void }) {
  const leaving = useLeaving()
  useEffect(() => {
    if (leaving) return
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
  }, [onClose, leaving])
  const left = Math.min(anchor.right - 200, window.innerWidth - 216)
  return createPortal(
    <div className={`menu glass${leaving ? ' leaving' : ''}`} style={{ top: anchor.bottom + 6, left: Math.max(16, left) }} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
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

type Toast = { id: number; text: string; leaving?: boolean }
let push: (t: string) => void = () => {}
export const toast = (text: string) => push(text)

export function Toaster() {
  const [list, setList] = useState<Toast[]>([])
  useEffect(() => {
    push = (text) => {
      const id = Date.now() + Math.random()
      setList((l) => [...l, { id, text }])
      setTimeout(() => setList((l) => l.map((t) => (t.id === id ? { ...t, leaving: true } : t))), 3000)
      setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3000 + EXIT_MS)
    }
  }, [])
  return createPortal(
    <div className="toaster">
      {list.map((t) => (
        <div key={t.id} className={`toast glass${t.leaving ? ' leaving' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>,
    document.body,
  )
}
