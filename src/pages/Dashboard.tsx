import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, LogOut, MoreHorizontal, PenLine, Plus, Search, Trash2, UserRound, Users } from 'lucide-react'
import type { BoardData, BoardMeta } from '../lib/types'
import { collectGarbage, createBoard, deleteBoard, duplicateBoard, leaveBoard, listBoardsWithData, saveBoardMeta } from '../lib/db'
import { signOut, useSession } from '../lib/auth'
import { navigate, timeAgo } from '../lib/hooks'
import { AssetOwnerCtx, BoardThumb } from '../components/ItemViews'
import { Avatar } from '../components/Avatar'
import ProfileDialog from '../components/ProfileDialog'
import { nameOf, useProfile } from '../lib/profile'
import { Dialog, Menu, Presence, TextField, toast, useSize, type MenuItem } from '../components/ui'
import { Wordmark } from '../components/Logo'

type Row = BoardMeta & { data: BoardData }

export default function Dashboard() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null)

  const [account, setAccount] = useState<DOMRect | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)
  const session = useSession()
  const profile = useProfile()
  const me = session?.user.id

  const load = useCallback(async () => {
    try {
      setRows(await listBoardsWithData())
    } catch (e) {
      console.error(e)
      setRows((r) => r ?? [])
      toast('Couldn’t load your boards — check your connection')
    }
  }, [])

  useEffect(() => {
    load().then(() => collectGarbage().catch(console.error))
  }, [load])

  const rename = async (row: Row, name: string) => {
    const meta: BoardMeta = { id: row.id, name: name.trim() || row.name, createdAt: row.createdAt, updatedAt: row.updatedAt, ownerId: row.ownerId }
    await saveBoardMeta(meta)
    load()
  }

  const visible = (rows ?? []).filter((r) => r.name.toLowerCase().includes(query.trim().toLowerCase()))

  return (
    <div className="dashboard">
      <Ambient />
      <header className="dash-header">
        <div className="dash-title-row">
          <Wordmark />
          <div className="dash-actions">
            <TextField icon={<Search size={16} strokeWidth={2} />} placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Plus size={18} strokeWidth={2.2} />
              <span>New Board</span>
            </button>
            <button className="icon-btn glass account-btn" aria-label="Account" onClick={(e) => setAccount(e.currentTarget.getBoundingClientRect())}>
              {profile ? <Avatar name={nameOf(profile)} color={profile.color} size={30} /> : <UserRound size={17} />}
            </button>
          </div>
          <Presence id={account ? 'account' : null}>
            {account && (
              <Menu
                anchor={account}
                header={profile ? `@${profile.username}` : session?.user.email}
                items={[
                  { label: profile ? 'Edit profile' : 'Set up profile', icon: <UserRound size={15} />, onSelect: () => setEditingProfile(true) },
                  { label: 'Sign out', icon: <LogOut size={15} />, onSelect: signOut },
                ]}
                onClose={() => setAccount(null)}
              />
            )}
          </Presence>
        </div>
      </header>

      {rows && rows.length === 0 && (
        <div className="empty glass">
          <div className="empty-art">
            <span />
            <span />
            <span />
          </div>
          <h2>Start your first board</h2>
          <p>Collect references from Pinterest, Grailed and anywhere else. Crop to the wash, the distressing, the detail that matters.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={18} strokeWidth={2.2} /> New Board
          </button>
        </div>
      )}

      <div className="board-grid">
        {visible.map((r) => (
          <BoardCard
            key={r.id}
            row={r}
            shared={!!me && r.ownerId !== me}
            onLeave={async () => {
              await leaveBoard(r.id)
              load()
            }}
            onRename={(n) => rename(r, n)}
            onDuplicate={async () => {
              try {
                await duplicateBoard(r.id)
              } catch (e) {
                console.error(e)
                toast('Couldn’t duplicate the board — try again')
              }
              load()
            }}
            onDelete={() => setConfirmDelete(r)}
          />
        ))}
        {rows && rows.length > 0 && (
          <button className="board-card new-card" onClick={() => setCreating(true)}>
            <div className="new-card-inner">
              <Plus size={28} strokeWidth={1.5} />
              <span>New Board</span>
            </div>
          </button>
        )}
      </div>

      <NewBoardDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={async (name) => {
          try {
            const m = await createBoard(name)
            navigate(`/board/${m.id}`)
          } catch (e) {
            console.error(e)
            toast('Couldn’t create the board — try again')
          }
        }}
      />

      {session && <ProfileDialog open={editingProfile} onClose={() => setEditingProfile(false)} user={{ id: session.user.id, email: session.user.email }} />}

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <h3 className="dialog-title">Delete “{confirmDelete?.name}”?</h3>
        <p className="dialog-text">This board and its images will be removed from this device. This can’t be undone.</p>
        <div className="dialog-actions">
          <button className="btn" onClick={() => setConfirmDelete(null)}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              const id = confirmDelete!.id
              setConfirmDelete(null)
              await deleteBoard(id)
              load()
            }}
          >
            Delete
          </button>
        </div>
      </Dialog>
    </div>
  )
}

function BoardCard({
  row,
  shared,
  onRename,
  onDuplicate,
  onDelete,
  onLeave,
}: {
  row: Row
  shared: boolean
  onRename: (n: string) => void
  onDuplicate: () => void
  onDelete: () => void
  onLeave: () => void
}) {
  const [thumbRef, size] = useSize<HTMLDivElement>()
  const [editing, setEditing] = useState(false)
  const [menu, setMenu] = useState<DOMRect | null>(null)
  const count = row.data.items.length
  const images = row.data.items.filter((i) => i.type === 'image').length

  const menuItems: MenuItem[] = [
    { label: 'Rename', icon: <PenLine size={15} />, onSelect: () => setEditing(true) },
    { label: 'Duplicate', icon: <Copy size={15} />, onSelect: onDuplicate },
    shared
      ? { label: 'Leave board', icon: <LogOut size={15} />, danger: true, onSelect: onLeave }
      : { label: 'Delete', icon: <Trash2 size={15} />, danger: true, onSelect: onDelete },
  ]

  return (
    <div className="board-card" onClick={() => !editing && navigate(`/board/${row.id}`)}>
      <div className="thumb" ref={thumbRef}>
        <AssetOwnerCtx.Provider value={row.ownerId}>
          {count === 0 ? <div className="thumb-empty">Empty board</div> : size.width > 0 && <BoardThumb items={row.data.items} width={size.width} height={size.height} />}
        </AssetOwnerCtx.Provider>
        {shared && (
          <span className="shared-badge glass">
            <Users size={13} strokeWidth={2.2} /> Shared
          </span>
        )}
        <button
          className="icon-btn glass card-more"
          aria-label="Board options"
          onClick={(e) => {
            e.stopPropagation()
            setMenu(e.currentTarget.getBoundingClientRect())
          }}
        >
          <MoreHorizontal size={18} />
        </button>
      </div>
      <div className="card-footer">
        {editing ? (
          <div className="card-name">
            <InlineName
              value={row.name}
              onDone={(v) => {
                setEditing(false)
                if (v !== row.name) onRename(v)
              }}
            />
          </div>
        ) : (
          <div
            className="card-name"
            onDoubleClick={(e) => {
              e.stopPropagation()
              setEditing(true)
            }}
          >
            {row.name}
          </div>
        )}
        <div className="card-meta">
          {images} {images === 1 ? 'image' : 'images'}
          {count - images > 0 && ` · ${count - images} ${count - images === 1 ? 'note' : 'notes'}`} · {timeAgo(row.updatedAt)}
        </div>
      </div>
      <Presence id={menu ? 'menu' : null}>{menu && <Menu anchor={menu} items={menuItems} onClose={() => setMenu(null)} />}</Presence>
    </div>
  )
}

/** Text that becomes editable in place — same typography, no inner box. */
export function InlineName({ value, onDone }: { value: string; onDone: (v: string) => void }) {
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (next: string) => {
    if (done.current) return
    done.current = true
    onDone(next)
  }
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <span className="inline-edit" data-value={v}>
      <input
        ref={ref}
        value={v}
        aria-label="Name"
        spellCheck={false}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => finish(v.trim() || value)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') ref.current?.blur()
          if (e.key === 'Escape') finish(value)
        }}
      />
    </span>
  )
}

function NewBoardDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (n: string) => void }) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setName('')
  }, [open])
  return (
    <Dialog open={open} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onCreate(name)
        }}
      >
        <h3 className="dialog-title">New Board</h3>
        <p className="dialog-text">Name it after a drop, a piece, or a direction.</p>
        <TextField autoFocus placeholder="e.g. FW26 — Washed Denim" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Create
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function Ambient() {
  return (
    <div className="ambient" aria-hidden>
      <div className="blob b1" />
      <div className="blob b2" />
      <div className="blob b3" />
    </div>
  )
}
