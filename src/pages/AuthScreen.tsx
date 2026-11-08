import { useState } from 'react'
import { Mail, MailCheck } from 'lucide-react'
import { LogoMark } from '../components/Logo'
import { TextField } from '../components/ui'
import { sendMagicLink } from '../lib/auth'

export default function AuthScreen({ invited = false }: { invited?: boolean }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const to = email.trim()
    setBusy(true)
    setError(null)
    try {
      await sendMagicLink(to)
      setSentTo(to)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="ambient" aria-hidden>
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
      </div>
      {sentTo ? (
        <div className="auth-card glass" key="sent">
          <div className="auth-icon">
            <MailCheck size={26} strokeWidth={1.6} />
          </div>
          <h1 className="auth-title">Check your inbox</h1>
          <p className="auth-sub">
            We sent a sign-in link to <span className="auth-email">{sentTo}</span>. Tap it to sign in.
          </p>
          <button
            className="link-btn auth-switch"
            onClick={() => {
              setSentTo(null)
              setError(null)
            }}
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form className="auth-card glass" key="form" onSubmit={submit}>
          <LogoMark className="auth-mark" />
          <h1 className="auth-title">bored</h1>
          <p className="auth-sub">{invited ? 'You’ve been invited to a board. Sign in with your email to join.' : 'Enter your email and we’ll send you a link to sign in.'}</p>
          <div className="auth-fields">
            <TextField icon={<Mail size={16} />} type="email" placeholder="Email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          {error && <p className="auth-message error">{error}</p>}
          <button className="btn btn-primary auth-submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send Magic Link'}
          </button>
        </form>
      )}
    </div>
  )
}
