import { useEffect, useState, useSyncExternalStore } from 'react'
import { cachedAssetUrl, getAssetUrl } from './db'

/* ---------- hash router ---------- */

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useRoute(): { name: 'home' } | { name: 'board'; id: string } {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash)
  const m = hash.match(/^#\/board\/([\w-]+)/)
  return m ? { name: 'board', id: m[1] } : { name: 'home' }
}

export const navigate = (path: string) => {
  window.location.hash = path
}

/* ---------- assets ---------- */

export function useAssetUrl(assetId?: string, src?: string) {
  const [url, setUrl] = useState<string | undefined>(() => (assetId ? cachedAssetUrl(assetId) : src))
  useEffect(() => {
    if (!assetId) return setUrl(src)
    let live = true
    getAssetUrl(assetId).then((u) => live && setUrl(u ?? src))
    return () => {
      live = false
    }
  }, [assetId, src])
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
