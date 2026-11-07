import type { Item, NoteItem } from './types'
import { clamp } from './drag'
import { uid } from './db'

type Rect = { x: number; y: number; w: number; h: number }

const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y

/**
 * Size new images relative to what's on screen: a comfortable share of the viewport,
 * smaller when several arrive at once, and never upscaled past their real pixels.
 * Returns world-unit sizes laid out as a centered grid around `at`.
 */
export function layoutNewImages(
  imgs: { natW: number; natH: number }[],
  at: { x: number; y: number },
  view: { width: number; height: number; zoom: number },
) {
  const n = imgs.length
  const cols = n <= 4 ? n : Math.ceil(Math.sqrt(n * 1.4))
  const rows = Math.ceil(n / cols)
  const gapS = 20
  const base = clamp(Math.min(view.width, view.height) * 0.3, 160, 320)
  const fit = Math.min(1, (view.width * 0.85 - gapS * (cols - 1)) / (cols * base), (view.height * 0.7 - gapS * (rows - 1)) / (rows * base * 1.2))
  const target = base * fit

  const sized = imgs.map((im) => {
    const s = Math.min(target / im.natW, (target * 1.25) / im.natH, 1) / view.zoom // portrait gets a little extra height
    return { w: im.natW * s, h: im.natH * s }
  })

  const gap = gapS / view.zoom
  const rowsOut: { w: number; h: number }[][] = []
  for (let i = 0; i < n; i += cols) rowsOut.push(sized.slice(i, i + cols))
  const rowW = rowsOut.map((r) => r.reduce((a, s) => a + s.w, 0) + gap * (r.length - 1))
  const rowH = rowsOut.map((r) => Math.max(...r.map((s) => s.h)))
  const totalH = rowH.reduce((a, h) => a + h, 0) + gap * (rowsOut.length - 1)

  const out: Rect[] = []
  let y = at.y - totalH / 2
  rowsOut.forEach((r, ri) => {
    let x = at.x - rowW[ri] / 2
    for (const s of r) {
      out.push({ x, y: y + (rowH[ri] - s.h) / 2, w: s.w, h: s.h })
      x += s.w + gap
    }
    y += rowH[ri] + gap
  })
  return out
}

/** Nudge a group of rects outward from where it is until it doesn't sit on existing items. */
export function findFreeSpot(group: Rect[], items: Item[], zoom: number): Rect[] {
  if (!group.length || !items.length) return group
  const bx = Math.min(...group.map((r) => r.x))
  const by = Math.min(...group.map((r) => r.y))
  const b = { x: bx, y: by, w: Math.max(...group.map((r) => r.x + r.w)) - bx, h: Math.max(...group.map((r) => r.y + r.h)) - by }
  const gap = 24 / zoom
  const free = (dx: number, dy: number) => !items.some((i) => overlaps({ ...b, x: b.x + dx, y: b.y + dy }, i, gap))
  const shift = (dx: number, dy: number) => group.map((r) => ({ ...r, x: r.x + dx, y: r.y + dy }))
  if (free(0, 0)) return group
  const step = Math.max(b.w, b.h) * 0.35 + gap
  for (let ring = 1; ring <= 24; ring++) {
    const n = ring * 8
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      const dx = Math.cos(a) * ring * step
      const dy = Math.sin(a) * ring * step * 0.8
      if (free(dx, dy)) return shift(dx, dy)
    }
  }
  return group
}

/* ---------- note ↔ image attachment ---------- */

/** Add every note attached to an image in `ids`. */
export function withAttached(ids: Iterable<string>, items: Item[]): Set<string> {
  const set = new Set(ids)
  for (const i of items) if (i.type === 'note' && i.attachedTo && set.has(i.attachedTo)) set.add(i.id)
  return set
}

/** Topmost image whose bounds (plus a small magnet margin) contain the note's center. */
export function magnetTarget(note: NoteItem, items: Item[], margin: number): string | null {
  const cx = note.x + note.w / 2
  const cy = note.y + note.h / 2
  let best: Item | null = null
  for (const i of items) {
    if (i.type !== 'image') continue
    if (cx < i.x - margin || cx > i.x + i.w + margin || cy < i.y - margin || cy > i.y + i.h + margin) continue
    if (!best || i.z > best.z) best = i
  }
  return best?.id ?? null
}

/** Copy items, giving new ids and re-pointing copied notes at their copied images. */
export function cloneItems<T extends Item>(src: T[], patch: (i: T) => Partial<T>): T[] {
  const ids = new Map(src.map((i) => [i.id, uid()]))
  return src.map((i) => {
    const c = { ...i, ...patch(i), id: ids.get(i.id)! } as T
    if (c.type === 'note' && c.attachedTo && ids.has(c.attachedTo)) (c as NoteItem).attachedTo = ids.get(c.attachedTo)
    return c
  })
}

/**
 * Justified rows (like a photo library): every image keeps its aspect, rows share a height and
 * end flush, and the whole block lands roughly 16:10 at the selection's top-left.
 * Images are taken in reading order so the result follows the rough arrangement you had.
 */
export function justifiedLayout(imgs: (Rect & { id: string })[], gap: number): Map<string, Rect> {
  const hs = imgs.map((i) => i.h).sort((a, b) => a - b)
  const H = hs[Math.floor(hs.length / 2)]
  const ox = Math.min(...imgs.map((i) => i.x))
  const oy = Math.min(...imgs.map((i) => i.y))

  const order = [...imgs].sort((a, b) => {
    const ra = Math.round((a.y + a.h / 2) / (H * 0.75))
    const rb = Math.round((b.y + b.h / 2) / (H * 0.75))
    return ra - rb || a.x - b.x
  })
  const widths = order.map((i) => (i.w / i.h) * H)
  const L = widths.reduce((a, w) => a + w, 0) + gap * (order.length - 1)
  const rows = Math.max(1, Math.round(Math.sqrt(L / (1.6 * H))))
  const W = L / rows

  const out = new Map<string, Rect>()
  let y = oy
  let start = 0
  while (start < order.length) {
    let end = start
    let rowW = widths[start]
    while (end + 1 < order.length) {
      const next = rowW + gap + widths[end + 1]
      if (Math.abs(next - W) > Math.abs(rowW - W)) break
      rowW = next
      end++
    }
    const n = end - start + 1
    const raw = rowW - gap * (n - 1)
    const last = end === order.length - 1
    let k = (W - gap * (n - 1)) / raw
    if (last && k > 1.25) k = 1 // a short final row stays at the shared height instead of ballooning
    let x = ox
    for (let i = start; i <= end; i++) {
      const w = widths[i] * k
      out.set(order[i].id, { x, y, w, h: H * k })
      x += w + gap
    }
    y += H * k + gap
    start = end + 1
  }
  return out
}
