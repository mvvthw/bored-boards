import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Item } from './types'

/** One per open tab, so the same person in two tabs still syncs. */
export const CLIENT_ID = Math.random().toString(36).slice(2, 10)

export type Peer = { cid: string; uid: string; name: string; color: string }
export type Ops = { upsert: Item[]; remove: string[] }
export type Cursor = { x: number | null; y: number | null; t: number }

type Handlers = {
  onOps: (ops: Ops) => void
  /** A peer that just joined asks for the current items; reply with `sendState`. */
  onHello: () => void
  onState: (items: Item[]) => void
}

/**
 * Private broadcast + presence channel for a board ("board:<id>"). Only the owner and members can
 * subscribe (database policy). Items travel as small upsert/remove patches; cursors in world units.
 */
export function useBoardChannel(boardId: string, me: Omit<Peer, 'cid'> | null, h: Handlers) {
  const [peers, setPeers] = useState<Peer[]>([])
  const [cursors, setCursors] = useState<Record<string, Cursor>>({})
  const chRef = useRef<RealtimeChannel | null>(null)
  const ready = useRef(false)
  const hRef = useRef(h)
  hRef.current = h
  const meRef = useRef(me)
  meRef.current = me

  const enabled = !!me
  useEffect(() => {
    if (!enabled) return
    let closed = false
    let ch: RealtimeChannel | null = null
    ;(async () => {
      // Private channels authorize with the user's token.
      const { data } = await supabase.auth.getSession()
      if (closed) return
      if (data.session) supabase.realtime.setAuth(data.session.access_token)
      ch = supabase.channel(`board:${boardId}`, { config: { private: true, broadcast: { self: false }, presence: { key: CLIENT_ID } } })
      chRef.current = ch
      ch.on('broadcast', { event: 'ops' }, ({ payload }) => hRef.current.onOps(payload as Ops))
        .on('broadcast', { event: 'hello' }, () => hRef.current.onHello())
        .on('broadcast', { event: 'state' }, ({ payload }) => hRef.current.onState((payload as { items: Item[] }).items))
        .on('broadcast', { event: 'cursor' }, ({ payload }) => {
          const { cid, x, y } = payload as { cid: string; x: number; y: number }
          setCursors((c) => ({ ...c, [cid]: { x, y, t: Date.now() } }))
        })
        .on('presence', { event: 'sync' }, () => {
          const state = ch!.presenceState<Peer>()
          const list = Object.values(state)
            .map((v) => v[v.length - 1]) // latest track wins
            .filter((p): p is Peer & { presence_ref: string } => !!p && p.cid !== CLIENT_ID)
            .map(({ cid, uid, name, color }) => ({ cid, uid, name, color }))
          setPeers(list)
          setCursors((c) => Object.fromEntries(Object.entries(c).filter(([cid]) => list.some((p) => p.cid === cid))))
        })
        .subscribe(async (status) => {
          if (status !== 'SUBSCRIBED' || closed) return
          ready.current = true
          if (meRef.current) await ch!.track({ cid: CLIENT_ID, ...meRef.current })
          ch!.send({ type: 'broadcast', event: 'hello', payload: { cid: CLIENT_ID } })
        })
    })()
    return () => {
      closed = true
      ready.current = false
      chRef.current = null
      if (ch) supabase.removeChannel(ch)
      setPeers([])
      setCursors({})
    }
  }, [boardId, enabled])

  // Name or colour changed: update presence in place rather than rejoining.
  useEffect(() => {
    if (ready.current && me) chRef.current?.track({ cid: CLIENT_ID, ...me })
  }, [me?.uid, me?.name, me?.color])

  const send = (event: string, payload: unknown) => {
    if (ready.current) chRef.current?.send({ type: 'broadcast', event, payload })
  }
  return {
    peers,
    cursors,
    sendOps: (ops: Ops) => send('ops', ops),
    sendState: (items: Item[]) => send('state', { items }),
    sendCursor: (x: number | null, y: number | null) => send('cursor', { cid: CLIENT_ID, x, y }),
  }
}
