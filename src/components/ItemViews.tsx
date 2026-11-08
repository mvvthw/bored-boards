import { createContext, useContext, useState } from 'react'
import type { Crop, ImageItem, Item, NoteItem } from '../lib/types'
import { useAssetUrl } from '../lib/hooks'
import { itemsBounds } from '../lib/db'

/** Whose storage folder an image without `assetOwner` lives in: the board's owner. */
export const AssetOwnerCtx = createContext<string | undefined>(undefined)

/** `fade`: fade the picture in once it has loaded (canvas items; copies of an on-screen image shouldn't flash). */
export function CroppedImage({ item, crop = item.crop, w = item.w, h = item.h, fade = false }: { item: ImageItem; crop?: Crop; w?: number; h?: number; fade?: boolean }) {
  const boardOwner = useContext(AssetOwnerCtx)
  const url = useAssetUrl(item.assetId, item.src, item.assetOwner ?? boardOwner)
  const [loaded, setLoaded] = useState<string | null>(null)
  const iw = w / crop.w
  const ih = h / crop.h
  return (
    <div className="cropped" style={{ width: w, height: h }}>
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          decoding="async"
          className={fade ? `fade${loaded === url ? ' loaded' : ''}` : undefined}
          onLoad={fade ? () => setLoaded(url) : undefined}
          style={{ left: -crop.x * iw, top: -crop.y * ih, width: iw, height: ih }}
        />
      )}
    </div>
  )
}

export const NOTE_FONT = { s: 15, m: 20, l: 34 } as const

export function NoteBody({ item }: { item: NoteItem }) {
  return (
    <div className={`note-body note-${item.style}`} style={{ fontSize: NOTE_FONT[item.size] }}>
      {item.text || <span className="note-placeholder">Note</span>}
    </div>
  )
}

/** Static miniature of a board, scaled to fit its container. */
export function BoardThumb({ items, width, height }: { items: Item[]; width: number; height: number }) {
  const b = itemsBounds(items)
  if (!b) return null
  const pad = 0.1
  const scale = Math.min((width * (1 - pad * 2)) / b.w, (height * (1 - pad * 2)) / b.h, 0.6)
  const ox = (width - b.w * scale) / 2 - b.x * scale
  const oy = (height - b.h * scale) / 2 - b.y * scale
  const sorted = [...items].sort((a, b) => a.z - b.z)
  return (
    <div className="thumb-layer" style={{ transform: `translate(${ox}px, ${oy}px) scale(${scale})`, '--inv': 1 / scale } as React.CSSProperties}>
      {sorted.map((it) => (
        <div key={it.id} className="thumb-item" style={{ left: it.x, top: it.y, width: it.w, minHeight: it.h }}>
          {it.type === 'image' ? <CroppedImage item={it} /> : <NoteBody item={it} />}
        </div>
      ))}
    </div>
  )
}
