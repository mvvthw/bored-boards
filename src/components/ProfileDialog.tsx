import { useEffect, useState } from 'react'
import { AtSign, Check } from 'lucide-react'
import { Dialog, TextField, toast } from './ui'
import { Avatar } from './Avatar'
import { PROFILE_COLORS, USERNAME_RE, saveProfile, suggestUsername, useProfile } from '../lib/profile'

/** Set your username, display name and colour. `welcome`: first-time wording. */
export default function ProfileDialog({ open, onClose, user, welcome = false }: { open: boolean; onClose: () => void; user: { id: string; email?: string }; welcome?: boolean }) {
  const profile = useProfile()
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [color, setColor] = useState(PROFILE_COLORS[5])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setUsername(profile?.username ?? suggestUsername(user.email))
    setName(profile?.display_name ?? '')
    setColor(profile?.color ?? PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)])
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const clean = username.trim().toLowerCase()
  const valid = USERNAME_RE.test(clean)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!valid) return setError('3–20 letters, numbers or underscores')
    setBusy(true)
    setError(null)
    try {
      await saveProfile({ id: user.id, username: clean, display_name: name.trim() || null, color })
      if (!welcome) toast('Profile saved')
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="profile-head">
          <Avatar name={name || clean || '?'} color={color} size={56} />
          <div>
            <h3 className="dialog-title">{welcome ? 'Set up your profile' : 'Profile'}</h3>
            <p className="dialog-text profile-sub">{welcome ? 'This is how people you share boards with will see you.' : user.email}</p>
          </div>
        </div>
        <div className="profile-fields">
          <TextField
            icon={<AtSign size={15} />}
            placeholder="username"
            value={username}
            maxLength={20}
            autoFocus
            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          />
          <TextField placeholder="Display name (optional)" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
          <div className="swatches" role="radiogroup" aria-label="Colour">
            {PROFILE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={c === color}
                className={`swatch-dot${c === color ? ' on' : ''}`}
                style={{ '--c': c } as React.CSSProperties}
                onClick={() => setColor(c)}
              >
                {c === color && <Check size={14} strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="auth-message error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {welcome ? 'Later' : 'Cancel'}
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !valid}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
