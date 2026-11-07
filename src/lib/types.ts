export type Crop = { x: number; y: number; w: number; h: number } // normalized 0–1

type Base = { id: string; x: number; y: number; w: number; h: number; z: number }

export type ImageItem = Base & {
  type: 'image'
  assetId?: string // blob stored locally
  src?: string // remote URL fallback when the image couldn't be copied
  natW: number
  natH: number
  crop: Crop
  tags: string[]
  source?: string
  detailOf?: string // close-up cropped from another image
}

export type NoteStyle = 'glass' | 'paper' | 'plain'
export type NoteSize = 's' | 'm' | 'l'

export type NoteItem = Base & {
  type: 'note'
  text: string
  style: NoteStyle
  size: NoteSize
  attachedTo?: string // image id — the note travels with that image
}

export type Item = ImageItem | NoteItem

export type Viewport = { x: number; y: number; zoom: number }

export type BoardMeta = {
  id: string
  name: string
  createdAt: number
  updatedAt: number
}

export type BoardData = {
  id: string
  items: Item[]
  viewport?: Viewport
}

export const FULL_CROP: Crop = { x: 0, y: 0, w: 1, h: 1 }

export const TAG_PRESETS = [
  'Wash',
  'Distressing',
  'Fade',
  'Graphic',
  'Print',
  'Fit',
  'Silhouette',
  'Fabric',
  'Texture',
  'Hardware',
  'Stitching',
  'Color',
  'Layering',
  'Details',
]
