const iconPaths = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  check: <path d="m5 12 5 5L20 7" />,
  upload: (
    <>
      <path d="M12 16V6M8 10l4-4 4 4" />
      <path d="M4 18h16" />
    </>
  ),
  file: (
    <>
      <path d="M7 3h7l4 4v14H7V3Z" />
      <path d="M14 3v5h5" />
    </>
  ),
  x: <path d="m5 5 14 14M19 5 5 19" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  download: (
    <>
      <path d="M12 4v10M8 10l4 4 4-4" />
      <path d="M4 18h16" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5M11 8v6M8 11h6" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5M8 11h6" />
    </>
  ),
  reset: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </>
  ),
  fullscreen: (
    <>
      <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4" />
    </>
  ),
  researcher: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </>
  ),
  external: (
    <>
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M17 13v6H5V7h6" />
    </>
  ),
  pin: <path d="m9 4 6 0-1 5 3 3v2H7v-2l3-3-1-5ZM12 14v7" />,
  thumbsUp: (
    <>
      <path d="M7 10v10H4V10h3Z" />
      <path d="M7 18h9.5a2 2 0 0 0 2-1.7l1-6A2 2 0 0 0 17.5 8H14l.5-3a2 2 0 0 0-2-2L7 10" />
    </>
  ),
  thumbsDown: (
    <>
      <path d="M17 14V4h3v10h-3Z" />
      <path d="M17 6H7.5a2 2 0 0 0-2 1.7l-1 6A2 2 0 0 0 6.5 16H10l-.5 3a2 2 0 0 0 2 2l5.5-7" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  replace: (
    <>
      <path d="M4 7h12l-3-3M16 17H4l3 3" />
      <path d="m13 4 3 3-3 3M7 14l-3 3 3 3" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="11" height="11" rx="1.5" />
      <path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H16" />
    </>
  ),
  archive: (
    <>
      <path d="M4 8h16v12H4V8Z" />
      <path d="M2 4h20v4H2V4Z" />
      <path d="M10 12h4" />
    </>
  ),
}

function Icon({ name, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  )
}

export default Icon
