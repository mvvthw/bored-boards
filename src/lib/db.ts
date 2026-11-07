import type { BoardData, BoardMeta, Item, Viewport } from './types'
import { ASSET_BUCKET, supabase } from './supabase'
import { toast } from '../components/ui'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

type Row = { id: string; name: string; items: Item[]; viewport: Viewport | null; created_at: string; updated_at: string }

const toMeta = (r: Pick<Row, 'id' | 'name' | 'created_at' | 'updated_at'>): BoardMeta => ({
  id: r.id,
  name: r.name,
  createdAt: Date.parse(r.created_at),
  updatedAt: Date.parse(r.updated_at),
})

async function currentUserId() {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Not signed in')
  return id
}

function check<T>(res: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (res.error) throw new Error(res.error.message)
  return res.data as NonNullable<T>
}

// Writes are tracked so asset cleanup never races an in-flight save or upload,
// and failures surface once instead of silently losing work.
let pending: Promise<unknown> = Promise.resolve()
function track<T>(p: PromiseLike<T>, what: string) {
  const guarded = Promise.resolve(p).catch((e) => {
    console.error(e)
    toast(`Couldn’t ${what} — check your connection`)
  })
  pending = pending.then(() => guarded)
  return p
}
export const flushSaves = () => pending

/* ---------- boards ---------- */

export async function listBoardsWithData(): Promise<(BoardMeta & { data: BoardData })[]> {
  const rows = check(await supabase.from('boards').select('id, name, items, viewport, created_at, updated_at').order('updated_at', { ascending: false })) as Row[]
  return rows.map((r) => ({ ...toMeta(r), data: { id: r.id, items: r.items ?? [], viewport: r.viewport ?? undefined } }))
}

export async function getBoardMeta(id: string): Promise<BoardMeta | undefined> {
  const { data: row, error } = await supabase.from('boards').select('id, name, created_at, updated_at').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return row ? toMeta(row) : undefined
}

export async function getBoardData(id: string): Promise<BoardData> {
  const { data: row, error } = await supabase.from('boards').select('items, viewport').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return { id, items: row?.items ?? [], viewport: row?.viewport ?? undefined }
}

export const saveBoardMeta = (m: BoardMeta) =>
  track(
    supabase
      .from('boards')
      .update({ name: m.name, updated_at: new Date(m.updatedAt).toISOString() })
      .eq('id', m.id)
      .then(check),
    'save the board',
  )

export const saveBoardData = (d: BoardData) =>
  track(
    supabase
      .from('boards')
      .update({ items: d.items, viewport: d.viewport ?? null })
      .eq('id', d.id)
      .then(check),
    'save your changes',
  )

export async function createBoard(name: string): Promise<BoardMeta> {
  const row = check(await supabase.from('boards').insert({ id: uid(), name: name.trim() || 'Untitled Board' }).select('id, name, created_at, updated_at').single())
  return toMeta(row)
}

export async function duplicateBoard(id: string): Promise<BoardMeta> {
  const src = check(await supabase.from('boards').select('name, items, viewport').eq('id', id).single()) as Pick<Row, 'name' | 'items' | 'viewport'>
  const row = check(
    await supabase.from('boards').insert({ id: uid(), name: `${src.name} copy`, items: src.items, viewport: src.viewport }).select('id, name, created_at, updated_at').single(),
  )
  return toMeta(row)
}

export async function deleteBoard(id: string) {
  check(await supabase.from('boards').delete().eq('id', id))
  await collectGarbage()
}

/* ---------- assets (private bucket, one folder per user) ---------- */

const urlCache = new Map<string, string>()

/** Returns immediately with a local preview; the upload finishes in the background. */
export async function putAsset(blob: Blob): Promise<string> {
  const id = uid()
  urlCache.set(id, URL.createObjectURL(blob))
  const user = await currentUserId()
  track(
    supabase.storage
      .from(ASSET_BUCKET)
      .upload(`${user}/${id}`, blob, { contentType: blob.type || 'image/png', upsert: false })
      .then(check),
    'upload an image',
  )
  return id
}

export const cachedAssetUrl = (id: string) => urlCache.get(id)

const inflight = new Map<string, Promise<string | undefined>>()
export function getAssetUrl(id: string): Promise<string | undefined> {
  const hit = urlCache.get(id)
  if (hit) return Promise.resolve(hit)
  let p = inflight.get(id)
  if (!p) {
    p = (async () => {
      const user = await currentUserId()
      const { data, error } = await supabase.storage.from(ASSET_BUCKET).download(`${user}/${id}`)
      if (error || !data) return undefined
      const url = URL.createObjectURL(data)
      urlCache.set(id, url)
      return url
    })().finally(() => inflight.delete(id))
    inflight.set(id, p)
  }
  return p
}

export function clearAssetCache() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
}

/**
 * Delete stored images no board references anymore. Skips anything uploaded in the last hour
 * so an upload from another open tab or device can't be swept before its board saves.
 */
export async function collectGarbage() {
  await flushSaves()
  const user = await currentUserId()
  const rows = check(await supabase.from('boards').select('items')) as Pick<Row, 'items'>[]
  const used = new Set<string>()
  for (const r of rows) for (const it of r.items ?? []) if (it.type === 'image' && it.assetId) used.add(it.assetId)

  const stale: string[] = []
  const cutoff = Date.now() - 60 * 60 * 1000
  for (let offset = 0; ; offset += 1000) {
    const page = check(await supabase.storage.from(ASSET_BUCKET).list(user, { limit: 1000, offset }))
    for (const f of page) if (!used.has(f.name) && Date.parse(f.created_at ?? '') < cutoff) stale.push(`${user}/${f.name}`)
    if (page.length < 1000) break
  }
  if (stale.length) check(await supabase.storage.from(ASSET_BUCKET).remove(stale))
  for (const path of stale) {
    const id = path.split('/')[1]
    const url = urlCache.get(id)
    if (url) URL.revokeObjectURL(url)
    urlCache.delete(id)
  }
}

export function itemsBounds(items: Item[]) {
  if (!items.length) return null
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity
  for (const it of items) {
    x1 = Math.min(x1, it.x)
    y1 = Math.min(y1, it.y)
    x2 = Math.max(x2, it.x + it.w)
    y2 = Math.max(y2, it.y + it.h)
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}
