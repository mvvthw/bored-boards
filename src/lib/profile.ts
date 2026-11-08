import { useSyncExternalStore } from 'react'
import type { Profile } from './types'
import { supabase } from './supabase'

export const PROFILE_COLORS = ['#ff6b5e', '#ff9f43', '#f7c948', '#4cd07d', '#3fc1c9', '#5b8cff', '#a07cff', '#ff6fb5']

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/

/** `undefined` = not loaded yet, `null` = signed in but no profile set. */
let current: Profile | null | undefined
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function useProfile() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

export async function loadProfile(userId: string) {
  const { data, error } = await supabase.from('profiles').select('id, username, display_name, color').eq('id', userId).maybeSingle()
  if (error) throw new Error(error.message)
  current = (data as Profile | null) ?? null
  emit()
  return current
}

export function resetProfile() {
  current = undefined
  emit()
}

export async function saveProfile(p: Profile) {
  const { error } = await supabase.from('profiles').upsert({ ...p, display_name: p.display_name?.trim() || null, updated_at: new Date().toISOString() })
  if (error) throw new Error(error.code === '23505' ? 'That username is taken' : error.message)
  current = p
  emit()
}

/** A free-looking starting username from an email address. */
export function suggestUsername(email?: string) {
  const base = (email?.split('@')[0] ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16)
  return base.length >= 3 ? base : `user${Math.floor(Math.random() * 9000 + 1000)}`
}

/** Stable fallback colour for people without a profile. */
export function colorFor(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0
  return PROFILE_COLORS[Math.abs(h) % PROFILE_COLORS.length]
}

export const nameOf = (p: Pick<Profile, 'username' | 'display_name'> | null | undefined, fallback = 'Someone') =>
  p ? p.display_name?.trim() || p.username : fallback
