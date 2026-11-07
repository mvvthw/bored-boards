import type { Crop, ImageItem } from '../lib/types'
import { clamp, drag } from '../lib/drag'
import { CroppedImage } from './ItemViews'
import { FULL_CROP } from '../lib/types'

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const MIN = 0.04
const CURSOR: Record<Handle, string> = {
  move: 'move',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
}

/** Full extent of the source image in world space, given an item's current crop. */
export function fullFrame(item: ImageItem) {
  const iw = item.w / item.crop.w
  const ih = item.h / item.crop.h
  return { x: item.x - item.crop.x * iw, y: item.y - item.crop.y * ih, w: iw, h: ih }
}

export function applyCrop(item: ImageItem, d: Crop): ImageItem {
  const F = fullFrame(item)
  return { ...item, x: F.x + d.x * F.w, y: F.y + d.y * F.h, w: d.w * F.w, h: d.h * F.h, crop: d }
}

export default function CropOverlay({
  item,
  draft,
  setDraft,
  zoom,
}: {
  item: ImageItem
  draft: Crop
  setDraft: (c: Crop) => void
  zoom: number
}) {
  const F = fullFrame(item)

  const start = (h: Handle) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const d0 = draft
    drag(
      e,
      (dx, dy) => {
        const nx = dx / zoom / F.w
        const ny = dy / zoom / F.h
        let { x, y, w, h: hh } = d0
        if (h === 'move') {
          x = clamp(d0.x + nx, 0, 1 - d0.w)
          y = clamp(d0.y + ny, 0, 1 - d0.h)
        } else {
          if (h.includes('w')) {
            x = clamp(d0.x + nx, 0, d0.x + d0.w - MIN)
            w = d0.x + d0.w - x
          }
          if (h.includes('e')) w = clamp(d0.w + nx, MIN, 1 - d0.x)
          if (h.includes('n')) {
            y = clamp(d0.y + ny, 0, d0.y + d0.h - MIN)
            hh = d0.y + d0.h - y
          }
          if (h.includes('s')) hh = clamp(d0.h + ny, MIN, 1 - d0.y)
        }
        setDraft({ x, y, w, h: hh })
      },
      undefined,
      0,
      CURSOR[h],
    )
  }

  return (
    <div className="crop-frame" style={{ left: F.x, top: F.y, width: F.w, height: F.h }} onPointerDown={(e) => e.stopPropagation()}>
      <div className="crop-dim">
        <CroppedImage item={item} crop={FULL_CROP} w={F.w} h={F.h} />
      </div>
      <div
        className="crop-window"
        style={{ left: draft.x * F.w, top: draft.y * F.h, width: draft.w * F.w, height: draft.h * F.h }}
        onPointerDown={start('move')}
      >
        <CroppedImage item={item} crop={draft} w={draft.w * F.w} h={draft.h * F.h} />
        <div className="crop-grid" />
        {HANDLES.map((h) => (
          <div key={h} className={`crop-handle ch-${h}`} onPointerDown={start(h)} />
        ))}
      </div>
    </div>
  )
}
