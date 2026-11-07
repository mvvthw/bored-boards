import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, Hand, ImagePlus, Keyboard, Maximize, Minus, Pencil, Plus, Type, UploadCloud } from 'lucide-react'
import type { BoardMeta, Crop, ImageItem, Item, NoteItem, Viewport } from '../lib/types'
import { FULL_CROP } from '../lib/types'
import { getBoardData, getBoardMeta, itemsBounds, saveBoardData, saveBoardMeta, uid } from '../lib/db'
import { extractImageUrls, importFile, importUrl, type Imported } from '../lib/importer'
import { clamp, drag, isTyping, lockCursor } from '../lib/drag'
import { cloneItems, findFreeSpot, justifiedLayout, layoutNewImages, magnetTarget, withAttached } from '../lib/layout'
import { navigate } from '../lib/hooks'
import CanvasItem, { type ResizeHandle } from '../components/CanvasItem'
import CropOverlay, { applyCrop, fullFrame } from '../components/CropOverlay'
import { CropBar, SelectionBar } from '../components/ContextBar'
import { InlineName } from './Dashboard'
import { CroppedImage, NoteBody } from '../components/ItemViews'
import { EXIT_MS, Presence, toast, useLeaving, useSize } from '../components/ui'

const MIN_ZOOM = 0.08
const MAX_ZOOM = 5

// Dot grid spacing on screen; coarsens when zoomed out so it never turns to noise.
const gridSize = (z: number) => {
  let g = 24 * z
  while (g < 14) g *= 4
  return g
}

export default function Board({ id }: { id: string }) {
  const [meta, setMeta] = useState<BoardMeta | null>(null)
  const [items, _setItems] = useState<Item[]>([])
  const [vp, _setVp] = useState<Viewport>({ x: 0, y: 0, zoom: 1 })
  const [ready, setReady] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  // 'crop' trims the image itself; 'detail' leaves it whole and adds a cropped close-up beside it.
  const [cropping, setCropping] = useState<{ id: string; draft: Crop; mode: 'crop' | 'detail' } | null>(null)
  const [tidying, setTidying] = useState(false)
  const [gesturing, setGesturing] = useState(false)
  const [panning, setPanning] = useState(false)
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [dropping, setDropping] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [showKeys, setShowKeys] = useState(false)
  // 'hand': a plain left-drag pans, anywhere. Middle-drag and Space-drag pan in either tool.
  const [tool, setTool] = useState<'select' | 'hand'>('select')
  const toolRef = useRef(tool)
  toolRef.current = tool
  const [canvasRef, size] = useSize<HTMLDivElement>()
  const fileInput = useRef<HTMLInputElement>(null)

  // Refs mirror state so window-level handlers always see the latest values.
  const itemsRef = useRef(items)
  const vpRef = useRef(vp)
  const selRef = useRef(selected)
  selRef.current = selected
  const setItems = useCallback((next: Item[]) => {
    itemsRef.current = next
    _setItems(next)
  }, [])
  const setVp = useCallback((next: Viewport) => {
    vpRef.current = next
    _setVp(next)
  }, [])

  /* ---------- history ---------- */

  const past = useRef<Item[][]>([])
  const future = useRef<Item[][]>([])
  const commit = useCallback((before: Item[]) => {
    past.current.push(before)
    if (past.current.length > 150) past.current.shift()
    future.current = []
  }, [])
  const apply = useCallback(
    (fn: (items: Item[]) => Item[]) => {
      const before = itemsRef.current
      const next = fn(before)
      if (next === before) return
      commit(before)
      setItems(next)
    },
    [commit, setItems],
  )
  const undo = () => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(itemsRef.current)
    setItems(prev)
    setSelected((s) => s.filter((id) => prev.some((i) => i.id === id)))
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(itemsRef.current)
    setItems(next)
    setSelected((s) => s.filter((id) => next.some((i) => i.id === id)))
  }

  /* ---------- load & persist ---------- */

  useEffect(() => {
    let live = true
    Promise.all([getBoardMeta(id), getBoardData(id)]).then(([m, d]) => {
      if (!live) return
      if (!m) return navigate('/')
      setMeta(m)
      setItems(d.items)
      if (d.viewport) setVp(d.viewport)
      else pendingFit.current = true
      setReady(true)
    })
    return () => {
      live = false
    }
  }, [id, setItems, setVp])

  // Items that mount after the first load animate in; the initial board just appears.
  const live = useRef(false)
  useEffect(() => {
    if (ready) live.current = true
  }, [ready])

  // Removed items linger briefly as non-interactive ghosts so they can fade out.
  const [ghosts, setGhosts] = useState<Item[]>([])
  const prevItems = useRef(items)
  useLayoutEffect(() => {
    const prev = prevItems.current
    prevItems.current = items
    if (prev === items || !live.current) return
    const ids = new Set(items.map((i) => i.id))
    const gone = prev.filter((i) => !ids.has(i.id) && !(i.type === 'note' && !i.text.trim()))
    setGhosts((g) => {
      // An item that came back (undo) drops its ghost.
      const kept = g.some((x) => ids.has(x.id)) ? g.filter((x) => !ids.has(x.id)) : g
      return gone.length ? [...kept, ...gone] : kept
    })
    if (gone.length) window.setTimeout(() => setGhosts((g) => g.filter((x) => !gone.includes(x))), EXIT_MS + 40)
  }, [items])

  const pendingFit = useRef(false)
  useLayoutEffect(() => {
    if (!ready || !pendingFit.current || size.width === 0) return
    pendingFit.current = false
    fitTo(itemsRef.current, false)
  }, [ready, size.width])

  const savedItems = useRef<Item[] | null>(null)
  const metaRef = useRef(meta)
  metaRef.current = meta
  const save = useCallback(() => {
    const m = metaRef.current
    if (!m) return
    saveBoardData({ id, items: itemsRef.current, viewport: vpRef.current })
    if (savedItems.current && savedItems.current !== itemsRef.current) {
      const nm = { ...m, updatedAt: Date.now() }
      metaRef.current = nm
      saveBoardMeta(nm)
    }
    savedItems.current = itemsRef.current
  }, [id])

  useEffect(() => {
    if (!ready) return
    if (savedItems.current === null) savedItems.current = items
    const t = setTimeout(save, 350)
    return () => clearTimeout(t)
  }, [items, vp, ready, save])

  useEffect(() => {
    const flush = () => ready && save()
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      flush()
    }
  }, [ready, save])

  /* ---------- coordinates & viewport ---------- */

  const rect = () => canvasRef.current!.getBoundingClientRect()
  const toWorld = (cx: number, cy: number) => {
    const r = rect()
    const v = vpRef.current
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom }
  }
  const viewCenter = () => {
    const r = rect()
    return toWorld(r.left + r.width / 2, r.top + r.height / 2)
  }
  /** `v` zoomed to `z`, keeping the screen point (sx, sy) (canvas-relative) fixed. */
  const zoomedVp = (v: Viewport, sx: number, sy: number, z: number): Viewport => {
    const nz = clamp(z, MIN_ZOOM, MAX_ZOOM)
    const wx = (sx - v.x) / v.zoom
    const wy = (sy - v.y) / v.zoom
    return { zoom: nz, x: sx - wx * nz, y: sy - wy * nz }
  }
  const zoomAt = (cx: number, cy: number, z: number) => {
    const r = rect()
    setVp(zoomedVp(vpRef.current, cx - r.left, cy - r.top, z))
  }
  // Buttons & shortcuts glide around the view center. Repeated presses stack onto the running animation's target.
  const zoomCenterTo = (z: (from: number) => number) => {
    const r = rect()
    const from = animTo.current ?? vpRef.current
    animateVp(zoomedVp(from, r.width / 2, r.height / 2, z(from.zoom)))
  }
  const zoomBy = (f: number) => zoomCenterTo((z) => z * f)
  function fitTo(list: Item[], animate = true) {
    const el = canvasRef.current
    if (!el) return
    const W = el.clientWidth
    const H = el.clientHeight
    const b = itemsBounds(list)
    if (!b) return setVp({ x: W / 2, y: H / 2, zoom: 1 })
    const padX = 80
    const top = 96
    const bottom = 120
    const zoom = clamp(Math.min((W - padX * 2) / b.w, (H - top - bottom) / b.h, 1), MIN_ZOOM, MAX_ZOOM)
    const next = { zoom, x: W / 2 - (b.x + b.w / 2) * zoom, y: top + (H - top - bottom) / 2 - (b.y + b.h / 2) * zoom }
    if (animate) animateVp(next)
    else setVp(next)
  }
  const animRef = useRef(0)
  const animTo = useRef<Viewport | null>(null)
  const stopAnim = () => {
    if (!animRef.current) return
    cancelAnimationFrame(animRef.current)
    animRef.current = 0
    animTo.current = null
    if (!wheelTimer.current) lockCursor(undefined)
  }
  const animateVp = (to: Viewport) => {
    stopAnim()
    const from = vpRef.current
    animTo.current = to
    const t0 = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 320)
      const e = 1 - Math.pow(1 - k, 3)
      setVp({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, zoom: from.zoom + (to.zoom - from.zoom) * e })
      if (k < 1) animRef.current = requestAnimationFrame(step)
      else {
        animRef.current = 0
        animTo.current = null
        if (!wheelTimer.current) lockCursor(undefined)
      }
    }
    // Same as scrolling: the view moves under the pointer, so hold the cursor still.
    if (!wheelTimer.current) {
      const under = document.elementFromPoint(lastPointer.current.x, lastPointer.current.y)
      lockCursor(under ? getComputedStyle(under).cursor : undefined)
    }
    animRef.current = requestAnimationFrame(step)
  }

  const wheelTimer = useRef(0)
  const lastPointer = useRef({ x: 0, y: 0 })
  useEffect(() => {
    const track = (e: PointerEvent) => (lastPointer.current = { x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', track, { passive: true })
    return () => window.removeEventListener('pointermove', track)
  }, [])
  // Trackpad: two-finger scroll pans, pinch (ctrl+wheel) zooms. Needs a non-passive listener.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.tag-picker')) return
      e.preventDefault()
      // While content slides under a still pointer, keep the cursor it started with instead of
      // flipping hand ↔ pointer every time an image passes beneath it.
      if (!wheelTimer.current) lockCursor(getComputedStyle(e.target as Element).cursor)
      clearTimeout(wheelTimer.current)
      wheelTimer.current = window.setTimeout(() => {
        wheelTimer.current = 0
        lockCursor(undefined)
      }, 160)
      stopAnim()
      const mult = e.deltaMode === 1 ? 16 : 1
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, vpRef.current.zoom * Math.exp(-e.deltaY * mult * 0.0075))
      } else {
        const v = vpRef.current
        setVp({ ...v, x: v.x - e.deltaX * mult, y: v.y - e.deltaY * mult })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  /* ---------- adding content ---------- */

  const maxZ = () => itemsRef.current.reduce((m, i) => Math.max(m, i.z), 0)

  /** `exact`: drop point chosen by the user. Otherwise find open space near it. */
  const addImages = (imgs: Imported[], at: { x: number; y: number }, exact: boolean) => {
    if (!imgs.length) return
    const el = canvasRef.current!
    const view = { width: el.clientWidth, height: el.clientHeight, zoom: vpRef.current.zoom }
    let rects = layoutNewImages(imgs, at, view)
    if (!exact) rects = findFreeSpot(rects, itemsRef.current, view.zoom)
    let z = maxZ()
    const created: ImageItem[] = imgs.map((im, k) => ({
      id: uid(),
      type: 'image',
      ...rects[k],
      z: ++z,
      natW: im.natW,
      natH: im.natH,
      crop: FULL_CROP,
      tags: [],
      assetId: im.assetId,
      src: im.src,
      source: im.source,
    }))
    apply((list) => [...list, ...created])
    setSelected(created.map((c) => c.id))
  }

  const importAll = async (files: Blob[], urls: string[], at: { x: number; y: number }, exact = false) => {
    const jobs = [...files.map((f) => importFile(f)), ...urls.map((u) => importUrl(u))]
    if (!jobs.length) return false
    const results = await Promise.allSettled(jobs)
    const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    const failed = results.length - ok.length
    if (failed) toast(failed === results.length ? 'Couldn’t import that image' : `${failed} image${failed > 1 ? 's' : ''} couldn’t be imported`)
    addImages(ok, at, exact)
    return true
  }

  const addNote = (at?: { x: number; y: number }, text = '', attachTo?: string, w = 240) => {
    const c = at ?? viewCenter()
    const note: NoteItem = { id: uid(), type: 'note', x: c.x - (at ? 0 : w / 2), y: c.y - (at ? 0 : 30), w, h: 60, z: maxZ() + 1, text, style: 'glass', size: 'm', attachedTo: attachTo }
    apply((list) => [...list, note])
    setSelected([note.id])
    if (attachTo) flashAttach(note.id, attachTo)
    if (!text) startEdit(note.id, true)
  }

  /* ---------- note magnet ---------- */

  const [magnetId, setMagnetId] = useState<string | null>(null)
  const [pulse, setPulse] = useState<{ note: string; image: string } | null>(null)
  const pulseTimer = useRef(0)
  const flashAttach = (note: string, image: string) => {
    clearTimeout(pulseTimer.current)
    setPulse({ note, image })
    pulseTimer.current = window.setTimeout(() => setPulse(null), 650)
  }

  /* ---------- editing ---------- */

  const editBefore = useRef<Item[] | null>(null)
  const editIsNew = useRef(false)
  const startEdit = (nid: string, isNew = false) => {
    editBefore.current = itemsRef.current
    editIsNew.current = isNew
    setEditingId(nid)
  }
  const onText = useCallback(
    (nid: string, text: string) => setItems(itemsRef.current.map((i) => (i.id === nid && i.type === 'note' ? { ...i, text } : i))),
    [setItems],
  )
  const onEditEnd = useCallback(
    (nid: string) => {
      setEditingId(null)
      const before = editBefore.current
      editBefore.current = null
      const note = itemsRef.current.find((i) => i.id === nid) as NoteItem | undefined
      if (!note || !before) return
      if (!note.text.trim()) {
        // Empty notes vanish. A brand-new one also drops its "added" history entry.
        setItems(itemsRef.current.filter((i) => i.id !== nid))
        setSelected((s) => s.filter((x) => x !== nid))
        if (editIsNew.current) past.current.pop()
        else commit(before)
        return
      }
      // A new note's typing folds into its "added" entry; edits to existing notes get their own.
      const old = before.find((i) => i.id === nid) as NoteItem | undefined
      if (!editIsNew.current && old && old.text !== note.text) commit(before)
    },
    [commit, setItems],
  )
  const onMeasure = useCallback(
    (mid: string, h: number) => {
      const it = itemsRef.current.find((i) => i.id === mid)
      if (it && Math.abs(it.h - h) > 0.5) setItems(itemsRef.current.map((i) => (i.id === mid ? { ...i, h } : i)))
    },
    [setItems],
  )

  const startCrop = (it: ImageItem) => {
    setSelected([it.id])
    setCropping({ id: it.id, draft: it.crop, mode: 'crop' })
  }
  const startDetail = (it: ImageItem) => {
    const c = it.crop
    const w = c.w * 0.45
    const h = c.h * 0.45
    setSelected([it.id])
    setCropping({ id: it.id, draft: { x: c.x + (c.w - w) / 2, y: c.y + (c.h - h) / 2, w, h }, mode: 'detail' })
  }
  const addDetail = (it: ImageItem, d: Crop) => {
    const F = fullFrame(it)
    const aspect = (d.w * F.w) / (d.h * F.h)
    const long = Math.max(it.w, it.h) * 0.75
    const w = aspect >= 1 ? long : long * aspect
    const h = aspect >= 1 ? long / aspect : long
    const zoom = vpRef.current.zoom
    const [spot] = findFreeSpot([{ x: it.x + it.w + 28 / zoom, y: it.y, w, h }], itemsRef.current, zoom)
    const detail: ImageItem = { ...it, ...spot, id: uid(), crop: d, tags: [], z: maxZ() + 1, detailOf: it.id }
    apply((list) => [...list, detail])
    setSelected([detail.id])
    flashAttach(detail.id, it.id)
  }
  const finishCrop = (save = true) => {
    const c = cropping
    if (!c) return
    setCropping(null)
    if (!save) return
    if (c.mode === 'detail') {
      const it = itemsRef.current.find((i) => i.id === c.id)
      if (it?.type === 'image') addDetail(it, c.draft)
      return
    }
    apply((list) => {
      const it = list.find((i) => i.id === c.id)
      if (!it || it.type !== 'image') return list
      const same = ['x', 'y', 'w', 'h'].every((k) => Math.abs(it.crop[k as keyof Crop] - c.draft[k as keyof Crop]) < 1e-4)
      return same ? list : list.map((i) => (i.id === c.id ? applyCrop(it, c.draft) : i))
    })
  }

  /* ---------- pointer interaction ---------- */

  const spaceHeld = useRef(false)

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return
    if (cropping) finishCrop()
    if (editingId) (document.activeElement as HTMLElement)?.blur()
    const onEmpty = e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('world')
    const pan = e.button === 1 || spaceHeld.current || toolRef.current === 'hand'
    if (pan) {
      if (e.button === 1) e.preventDefault()
      const v0 = vpRef.current
      stopAnim()
      drag(
        e,
        (dx, dy) => {
          setPanning(true)
          setVp({ ...v0, x: v0.x + dx, y: v0.y + dy })
        },
        (moved) => {
          setPanning(false)
          if (!moved && e.button === 0 && onEmpty) setSelected([])
        },
        3,
        'grabbing',
      )
      return
    }
    if (e.button !== 0) return
    // Drag on empty canvas: box select. Shift adds to the current selection.
    const r = rect()
    const base = e.shiftKey ? selRef.current : []
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    drag(
      e,
      (dx, dy) => {
        const m = { x: Math.min(sx, sx + dx), y: Math.min(sy, sy + dy), w: Math.abs(dx), h: Math.abs(dy) }
        setMarquee(m)
        const v = vpRef.current
        const wx1 = (m.x - v.x) / v.zoom
        const wy1 = (m.y - v.y) / v.zoom
        const wx2 = (m.x + m.w - v.x) / v.zoom
        const wy2 = (m.y + m.h - v.y) / v.zoom
        const hit = itemsRef.current.filter((i) => i.x < wx2 && i.x + i.w > wx1 && i.y < wy2 && i.y + i.h > wy1).map((i) => i.id)
        setSelected([...new Set([...base, ...hit])])
      },
      (moved) => {
        setMarquee(null)
        if (!moved && !e.shiftKey) setSelected([])
      },
      3,
    )
  }

  const onItemPointerDown = useCallback(
    (e: React.PointerEvent, item: Item) => {
      // Middle button, Space and the hand tool fall through to the canvas, which pans.
      if (e.button !== 0 || spaceHeld.current || toolRef.current === 'hand') return
      e.stopPropagation()
      if (item.id === editingIdRef.current) return
      if (croppingRef.current) {
        finishCropRef.current()
        if (croppingRef.current.id === item.id) return
      }
      if (editingIdRef.current) (document.activeElement as HTMLElement)?.blur()

      const wasSelected = selRef.current.includes(item.id)
      let sel: string[]
      if (e.shiftKey) sel = wasSelected ? selRef.current.filter((x) => x !== item.id) : [...selRef.current, item.id]
      else sel = wasSelected ? selRef.current : [item.id]
      setSelected(sel)
      if (e.shiftKey && wasSelected) return

      const before = itemsRef.current
      const ids = withAttached(sel, before) // attached notes ride along with their image
      const z = vpRef.current.zoom
      // Alt-drag leaves copies behind.
      let base = before
      if (e.altKey) {
        let mz = maxZ()
        const moving = before.filter((i) => ids.has(i.id))
        base = [...before.filter((i) => !ids.has(i.id)), ...cloneItems(moving, () => ({})), ...moving.map((i) => ({ ...i, z: ++mz }))]
      }
      // A lone note being dragged can snap onto an image.
      const magnetNote = sel.length === 1 && item.type === 'note' ? item.id : null
      let target: string | null = null
      drag(
        e,
        (dx, dy) => {
          setGesturing(true)
          const next = base.map((i) => (ids.has(i.id) ? { ...i, x: i.x + dx / z, y: i.y + dy / z } : i))
          setItems(next)
          if (magnetNote) {
            const n = next.find((i) => i.id === magnetNote) as NoteItem
            target = magnetTarget(n, next, 14 / z)
            setMagnetId(target)
          }
        },
        (moved) => {
          setGesturing(false)
          setMagnetId(null)
          if (moved && magnetNote) {
            const n = itemsRef.current.find((i) => i.id === magnetNote) as NoteItem
            const img = target ? itemsRef.current.find((i) => i.id === target) : undefined
            if (img && n.attachedTo !== img.id) flashAttach(n.id, img.id)
            const top = img && n.z < img.z ? maxZ() + 1 : n.z
            if (n.attachedTo !== (target ?? undefined) || top !== n.z)
              setItems(itemsRef.current.map((i) => (i.id === magnetNote ? { ...n, attachedTo: target ?? undefined, z: top } : i)))
          }
          if (moved) commit(before)
          else if (!e.shiftKey && wasSelected && sel.length > 1) setSelected([item.id])
        },
        3,
        e.altKey ? 'copy' : 'grabbing',
      )
    },
    [commit, setItems],
  )

  const onResizeStart = useCallback(
    (e: React.PointerEvent, item: Item, h: ResizeHandle) => {
      if (e.button !== 0 || spaceHeld.current || toolRef.current === 'hand') return
      e.stopPropagation()
      const before = itemsRef.current
      const z = vpRef.current.zoom
      drag(
        e,
        (dx, dy) => {
          setGesturing(true)
          let { x, y, w, h: hh } = item
          if (item.type === 'image') {
            const sw = (item.w + (h.includes('e') ? dx : -dx) / z) / item.w
            const sh = (item.h + (h.includes('s') ? dy : -dy) / z) / item.h
            const s = Math.max(Math.abs(sw - 1) > Math.abs(sh - 1) ? sw : sh, 40 / Math.min(item.w, item.h))
            w = item.w * s
            hh = item.h * s
            if (h.includes('w')) x = item.x + item.w - w
            if (h.includes('n')) y = item.y + item.h - hh
          } else {
            w = Math.max(100, item.w + (h === 'e' ? dx : -dx) / z)
            if (h === 'w') x = item.x + item.w - w
          }
          const kx = w / item.w
          const ky = hh / item.h
          setItems(
            before.map((i) => {
              if (i.id === item.id) return { ...i, x, y, w, h: hh } as Item
              if (item.type === 'image' && i.type === 'note' && i.attachedTo === item.id)
                return { ...i, x: x + (i.x - item.x) * kx, y: y + (i.y - item.y) * ky }
              return i
            }),
          )
        },
        (moved) => {
          setGesturing(false)
          if (moved) commit(before)
        },
        0,
        h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize',
      )
    },
    [commit, setItems],
  )

  const onItemDoubleClick = useCallback((item: Item) => {
    if (item.type === 'image') startCropRef.current(item)
    else {
      setSelected([item.id])
      startEditRef.current(item.id)
    }
  }, [])

  // Stable callbacks above read these refs instead of closing over state.
  const editingIdRef = useRef(editingId)
  editingIdRef.current = editingId
  const croppingRef = useRef(cropping)
  croppingRef.current = cropping
  const finishCropRef = useRef(finishCrop)
  finishCropRef.current = finishCrop
  const startCropRef = useRef(startCrop)
  startCropRef.current = startCrop
  const startEditRef = useRef(startEdit)
  startEditRef.current = startEdit

  /* ---------- selection actions ---------- */

  const selItems = useMemo(() => items.filter((i) => selected.includes(i.id)), [items, selected])

  const del = () => {
    const ids = withAttached(selRef.current, itemsRef.current)
    if (!ids.size) return
    apply((l) => l.filter((i) => !ids.has(i.id)))
    setSelected([])
  }
  const duplicate = () => {
    const sel = new Set(selRef.current)
    if (!sel.size) return
    const ids = withAttached(sel, itemsRef.current)
    let z = maxZ()
    const off = 24 / vpRef.current.zoom
    const src = itemsRef.current.filter((i) => ids.has(i.id)).sort((a, b) => a.z - b.z)
    const copies = cloneItems(src, (i) => ({ x: i.x + off, y: i.y + off, z: ++z }))
    apply((l) => [...l, ...copies])
    setSelected(copies.filter((_, k) => sel.has(src[k].id)).map((c) => c.id))
  }
  /** Arrange the selected images into clean justified rows; attached notes keep their spot on each image. */
  const tidy = () => {
    const sel = new Set(selRef.current)
    const imgs = itemsRef.current.filter((i): i is ImageItem => i.type === 'image' && sel.has(i.id))
    if (imgs.length < 2) return
    const next = justifiedLayout(imgs, 24 / vpRef.current.zoom)
    apply((list) =>
      list.map((i) => {
        const r = next.get(i.id)
        if (r) return { ...i, ...r }
        if (i.type === 'note' && i.attachedTo && next.has(i.attachedTo)) {
          const img = imgs.find((m) => m.id === i.attachedTo)!
          const nr = next.get(i.attachedTo)!
          const k = nr.w / img.w
          return { ...i, x: nr.x + (i.x - img.x) * k, y: nr.y + (i.y - img.y) * k }
        }
        return i
      }),
    )
    setTidying(true)
    window.setTimeout(() => setTidying(false), 520)
  }

  const reorder = (front: boolean) => {
    const ids = withAttached(selRef.current, itemsRef.current)
    const list = itemsRef.current
    const zs = list.map((i) => i.z)
    let n = front ? Math.max(0, ...zs) : Math.min(0, ...zs)
    const ordered = list.filter((i) => ids.has(i.id)).sort((a, b) => (front ? a.z - b.z : b.z - a.z))
    const newZ = new Map(ordered.map((i) => [i.id, front ? ++n : --n]))
    apply((l) => l.map((i) => (newZ.has(i.id) ? { ...i, z: newZ.get(i.id)! } : i)))
  }
  const patch = (fn: (i: Item) => Item) => {
    const ids = new Set(selRef.current)
    apply((l) => l.map((i) => (ids.has(i.id) ? fn(i) : i)))
  }
  // Pinned over the image's top-right corner, like a sticky on a photo, and attached to it.
  const addNoteBeside = () => {
    const it = selItems[0]
    if (!it || it.type !== 'image') return
    const z = vpRef.current.zoom
    const w = clamp(it.w * 0.7, 150 / z, 260 / z)
    addNote({ x: it.x + it.w - w * 0.55, y: it.y - 18 / z }, '', it.id, w)
  }

  /* ---------- keyboard, paste, drop ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      if (e.key === ' ') {
        spaceHeld.current = true
        e.preventDefault()
        return
      }
      if (croppingRef.current) {
        if (e.key === 'Enter') finishCrop(true)
        if (e.key === 'Escape') finishCrop(false)
        return
      }
      if (mod && k === 'z') {
        e.preventDefault()
        e.shiftKey ? redo() : undo()
      } else if (mod && k === 'y') {
        e.preventDefault()
        redo()
      } else if (mod && k === 'a') {
        e.preventDefault()
        setSelected(itemsRef.current.map((i) => i.id))
      } else if (mod && k === 'd') {
        e.preventDefault()
        duplicate()
      } else if (mod && (k === '=' || k === '+')) {
        e.preventDefault()
        zoomBy(1.25)
      } else if (mod && k === '-') {
        e.preventDefault()
        zoomBy(0.8)
      } else if (mod && k === '0') {
        e.preventDefault()
        zoomCenterTo(() => 1)
      } else if (k === 'h' && !mod) {
        setTool((t) => (t === 'hand' ? 'select' : 'hand'))
      } else if (k === 'v' && !mod) {
        setTool('select')
      } else if (e.shiftKey && k === '1') {
        fitTo(itemsRef.current)
      } else if (e.shiftKey && k === '2' && selRef.current.length) {
        fitTo(itemsRef.current.filter((i) => selRef.current.includes(i.id)))
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        del()
      } else if (e.key === 'Escape') {
        setSelected([])
        setShowKeys(false)
      } else if (e.key === 'Enter' && selRef.current.length === 1) {
        const it = itemsRef.current.find((i) => i.id === selRef.current[0])
        if (it?.type === 'note') {
          e.preventDefault()
          startEdit(it.id)
        } else if (it?.type === 'image') startCrop(it)
      } else if (k === 'n' && !mod) {
        e.preventDefault()
        addNote()
      } else if (k === 'c' && !mod && selRef.current.length === 1) {
        const it = itemsRef.current.find((i) => i.id === selRef.current[0])
        if (it?.type === 'image') startCrop(it)
      } else if (k === 'd' && !mod && selRef.current.length === 1) {
        const it = itemsRef.current.find((i) => i.id === selRef.current[0])
        if (it?.type === 'image') startDetail(it)
      } else if (k === 't' && !mod) {
        tidy()
      } else if (e.key === ']') reorder(true)
      else if (e.key === '[') reorder(false)
      else if (e.key.startsWith('Arrow') && selRef.current.length) {
        e.preventDefault()
        const d = (e.shiftKey ? 10 : 1) / vpRef.current.zoom
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0
        const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0
        const ids = withAttached(selRef.current, itemsRef.current)
        apply((l) => l.map((i) => (ids.has(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i)))
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeld.current = false
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !e.clipboardData) return
      const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
      const urls = files.length ? [] : extractImageUrls(e.clipboardData)
      const c = viewCenter()
      if (files.length || urls.length) {
        e.preventDefault()
        importAll(files, urls, c)
        return
      }
      const text = e.clipboardData.getData('text/plain').trim()
      if (text) {
        e.preventDefault()
        addNote({ x: c.x - 120, y: c.y - 30 }, text)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('paste', onPaste)
    }
  })

  // Reflect held modifiers in the cursor: space = hand (pan anywhere), alt = copy.
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const sync = (e: KeyboardEvent) => {
      const typing = isTyping(e.target)
      const space = e.key === ' ' ? e.type === 'keydown' : spaceHeld.current
      el.classList.toggle('mod-space', space && !typing)
      el.classList.toggle('mod-alt', e.altKey && !typing)
    }
    const clear = () => {
      spaceHeld.current = false
      el.classList.remove('mod-space', 'mod-alt')
    }
    window.addEventListener('keydown', sync)
    window.addEventListener('keyup', sync)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', sync)
      window.removeEventListener('keyup', sync)
      window.removeEventListener('blur', clear)
    }
  }, [canvasRef])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDropping(false)
    const at = toWorld(e.clientX, e.clientY)
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    const urls = files.length ? [] : extractImageUrls(e.dataTransfer)
    const handled = await importAll(files, urls, at, true)
    if (!handled) toast('Drop an image file or an image dragged from the web')
  }

  /* ---------- render ---------- */

  const sorted = useMemo(() => [...items].sort((a, b) => a.z - b.z), [items])
  const cropItem = cropping ? (items.find((i) => i.id === cropping.id) as ImageItem | undefined) : undefined

  const barPos = (() => {
    const box = cropItem ? fullFrame(cropItem) : itemsBounds(selItems)
    if (!box) return null
    const left = (box.x + box.w / 2) * vp.zoom + vp.x
    // Prefer above the selection, then below; if neither clears the top bar and dock, pin under the top bar.
    const top = box.y * vp.zoom + vp.y
    const bottom = (box.y + box.h) * vp.zoom + vp.y
    if (top - 14 - 44 >= 72) return { left, top: top - 14, below: false }
    if (bottom + 14 + 44 <= size.height - 100) return { left, top: bottom + 14, below: true }
    return { left, top: 72, below: true }
  })()

  const empty = ready && items.length === 0
  // Keyed by what it's for, so switching selection cross-fades the bar instead of jumping it.
  const barId =
    !barPos || gesturing || editingId || panning || marquee ? null : cropping ? `crop:${cropping.id}` : selItems.length ? `sel:${selected.join(',')}` : null

  return (
    <div className="board-page">
      <div
        ref={canvasRef}
        className={`canvas${tool === 'hand' ? ' hand' : ''}${panning ? ' panning' : ''}${dropping ? ' dropping' : ''}${tidying ? ' tidying' : ''}`}
        onPointerDown={onCanvasPointerDown}
        // Middle-click would otherwise start the browser's autoscroll.
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('world')) {
            const p = toWorld(e.clientX, e.clientY)
            addNote({ x: p.x, y: p.y - 20 })
          }
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false)
        }}
        onDrop={onDrop}
        style={
          {
            '--grid': `${gridSize(vp.zoom)}px`,
            '--gx': `${vp.x}px`,
            '--gy': `${vp.y}px`,
          } as React.CSSProperties
        }
      >
        <div className="world" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, '--inv': 1 / vp.zoom } as React.CSSProperties}>
          {sorted.map((it) => (
            <CanvasItem
              key={it.id}
              item={it}
              selected={selected.includes(it.id) && !cropping}
              solo={selected.length === 1 && selected[0] === it.id && !gesturing && !cropping}
              editing={editingId === it.id}
              hidden={cropping?.id === it.id}
              appear={live.current}
              magnet={magnetId === it.id || pulse?.image === it.id}
              pulse={pulse?.note === it.id}
              onPointerDown={onItemPointerDown}
              onDoubleClick={onItemDoubleClick}
              onResizeStart={onResizeStart}
              onText={onText}
              onEditEnd={onEditEnd}
              onMeasure={onMeasure}
            />
          ))}
          {ghosts.map((g) => (
            <div
              key={'ghost:' + g.id}
              className={`item item-${g.type} item-ghost`}
              style={{ left: g.x, top: g.y, width: g.w, height: g.type === 'image' ? g.h : undefined, zIndex: g.z }}
            >
              {g.type === 'image' ? <CroppedImage item={g} /> : <NoteBody item={g} />}
            </div>
          ))}
          {cropItem && cropping && (
            <div style={{ position: 'absolute', zIndex: 1e6 }}>
              <CropOverlay item={cropItem} draft={cropping.draft} zoom={vp.zoom} setDraft={(draft) => setCropping({ ...cropping, draft })} />
            </div>
          )}
        </div>

        <Presence id={marquee ? 'marquee' : null} ms={140}>
          {marquee && <Marquee {...marquee} />}
        </Presence>

        <Presence id={barId}>
          {barId &&
            barPos &&
            (cropping ? (
              <CropBar pos={barPos} mode={cropping.mode} onReset={() => setCropping({ ...cropping, draft: FULL_CROP })} onCancel={() => finishCrop(false)} onDone={() => finishCrop(true)} />
            ) : (
              <SelectionBar
                pos={barPos}
                items={selItems}
                onCrop={() => selItems[0].type === 'image' && startCrop(selItems[0])}
                onDetail={() => selItems[0].type === 'image' && startDetail(selItems[0])}
                onTidy={tidy}
                onAddNote={addNoteBeside}
                onTags={(tags) => patch((i) => (i.type === 'image' ? { ...i, tags } : i))}
                onNote={(p) => patch((i) => (i.type === 'note' ? { ...i, ...p } : i))}
                onFront={() => reorder(true)}
                onBack={() => reorder(false)}
                onDuplicate={duplicate}
                onDelete={del}
              />
            ))}
        </Presence>

        <Presence id={empty ? 'empty' : null} ms={260}>
          {empty && <EmptyState onImages={() => fileInput.current?.click()} onNote={() => addNote()} />}
        </Presence>

        <Presence id={dropping ? 'drop' : null}>
          {dropping && <DropOverlay />}
        </Presence>
      </div>

      {/* chrome */}
      <div className="topbar">
        <button className="pill glass" onClick={() => navigate('/')}>
          <ChevronLeft size={18} strokeWidth={2.2} />
          <span>Boards</span>
        </button>
        <div className={`title-pill glass${renaming ? ' editing' : ''}`}>
          {renaming && meta ? (
            <div className="title-btn">
              <InlineName
                value={meta.name}
                onDone={(name) => {
                  setRenaming(false)
                  if (name !== meta.name) {
                    const nm = { ...meta, name, updatedAt: Date.now() }
                    setMeta(nm)
                    saveBoardMeta(nm)
                  }
                }}
              />
            </div>
          ) : (
            <button className="title-btn" onClick={() => setRenaming(true)} title="Rename board">
              <span className="title-text">{meta?.name ?? ''}</span>
            </button>
          )}
          <button
            className="title-edit-icon"
            aria-label={renaming ? 'Save name' : 'Rename board'}
            title={renaming ? 'Save' : 'Rename'}
            // Keep focus in the input so its blur (which saves) fires on our click, not before.
            onPointerDown={(e) => renaming && e.preventDefault()}
            onClick={() => (renaming ? (document.activeElement as HTMLElement)?.blur() : setRenaming(true))}
          >
            {renaming ? <Check size={14} strokeWidth={2.6} /> : <Pencil size={13} strokeWidth={2.2} />}
          </button>
        </div>
        <div className="topbar-right">
          <span className="count-pill glass">
            {items.length} {items.length === 1 ? 'item' : 'items'}
          </span>
          <button className={`icon-btn glass${showKeys ? ' active' : ''}`} onClick={() => setShowKeys((v) => !v)} title="Keyboard shortcuts">
            <Keyboard size={17} />
          </button>
        </div>
      </div>

      <Presence id={showKeys ? 'keys' : null}>{showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}</Presence>

      <div className="dock glass">
        <button className="dock-btn" onClick={() => fileInput.current?.click()} title="Add images">
          <ImagePlus size={19} strokeWidth={1.8} />
          <span>Image</span>
        </button>
        <button className="dock-btn" onClick={() => addNote()} title="Add note  N">
          <Type size={19} strokeWidth={1.8} />
          <span>Note</span>
        </button>
        <span className="dock-sep" />
        <button
          className={`dock-icon dock-tool${tool === 'hand' ? ' active' : ''}`}
          onClick={() => setTool((t) => (t === 'hand' ? 'select' : 'hand'))}
          title={tool === 'hand' ? 'Pan tool on: drag to move around  H' : 'Pan tool  H'}
          aria-pressed={tool === 'hand'}
        >
          <Hand size={17} />
        </button>
        <span className="dock-sep" />
        <button className="dock-icon" onClick={() => zoomBy(0.8)} title="Zoom out  ⌘−">
          <Minus size={17} />
        </button>
        <button
          className="dock-zoom"
          title="Reset to 100%  ⌘0"
          onClick={() => zoomCenterTo(() => 1)}
        >
          {Math.round(vp.zoom * 100)}%
        </button>
        <button className="dock-icon" onClick={() => zoomBy(1.25)} title="Zoom in  ⌘+">
          <Plus size={17} />
        </button>
        <button className="dock-icon" onClick={() => fitTo(items)} title="Fit to board  ⇧1">
          <Maximize size={16} />
        </button>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          await importAll(files, [], viewCenter())
        }}
      />
    </div>
  )
}

const KEYS: [string, string][] = [
  ['Select', 'Click · Drag canvas'],
  ['Add to selection', '⇧ Click · ⇧ Drag'],
  ['Pan', 'Middle-drag · Space-drag · Scroll'],
  ['Pan tool', 'H (V to go back)'],
  ['Zoom', 'Pinch · ⌘ Scroll'],
  ['Crop image', 'Double-click · C'],
  ['Add detail close-up', 'D'],
  ['Tidy selection', 'T'],
  ['New note', 'N · Double-click canvas'],
  ['Duplicate', '⌘D · ⌥ Drag'],
  ['Delete', '⌫'],
  ['Undo / Redo', '⌘Z · ⇧⌘Z'],
  ['Front / Back', ']  ['],
  ['Fit board / selection', '⇧1 · ⇧2'],
  ['Actual size', '⌘0'],
]

function Shortcuts({ onClose }: { onClose: () => void }) {
  const leaving = useLeaving()
  return (
    <div className={`shortcuts glass${leaving ? ' leaving' : ''}`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="shortcuts-head">
        <span>Shortcuts</span>
        <button className="link-btn" onClick={onClose}>
          Done
        </button>
      </div>
      {KEYS.map(([a, b]) => (
        <div key={a} className="shortcut-row">
          <span>{a}</span>
          <span className="shortcut-keys">{b}</span>
        </div>
      ))}
    </div>
  )
}

function Marquee({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const leaving = useLeaving()
  return <div className={`marquee${leaving ? ' leaving' : ''}`} style={{ left: x, top: y, width: w, height: h }} />
}

function EmptyState({ onImages, onNote }: { onImages: () => void; onNote: () => void }) {
  const leaving = useLeaving()
  return (
    <div className="board-empty">
      <div className={`board-empty-card glass${leaving ? ' leaving' : ''}`} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <div className="board-empty-icon">
          <UploadCloud size={30} strokeWidth={1.4} />
        </div>
        <h2>Drop inspiration here</h2>
        <p>
          Drag images straight from Pinterest, Grailed or your desktop. <br />
          Paste with <kbd>⌘</kbd>
          <kbd>V</kbd>, or double-click anywhere to write a note.
        </p>
        <div className="board-empty-actions">
          <button className="btn btn-primary" onClick={onImages}>
            <ImagePlus size={17} /> Add Images
          </button>
          <button className="btn" onClick={onNote}>
            <Type size={17} /> Add Note
          </button>
        </div>
      </div>
    </div>
  )
}

function DropOverlay() {
  const leaving = useLeaving()
  return (
    <div className={`drop-overlay${leaving ? ' leaving' : ''}`}>
      <div className="drop-pill glass">
        <ImagePlus size={18} /> Drop to add to board
      </div>
    </div>
  )
}
