import { useEffect, useState } from 'react'
import { navigate, useRoute } from './lib/hooks'
import { useSession } from './lib/auth'
import { loadProfile, resetProfile, useProfile } from './lib/profile'
import Dashboard from './pages/Dashboard'
import Board from './pages/Board'
import AuthScreen from './pages/AuthScreen'
import JoinScreen from './pages/JoinScreen'
import ProfileDialog from './components/ProfileDialog'
import { Toaster } from './components/ui'

const PENDING_INVITE = 'bored:pending-invite'

export default function App() {
  const route = useRoute()
  const session = useSession()
  const profile = useProfile()
  const uid = session?.user.id
  const [skipWelcome, setSkipWelcome] = useState(false)

  useEffect(() => {
    if (uid) loadProfile(uid).catch(console.error)
    else resetProfile()
  }, [uid])

  // An invite opened while signed out is remembered through the magic-link round trip.
  useEffect(() => {
    try {
      if (session === null && route.name === 'join') localStorage.setItem(PENDING_INVITE, route.token)
      if (session) {
        const t = localStorage.getItem(PENDING_INVITE)
        if (t) {
          localStorage.removeItem(PENDING_INVITE)
          if (route.name !== 'join') navigate(`/join/${t}`)
        }
      }
    } catch {
      /* storage unavailable */
    }
  }, [session, route])

  if (session === undefined) return <Toaster />
  if (!session) {
    return (
      <>
        <AuthScreen invited={route.name === 'join'} />
        <Toaster />
      </>
    )
  }
  const user = { id: session.user.id, email: session.user.email }
  return (
    <>
      {route.name === 'board' ? (
        <Board key={route.id} id={route.id} user={user} />
      ) : route.name === 'join' ? (
        <JoinScreen key={route.token} token={route.token} />
      ) : (
        <Dashboard />
      )}
      <ProfileDialog open={profile === null && !skipWelcome} onClose={() => setSkipWelcome(true)} user={user} welcome />
      <Toaster />
    </>
  )
}
