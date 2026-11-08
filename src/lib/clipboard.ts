import type { ImageItem } from './types'
import { getAssetUrl } from './db'
import { toast } from '../components/ui'

const MAX = 4096

async function sourceUrl(item: ImageItem, boardOwner?: string) {
  const url = item.assetId ? await getAssetUrl(item.assetId, item.assetOwner ?? boardOwner) : item.src
  if (!url) throw new Error('Image not loaded')
  return url
}

/** The image as it appears on the board (cropped), at full resolution, as a PNG. */
export async function croppedPng(item: ImageItem, boardOwner?: string): Promise<Blob> {
  const url = await sourceUrl(item, boardOwner)
  const img = new Image()
  if (!/^(blob|data):/.test(url)) img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  const c = item.crop
  const sw = c.w * img.naturalWidth
  const sh = c.h * img.naturalHeight
  const k = Math.min(1, MAX / Math.max(sw, sh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * k))
  canvas.height = Math.max(1, Math.round(sh * k))
  canvas.getContext('2d')!.drawImage(img, c.x * img.naturalWidth, c.y * img.naturalHeight, sw, sh, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/png'))
}

export async function copyImage(item: ImageItem, boardOwner?: string) {
  try {
    // The ClipboardItem is created synchronously (inside the click) with the PNG still on its way.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': croppedPng(item, boardOwner) })])
    toast('Image copied')
  } catch {
    const link = item.source ?? item.src
    if (link) {
      await copyText(link, 'Copied the image link — that site doesn’t allow copying the image itself')
    } else toast('Couldn’t copy that image')
  }
}

export async function downloadImage(item: ImageItem, boardOwner?: string) {
  try {
    const blob = await croppedPng(item, boardOwner)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bored-${item.id}.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  } catch {
    const link = item.src ?? item.source
    if (link) window.open(link, '_blank', 'noopener')
    else toast('Couldn’t download that image')
  }
}

export async function copyText(text: string, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast(done)
  } catch {
    toast('Couldn’t access the clipboard')
  }
}
