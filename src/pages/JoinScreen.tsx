import { useEffect, useState } from 'react'
import { LogoMark } from '../components/Logo'
import { Avatar } from '../components/Avatar'
import { inviteInfo, joinBoard, type InviteInfo } from '../lib/db'
import { navigate } from '../lib/hooks'

/** Where an invite link lands: who's sharing what, and a button to join. */
export default function JoinScreen({ token }: { token: string }) {
  const [info, setInfo] = useState<InviteInfo | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    inviteInfo(token)
      .then((i) => {
        if (!live) return
        if (i?.already_member) navigate(`/board/${i.board_id}`)
        else setInfo(i)
      })
      .catch(() => live && setInfo(null))
    return () => {
      live = false
    }
  }, [token])

  const join = async () => {
    setBusy(true)
    setError(null)
    try {
      navigate(`/board/${await joinBoard(token)}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const owner = info ? info.owner_name || info.owner_username || 'Someone' : ''

  return (
    <div className="auth">
      <div className="ambient" aria-hidden>
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
      </div>
      {info === undefined ? null : info === null ? (
        <div className="auth-card glass" key="bad">
          <LogoMark className="auth-mark" />
          <h1 className="auth-title join-title">Link not valid</h1>
          <p className="auth-sub">This invite link has been turned off or replaced. Ask for a new one.</p>
          <button className="btn auth-submit" onClick={() => navigate('/')}>
            Go to my boards
          </button>
        </div>
      ) : (
        <div className="auth-card glass" key="join">
          <Avatar name={owner} color={info.owner_color ?? '#8e8e93'} size={52} />
          <p className="auth-sub join-by">
            <span className="auth-email">{owner}</span>
            {info.owner_username && info.owner_name ? ` (@${info.owner_username})` : ''} invited you to
          </p>
          <h1 className="auth-title join-title">{info.board_name}</h1>
          <p className="auth-sub">Add references and move things around together, live.</p>
          {error && <p className="auth-message error">{error}</p>}
          <button className="btn btn-primary auth-submit" disabled={busy} onClick={join}>
            {busy ? 'Joining…' : 'Join board'}
          </button>
          <button className="link-btn auth-switch" onClick={() => navigate('/')}>
            Not now
          </button>
        </div>
      )}
    </div>
  )
}
