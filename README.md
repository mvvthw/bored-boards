# bored

A dark, liquid-glass moodboard for clothing design references.

```bash
npm install
npm run dev   # http://localhost:5173
```

- **Dashboard** — create, rename (double-click name or ••• menu), duplicate, delete boards.
- **Board** — drag images in from Pinterest, Grailed or Finder, paste with ⌘V, or use the Image button.
  - Drag background to pan, pinch / ⌘-scroll to zoom, ⇧-drag to box-select.
  - Double-click an image (or press C) to crop down to the wash, distressing, or detail.
  - Tag images (Wash, Distressing, Fit, Hardware…), add notes beside them, or double-click the canvas for a note.
  - ⌘Z / ⇧⌘Z undo/redo, ⌘D duplicate, ⌥-drag copy, ] / [ reorder, ⇧1 fit.

Everything is stored locally in the browser (IndexedDB). Images that a site won't let the
browser copy (CORS) are hot-linked instead, so those can disappear if the original is removed.
