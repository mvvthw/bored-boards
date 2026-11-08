/** A round initial in the person's colour. */
export function Avatar({ name, color, size = 28, title }: { name: string; color: string; size?: number; title?: string }) {
  return (
    <span className="avatar" title={title ?? name} style={{ width: size, height: size, fontSize: size * 0.42, '--c': color } as React.CSSProperties}>
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  )
}
