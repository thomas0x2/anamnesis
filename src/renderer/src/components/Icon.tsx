// A small, consistent icon set (24-unit grid, 1.8 stroke), drawn for this app.
import type { CSSProperties, ReactElement } from 'react'

const P: Record<string, ReactElement> = {
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
    </>
  ),
  map: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <circle cx="9" cy="18" r="2.5" />
      <path d="M8.3 7.2 15.6 8.3M7 8.4l1.4 7.2M16.4 10.1l-5.6 6.2" />
    </>
  ),
  mind: (
    <>
      <path d="M12 4.5a5.5 5.5 0 0 0-5.5 5.5c0 1.9.9 3.3 2 4.4.6.6 1 1.4 1 2.3V18h5v-1.3c0-.9.4-1.7 1-2.3 1.1-1.1 2-2.5 2-4.4A5.5 5.5 0 0 0 12 4.5Z" />
      <path d="M10 21h4M12 8.5v3l1.6 1.4" />
    </>
  ),
  stats: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16.5V11M12 16.5V6.5M17 16.5V9" />
    </>
  ),
  book: (
    <>
      <path d="M5 4.5h10.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z" />
      <path d="M5 17.5A2 2 0 0 1 7 15.5h10.5M9 8.5h5" />
    </>
  ),
  settings: (
    <>
      <path d="M5 7h8M17 7h2M5 12h2M11 12h8M5 17h10M19 17h0" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17" r="2" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" />,
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  speaker: (
    <>
      <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />,
  'chev-right': <path d="m9.5 6 6 6-6 6" />,
  'chev-down': <path d="m6 9.5 6 6 6-6" />,
  'chev-up': <path d="m6 14.5 6-6 6 6" />,
  arrow: <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />,
  back: <path d="M19 12H6M11 6.5 5.5 12l5.5 5.5" />,
  bulb: (
    <>
      <path d="M9 17.5h6M10 20.5h4" />
      <path d="M12 3.5a5.5 5.5 0 0 0-3.3 9.9c.5.4.8 1 .8 1.6v.5h5v-.5c0-.6.3-1.2.8-1.6A5.5 5.5 0 0 0 12 3.5Z" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="12" cy="12" r="0.8" />
    </>
  ),
  probe: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5M10.5 8v5M8 10.5h5" />
    </>
  ),
  refresh: (
    <>
      <path d="M19 12a7 7 0 1 1-2.1-5" />
      <path d="M19.5 4.5V8H16" />
    </>
  ),
  flame: <path d="M12 3.5c.5 3-2.5 4.5-2.5 7.5a2.5 2.5 0 0 0 5 0c0-1 .5-2 1-2.5 1.3 1.5 2.5 3.4 2.5 5.5a6 6 0 0 1-12 0c0-4.5 4-6 6-10.5Z" />,
  spark: <path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8z" />,
  star: <path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.6M12 17h.01" />
    </>
  ),
  chat: <path d="M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4.5 3.5v-3.5H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />,
  send: <path d="m4.5 12 15-7-4.5 15-3-6.5zM12 13.5 19.5 5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M5 7h14M10 7V5h4v2M7 7l.8 12.2a1 1 0 0 0 1 .8h6.4a1 1 0 0 0 1-.8L17 7" />
    </>
  ),
  edit: <path d="M5 19h3.5L19 8.5 15.5 5 5 15.5zM13.5 7l3.5 3.5" />,
  external: <path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5" />
    </>
  ),
  zap: <path d="M13 3.5 5.5 13.5H12L11 20.5l7.5-10H12z" />,
  layers: (
    <>
      <path d="m12 4 8 4-8 4-8-4z" />
      <path d="m4 12 8 4 8-4M4 16l8 4 8-4" />
    </>
  ),
  tree: (
    <>
      <rect x="9" y="3.5" width="6" height="4" rx="1" />
      <rect x="3.5" y="16.5" width="6" height="4" rx="1" />
      <rect x="14.5" y="16.5" width="6" height="4" rx="1" />
      <path d="M12 7.5v4.5M6.5 16.5V12h11v4.5" />
    </>
  ),
  dumbbell: <path d="M4 9.5v5M7 7.5v9M17 7.5v9M20 9.5v5M7 12h10" />,
  eye: (
    <>
      <path d="M3 12s3.3-6 9-6 9 6 9 6-3.3 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="7" r="1" />
      <circle cx="15" cy="7" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="17" r="1" />
      <circle cx="15" cy="17" r="1" />
    </>
  ),
  flag: <path d="M6 20.5V4.5M6 5h11l-2 3.5 2 3.5H6" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4 21 19.5H3z" />
      <path d="M12 10v4.5M12 17h.01" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  list: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  logo: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M7.5 15.5c1.5-5 3-7 4.5-7s3 2 4.5 7M9 13h6" />
    </>
  )
}

export function Icon({ name, size = 18, style, className }: { name: string; size?: number; style?: CSSProperties; className?: string }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
      className={className}
    >
      {P[name] ?? P.info}
    </svg>
  )
}

/** The app mark: a recalled trace rising out of a circle (anamnesis = recollection). */
export function BrandMark({ size = 28 }: { size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b9adff" />
          <stop offset="1" stopColor="#5a48d8" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#bm)" />
      <path d="M8 21.5c2.2-7.5 4.6-11 8-11s5.8 3.5 8 11" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" />
      <circle cx="16" cy="10.5" r="2.2" fill="#fff" />
      <path d="M11.5 17.5h9" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.75" />
    </svg>
  )
}
