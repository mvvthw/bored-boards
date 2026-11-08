import { putAsset } from './db'

export type Imported = { assetId?: string; assetOwner?: string; src?: string; natW: number; natH: number; source?: string }

function measure(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = url
  })
}

export async function importFile(file: Blob): Promise<Imported> {
  const { id: assetId, owner: assetOwner } = await putAsset(file)
  const tmp = URL.createObjectURL(file)
  try {
    const { w, h } = await measure(tmp)
    return { assetId, assetOwner, natW: w, natH: h }
  } finally {
    URL.revokeObjectURL(tmp)
  }
}

/** Try to copy a remote image locally; fall back to hot-linking when CORS blocks it. */
export async function importUrl(url: string): Promise<Imported> {
  try {
    const res = await fetch(url, { mode: 'cors' })
    const blob = await res.blob()
    if (res.ok && blob.type.startsWith('image/')) return { ...(await importFile(blob)), source: url }
  } catch {
    /* fall through */
  }
  const { w, h } = await measure(url)
  return { src: url, natW: w, natH: h, source: url }
}

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i

/** Pull image URLs out of a drop / paste payload (Pinterest, Grailed, etc. give HTML or URI lists). */
export function extractImageUrls(dt: DataTransfer): string[] {
  const html = dt.getData('text/html')
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const srcs = [...doc.querySelectorAll('img')]
      .map((img) => bestSrc(img))
      .filter((s): s is string => !!s && /^https?:/.test(s))
    if (srcs.length) return [...new Set(srcs)]
  }
  const list = (dt.getData('text/uri-list') || dt.getData('text/plain') || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#') && /^https?:/.test(s))
  return list.filter((u) => IMG_EXT.test(u) || /pinimg|grailed|imgix|cloudfront|cdn/i.test(u))
}

function bestSrc(img: HTMLImageElement): string | null {
  const srcset = img.getAttribute('srcset')
  if (srcset) {
    const last = srcset.split(',').map((s) => s.trim().split(/\s+/)[0]).filter(Boolean).pop()
    if (last) return last
  }
  return img.getAttribute('src')
}
