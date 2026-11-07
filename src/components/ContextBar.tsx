import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  Copy,
  Crop as CropIcon,
  LayoutGrid,
  ZoomIn,
  ExternalLink,
  RotateCcw,
  StickyNote,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import type { Item, NoteItem, NoteSize, NoteStyle } from '../lib/types'
import { TAG_PRESETS } from '../lib/types'
import { TextField } from './ui'

type Common = {
  pos: { left: number; top: number; below: boolean }
}

export function CropBar({ pos, mode, onReset, onCancel, onDone }: Common & { mode: 'crop' | 'detail'; onReset: () => void; onCancel: () => void; onDone: () => void }) {
  return (
    <Bar pos={pos}>
      <span className="bar-label">{mode === 'detail' ? 'Frame the detail' : 'Crop'}</span>
      <Sep />
      <BarBtn icon={<RotateCcw size={16} />} label="Reset" onClick={onReset} />
      <BarBtn icon={<X size={16} />} label="Cancel" onClick={onCancel} />
      <button className="bar-btn bar-primary" onClick={onDone}>
        <Check size={16} strokeWidth={2.4} /> {mode === 'detail' ? 'Add Detail' : 'Done'}
      </button>
    </Bar>
  )
}

export function SelectionBar({
  pos,
  items,
  onCrop,
  onDetail,
  onTidy,
  onAddNote,
  onTags,
  onNote,
  onFront,
  onBack,
  onDuplicate,
  onDelete,
}: Common & {
  items: Item[]
  onCrop: () => void
  onDetail: () => void
  onTidy: () => void
  onAddNote: () => void
  onTags: (tags: string[]) => void
  onNote: (patch: Partial<Pick<NoteItem, 'style' | 'size'>>) => void
  onFront: () => void
  onBack: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const [tagsOpen, setTagsOpen] = useState(false)
  const solo = items.length === 1 ? items[0] : null

  useEffect(() => setTagsOpen(false), [solo?.id])

  return (
    <Bar pos={pos}>
      {!solo && <span className="bar-label">{items.length} selected</span>}
      {!solo && items.filter((i) => i.type === 'image').length > 1 && <BarBtn icon={<LayoutGrid size={16} />} label="Tidy" title="Arrange into neat rows" onClick={onTidy} />}

      {solo?.type === 'image' && (
        <>
          <BarBtn icon={<CropIcon size={16} />} label="Crop" onClick={onCrop} />
          <BarBtn icon={<ZoomIn size={16} />} label="Detail" title="Add a close-up, keep the full piece" onClick={onDetail} />
          <BarBtn icon={<Tag size={16} />} label="Tag" active={tagsOpen} onClick={() => setTagsOpen((v) => !v)} />
          <BarBtn icon={<StickyNote size={16} />} label="Note" onClick={onAddNote} />
          {solo.source && <BarBtn icon={<ExternalLink size={16} />} title="Open source" onClick={() => window.open(solo.source, '_blank', 'noopener')} />}
          {tagsOpen && <TagPicker tags={solo.tags} onChange={onTags} below={pos.below || pos.top < 330} />}
        </>
      )}

      {solo?.type === 'note' && (
        <>
          <Segmented<NoteStyle>
            value={solo.style}
            onChange={(style) => onNote({ style })}
            options={[
              { value: 'glass', label: <span className="swatch sw-glass" />, title: 'Glass' },
              { value: 'paper', label: <span className="swatch sw-paper" />, title: 'Paper' },
              { value: 'plain', label: <span className="swatch sw-plain">Aa</span>, title: 'Text only' },
            ]}
          />
          <Segmented<NoteSize>
            value={solo.size}
            onChange={(size) => onNote({ size })}
            options={[
              { value: 's', label: 'S' },
              { value: 'm', label: 'M' },
              { value: 'l', label: 'L' },
            ]}
          />
        </>
      )}

      <Sep />
      <BarBtn icon={<ArrowUpToLine size={16} />} title="Bring to front  ]" onClick={onFront} />
      <BarBtn icon={<ArrowDownToLine size={16} />} title="Send to back  [" onClick={onBack} />
      <BarBtn icon={<Copy size={16} />} title="Duplicate  ⌘D" onClick={onDuplicate} />
      <BarBtn icon={<Trash2 size={16} />} title="Delete  ⌫" onClick={onDelete} danger />
    </Bar>
  )
}

function TagPicker({ tags, onChange, below }: { tags: string[]; onChange: (t: string[]) => void; below: boolean }) {
  const [custom, setCustom] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const all = [...new Set([...TAG_PRESETS, ...tags])]
  const toggle = (t: string) => onChange(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])
  return (
    <div className={`tag-picker glass${below ? ' below' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="tag-picker-title">What caught your eye?</div>
      <div className="chips">
        {all.map((t) => (
          <button key={t} className={`chip${tags.includes(t) ? ' on' : ''}`} onClick={() => toggle(t)}>
            {t}
          </button>
        ))}
      </div>
      <form
        className="tag-custom"
        onSubmit={(e) => {
          e.preventDefault()
          const t = custom.trim()
          if (t && !tags.includes(t)) onChange([...tags, t])
          setCustom('')
          inputRef.current?.focus()
        }}
      >
        <TextField size="sm" inputRef={inputRef} placeholder="Custom tag…" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </form>
    </div>
  )
}

function Bar({ pos, children }: Common & { children: React.ReactNode }) {
  // Nudge sideways so the bar never runs off either edge of the canvas.
  const ref = useRef<HTMLDivElement>(null)
  const [shift, setShift] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return
    const half = el.offsetWidth / 2
    const min = 16 + half
    const max = parent.clientWidth - 16 - half
    setShift(Math.min(Math.max(pos.left, min), Math.max(min, max)) - pos.left)
  })
  return (
    <div
      ref={ref}
      className={`context-bar glass${pos.below ? ' below' : ''}`}
      style={{ left: pos.left + shift, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  )
}

function BarBtn({ icon, label, title, onClick, danger, active }: { icon: React.ReactNode; label?: string; title?: string; onClick: () => void; danger?: boolean; active?: boolean }) {
  return (
    <button className={`bar-btn${danger ? ' danger' : ''}${active ? ' active' : ''}${label ? '' : ' icon-only'}`} title={title ?? label} onClick={onClick}>
      {icon}
      {label && <span>{label}</span>}
    </button>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; title?: string }[] }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.value} title={o.title} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const Sep = () => <span className="bar-sep" />
