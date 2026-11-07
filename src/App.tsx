import { useRoute } from './lib/hooks'
import { useSession } from './lib/auth'
import Dashboard from './pages/Dashboard'
import Board from './pages/Board'
import AuthScreen from './pages/AuthScreen'
import { Toaster } from './components/ui'

export default function App() {
  const route = useRoute()
  const session = useSession()
  return (
    <>
      {session === undefined ? null : !session ? (
        <AuthScreen />
      ) : route.name === 'board' ? (
        <Board key={route.id} id={route.id} />
      ) : (
        <Dashboard />
      )}
      <Toaster />
    </>
  )
}
