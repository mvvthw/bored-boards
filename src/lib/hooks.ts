import { useEffect, useState, useSyncExternalStore } from 'react'
import { cachedAssetUrl, getAssetUrl } from './db'

/* ---------- hash router ---------- */

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export type Route = { name: 'home' } | { name: 'board'; id: string } | { name: 'join'; token: string }

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  const b = hash.match(/^#\/board\/([\w-]+)/)
  if (b) return { name: 'board', id: b[1] }
  const j = hash.match(/^#\/join\/([\w-]+)/)
  if (j) return { name: 'join', token: j[1] }
  return { name: 'home' }
}

export const navigate = (path: string) => {
  window.location.hash = path
}

/* ---------- assets ---------- */

export function useAssetUrl(assetId?: string, src?: string, owner?: string) {
  const [url, setUrl] = useState<string | undefined>(() => (assetId ? cachedAssetUrl(assetId) : src))
  useEffect(() => {
    if (!assetId) return setUrl(src)
    let live = true
    getAssetUrl(assetId, owner).then((u) => live && setUrl(u ?? src))
    return () => {
      live = false
    }
  }, [assetId, src, owner])
  return url
}

/* ---------- time ---------- */

export function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 45) return 'Just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
