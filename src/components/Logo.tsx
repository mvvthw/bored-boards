/** The bored mark: a beveled board with heavy-lidded eyes and a flat, slightly-off mouth. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="bored-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fafafc" />
          <stop offset="1" stopColor="#b4b4ba" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="22" height="22" rx="7" fill="url(#bored-face)" />
      <rect x="1.5" y="1.5" width="21" height="21" rx="6.5" fill="none" stroke="#fff" strokeOpacity=".8" />
      {/* eyes — lids dropped halfway */}
      <path d="M5.2 10.4h5.4a2.7 2.7 0 0 1-5.4 0Z" fill="#0b0b0c" />
      <path d="M13.4 10.4h5.4a2.7 2.7 0 0 1-5.4 0Z" fill="#0b0b0c" />
      {/* mouth — flat, a little lopsided */}
      <path d="M9.4 16.6 15.4 16.1" stroke="#0b0b0c" strokeWidth="1.7" strokeLinecap="round" fill="none" />
    </svg>
  )
}

export function Wordmark() {
  return (
    <div className="brand" aria-label="bored">
      <LogoMark className="brand-mark" />
      <span>bored</span>
    </div>
  )
}
