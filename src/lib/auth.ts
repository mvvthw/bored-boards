import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { clearAssetCache, flushSaves } from './db'

/** `undefined` while the stored session is being restored, `null` when signed out. */
export function useSession() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  return session
}

/** Emails a one-tap sign-in link. New emails get an account automatically. */
export async function sendMagicLink(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin, shouldCreateUser: true },
  })
  if (error) throw error
}

export async function signOut() {
  await flushSaves()
  await supabase.auth.signOut()
  clearAssetCache()
  window.location.hash = '/'
}
