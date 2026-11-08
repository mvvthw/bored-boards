import { memo, useLayoutEffect, useRef } from 'react'
import type { Item, NoteItem } from '../lib/types'
import { CroppedImage, NOTE_FONT, NoteBody } from './ItemViews'
import { prefersReducedMotion } from './ui'

export type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se' | 'e' | 'w'

type Props = {
  item: Item
  selected: boolean
  solo: boolean // the only selected item → resizable
  editing: boolean
  hidden: boolean
  appear: boolean // added after the board loaded → animate in
  dimmed: boolean // filtered out by the tag filter
  magnet: boolean // image a note will snap onto
  pulse: boolean // note that just attached
  onPointerDown: (e: React.PointerEvent, item: Item) => void
  onDoubleClick: (item: Item) => void
  onResizeStart: (e: React.PointerEvent, item: Item, h: ResizeHandle) => void
  onText: (id: string, text: string) => void
  onEditEnd: (id: string) => void
  onMeasure: (id: string, h: number) => void
}

function CanvasItem(p: Props) {
  const { item } = p
  const ref = useRef<HTMLDivElement>(null)

  // Notes size to their text; report height so selection & thumbnails stay accurate.
  useLayoutEffect(() => {
    if (item.type !== 'note' || !ref.current) return
    const el = ref.current
    const ro = new ResizeObserver(() => p.onMeasure(item.id, el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [item.type, item.id, p.onMeasure])

  // New items settle in. WAAPI keeps this independent of the CSS attach-snap animation.
  useLayoutEffect(() => {
    if (!p.appear || !ref.current || prefersReducedMotion()) return
    ref.current.animate([{ opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1 }], { duration: 280, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Invisible grab zones on the corners (images) or sides (notes); the cursor shows they're there.
  const handles: ResizeHandle[] = item.type === 'image' ? ['nw', 'ne', 'sw', 'se'] : ['w', 'e']

  return (
    <div
      ref={ref}
      data-id={item.id}
      className={`item item-${item.type}${p.selected ? ' selected' : ''}${p.editing ? ' editing' : ''}${p.magnet ? ' magnet' : ''}${p.dimmed ? ' dimmed' : ''}${p.pulse ? ' pulse' : ''}`}
      style={{
        left: item.x,
        top: item.y,
        width: item.w,
        height: item.type === 'image' ? item.h : undefined,
        zIndex: item.z,
        visibility: p.hidden ? 'hidden' : undefined,
      }}
      onPointerDown={(e) => p.onPointerDown(e, item)}
      onDoubleClick={(e) => {
        e.stopPropagation()
        p.onDoubleClick(item)
      }}
    >
      {item.type === 'image' ? (
        <>
          <CroppedImage item={item} fade />
          {item.tags.length > 0 && (
            <div className="item-tags">
              {item.tags.map((t) => (
                <span key={t} className="item-tag">
                  {t}
                </span>
              ))}
            </div>
          )}
        </>
      ) : p.editing ? (
        <NoteEditor item={item} onText={p.onText} onEnd={p.onEditEnd} />
      ) : (
        <NoteBody item={item} />
      )}
      <div className="sel-outline" />
      {p.solo && !p.editing && handles.map((h) => <div key={h} className={`handle h-${h}`} onPointerDown={(e) => p.onResizeStart(e, item, h)} />)}
    </div>
  )
}

function NoteEditor({ item, onText, onEnd }: { item: NoteItem; onText: (id: string, t: string) => void; onEnd: (id: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current!
    el.style.height = '0px'
    el.style.height = el.scrollHeight + 'px'
  }, [item.text, item.w, item.size])
  useLayoutEffect(() => {
    const el = ref.current!
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])
  return (
    <textarea
      ref={ref}
      className={`note-body note-${item.style} note-editor`}
      style={{ fontSize: NOTE_FONT[item.size] }}
      value={item.text}
      placeholder="What do you like about this?"
      onPointerDown={(e) => e.stopPropagation()}
      onChange={(e) => onText(item.id, e.target.value)}
      onBlur={() => onEnd(item.id)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) ref.current?.blur()
      }}
    />
  )
}

export default memo(CanvasItem)
