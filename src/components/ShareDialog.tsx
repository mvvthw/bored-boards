import { useCallback, useEffect, useState } from 'react'
import { Check, Link2, RotateCcw, X } from 'lucide-react'
import { Dialog, toast } from './ui'
import { Avatar } from './Avatar'
import { getInviteToken, inviteUrl, leaveBoard, listMembers, removeMember, revokeInvite, type Member } from '../lib/db'
import { supabase } from '../lib/supabase'
import { colorFor, nameOf } from '../lib/profile'
import { navigate } from '../lib/hooks'

export default function ShareDialog({ open, onClose, boardId, ownerId, isOwner }: { open: boolean; onClose: () => void; boardId: string; ownerId: string; isOwner: boolean }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [token, setToken] = useState<string | null | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const [me, setMe] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [{ data }, list] = await Promise.all([supabase.auth.getSession(), listMembers(boardId, ownerId)])
      setMe(data.session?.user.id ?? null)
      setMembers(list)
      if (isOwner) setToken(await getInviteToken(boardId))
      else {
        // Members can pass on an existing link but not create one.
        const { data: row } = await supabase.from('boards').select('invite_token').eq('id', boardId).maybeSingle()
        setToken((row?.invite_token as string | null) ?? null)
      }
    } catch (e) {
      toast((e as Error).message)
    }
  }, [boardId, ownerId, isOwner])

  useEffect(() => {
    if (!open) return
    setCopied(false)
    load()
  }, [open, load])

  const copy = async () => {
    if (!token) return
    await navigator.clipboard.writeText(inviteUrl(token))
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <h3 className="dialog-title">Share board</h3>
      <p className="dialog-text">Anyone with the link can join after signing in, then add and move things with you in real time.</p>

      {token ? (
        <div className="invite-row">
          <div className="invite-link">
            <Link2 size={15} />
            <span>{inviteUrl(token).replace(/^https?:\/\//, '')}</span>
          </div>
          <button className="btn btn-primary invite-copy" onClick={copy}>
            {copied ? <Check size={16} strokeWidth={2.4} /> : null}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      ) : token === null ? (
        <p className="share-note">{isOwner ? 'The invite link is off.' : 'Only the owner can create an invite link.'}</p>
      ) : (
        <div className="invite-row invite-loading" />
      )}

      {isOwner && token !== undefined && (
        <div className="share-link-actions">
          {token ? (
            <>
              <button
                className="link-btn"
                onClick={async () => {
                  setToken(await getInviteToken(boardId, true))
                  toast('New link created — the old one no longer works')
                }}
              >
                <RotateCcw size={13} /> New link
              </button>
              <button
                className="link-btn"
                onClick={async () => {
                  await revokeInvite(boardId)
                  setToken(null)
                }}
              >
                Turn off link
              </button>
            </>
          ) : (
            <button className="link-btn" onClick={async () => setToken(await getInviteToken(boardId))}>
              Turn on link
            </button>
          )}
        </div>
      )}

      <div className="members">
        <div className="members-title">People</div>
        {(members ?? []).map((m) => {
          const name = nameOf(m.profile, 'No profile yet')
          return (
            <div key={m.userId} className="member-row">
              <Avatar name={name} color={m.profile?.color ?? colorFor(m.userId)} size={30} />
              <div className="member-text">
                <span className="member-name">
                  {name}
                  {m.userId === me && <span className="member-you"> (you)</span>}
                </span>
                {m.profile && <span className="member-handle">@{m.profile.username}</span>}
              </div>
              <span className="member-role">{m.owner ? 'Owner' : 'Can edit'}</span>
              {!m.owner && (isOwner || m.userId === me) && (
                <button
                  className="icon-btn member-remove"
                  title={m.userId === me ? 'Leave board' : 'Remove from board'}
                  onClick={async () => {
                    if (m.userId === me) {
                      await leaveBoard(boardId)
                      onClose()
                      navigate('/')
                      return
                    }
                    await removeMember(boardId, m.userId)
                    setMembers((l) => l?.filter((x) => x.userId !== m.userId) ?? null)
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  )
}
