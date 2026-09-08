import { useEffect } from 'react'

function Toast({ message, onDismiss }) {
  useEffect(() => {
    if (!message) return undefined
    const timer = setTimeout(onDismiss, 3200)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 left-1/2 z-[80] max-w-sm -translate-x-1/2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-ink shadow-lg dark:bg-panel"
    >
      {message}
    </div>
  )
}

export default Toast
