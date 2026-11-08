import type { BoardData, BoardMeta, Item, Profile, Viewport } from './types'
import { ASSET_BUCKET, supabase } from './supabase'
import { toast } from '../components/ui'

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

type Row = { id: string; user_id: string; name: string; items: Item[]; viewport: Viewport | null; created_at: string; updated_at: string }
const META = 'id, user_id, name, created_at, updated_at'

const toMeta = (r: Pick<Row, 'id' | 'user_id' | 'name' | 'created_at' | 'updated_at'>): BoardMeta => ({
  id: r.id,
  name: r.name,
  createdAt: Date.parse(r.created_at),
  updatedAt: Date.parse(r.updated_at),
  ownerId: r.user_id,
})

export async function currentUserId() {
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
  const rows = check(await supabase.from('boards').select(`${META}, items, viewport`).order('updated_at', { ascending: false })) as Row[]
  return rows.map((r) => ({ ...toMeta(r), data: { id: r.id, items: r.items ?? [], viewport: r.viewport ?? undefined } }))
}

export async function getBoardMeta(id: string): Promise<BoardMeta | undefined> {
  const { data: row, error } = await supabase.from('boards').select(META).eq('id', id).maybeSingle()
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

/** Viewport is left alone when omitted (collaborators keep their own view locally). */
export const saveBoardData = (d: BoardData) =>
  track(
    supabase
      .from('boards')
      .update(d.viewport ? { items: d.items, viewport: d.viewport } : { items: d.items })
      .eq('id', d.id)
      .then(check),
    'save your changes',
  )

export async function createBoard(name: string): Promise<BoardMeta> {
  const row = check(await supabase.from('boards').insert({ id: uid(), name: name.trim() || 'Untitled Board' }).select(META).single())
  return toMeta(row)
}

export async function duplicateBoard(id: string): Promise<BoardMeta> {
  const src = check(await supabase.from('boards').select('user_id, name, items, viewport').eq('id', id).single()) as Pick<Row, 'user_id' | 'name' | 'items' | 'viewport'>
  // Older images don't record whose folder they're in (it was always the board owner); the copy has a new owner, so say so.
  const items = (src.items ?? []).map((i) => (i.type === 'image' && i.assetId && !i.assetOwner ? { ...i, assetOwner: src.user_id } : i))
  const row = check(await supabase.from('boards').insert({ id: uid(), name: `${src.name} copy`, items, viewport: src.viewport }).select(META).single())
  return toMeta(row)
}

export async function deleteBoard(id: string) {
  check(await supabase.from('boards').delete().eq('id', id))
  await collectGarbage()
}

/* ---------- sharing ---------- */

export type Member = { userId: string; owner: boolean; profile?: Profile }

/** Owner first, then members in join order, each with their profile when they've set one. */
export async function listMembers(boardId: string, ownerId: string): Promise<Member[]> {
  const rows = check(await supabase.from('board_members').select('user_id, joined_at').eq('board_id', boardId).order('joined_at')) as { user_id: string }[]
  const ids = [ownerId, ...rows.map((r) => r.user_id).filter((u) => u !== ownerId)]
  const profiles = check(await supabase.from('profiles').select('id, username, display_name, color').in('id', ids)) as Profile[]
  const byId = new Map(profiles.map((p) => [p.id, p]))
  return ids.map((u) => ({ userId: u, owner: u === ownerId, profile: byId.get(u) }))
}

export async function removeMember(boardId: string, userId: string) {
  check(await supabase.from('board_members').delete().eq('board_id', boardId).eq('user_id', userId))
}

export const leaveBoard = async (boardId: string) => removeMember(boardId, await currentUserId())

/** Owner only: the board's invite token, created on first use (or replaced with `reset`). */
export async function getInviteToken(boardId: string, reset = false): Promise<string> {
  return check(await supabase.rpc('board_invite', { b: boardId, reset })) as string
}

export async function revokeInvite(boardId: string) {
  check(await supabase.rpc('revoke_board_invite', { b: boardId }))
}

export type InviteInfo = { board_id: string; board_name: string; owner_username: string | null; owner_name: string | null; owner_color: string | null; already_member: boolean }

export async function inviteInfo(token: string): Promise<InviteInfo | null> {
  const rows = check(await supabase.rpc('invite_info', { token })) as InviteInfo[]
  return rows[0] ?? null
}

export async function joinBoard(token: string): Promise<string> {
  return check(await supabase.rpc('join_board', { token })) as string
}

export const inviteUrl = (token: string) => `${window.location.origin}/#/join/${token}`

/* ---------- assets (private bucket, one folder per user) ---------- */

const urlCache = new Map<string, string>()

/** Returns immediately with a local preview; the upload finishes in the background. */
export async function putAsset(blob: Blob): Promise<{ id: string; owner: string }> {
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
  return { id, owner: user }
}

export const cachedAssetUrl = (id: string) => urlCache.get(id)

const inflight = new Map<string, Promise<string | undefined>>()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
/**
 * `owner`: whose folder the file lives in (defaults to you). A collaborator's fresh image can show up
 * live before its upload or the board save lands, so misses are retried for a little while.
 */
export function getAssetUrl(id: string, owner?: string): Promise<string | undefined> {
  const hit = urlCache.get(id)
  if (hit) return Promise.resolve(hit)
  let p = inflight.get(id)
  if (!p) {
    p = (async () => {
      const user = owner ?? (await currentUserId())
      for (const delay of [0, 800, 1600, 3200, 6400]) {
        if (delay) await wait(delay)
        const { data, error } = await supabase.storage.from(ASSET_BUCKET).download(`${user}/${id}`)
        if (error || !data) continue
        const url = URL.createObjectURL(data)
        urlCache.set(id, url)
        return url
      }
      return undefined
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
  // Every board that still shows one of your images counts, including shared boards you can't open anymore.
  const used = new Set(check(await supabase.rpc('my_used_assets')) as string[])

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
