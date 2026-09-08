import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../hooks/useAuth'
import Icon from '../Icon/Icon'

function Navbar({ onOpenSessions }) {
  const { theme, toggleTheme } = useTheme()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  const displayName = user?.name?.trim() || 'Researcher'

  useEffect(() => {
    if (!menuOpen) return undefined
    function handlePointerDown(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [menuOpen])

  function handleLogout() {
    setMenuOpen(false)
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#0f172a]/95 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between px-4 sm:h-16 sm:px-6">
        <Link to="/" className="inline-flex items-center" aria-label="TRACE home">
          <img
            src="/assets/logo.png"
            alt="TRACE"
            className="h-9 w-auto object-contain sm:h-10"
          />
        </Link>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="grid h-9 w-9 place-items-center rounded-full border border-slate-500/70 bg-slate-800 text-slate-100 hover:border-slate-400 hover:bg-slate-700 hover:text-white dark:border-slate-400/50 dark:bg-slate-700 dark:text-white dark:hover:border-slate-300 dark:hover:bg-slate-600"
          >
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4" aria-hidden="true">
                <path d="M20 15.2A8.5 8.5 0 0 1 8.8 4 7 7 0 1 0 20 15.2Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenSessions}
            aria-label="Research Sessions"
            title="Research Sessions"
            className="grid h-9 w-9 place-items-center rounded-full border border-slate-500/70 bg-slate-800 text-slate-100 hover:border-slate-400 hover:bg-slate-700 hover:text-white dark:border-slate-400/50 dark:bg-slate-700 dark:text-white dark:hover:border-slate-300 dark:hover:bg-slate-600"
          >
            <Icon name="history" className="h-4 w-4" />
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="User menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex items-center gap-2.5 rounded-full border border-slate-500/70 bg-slate-800 py-1.5 pl-1.5 pr-3.5 text-slate-100 hover:border-slate-400 hover:bg-slate-700 hover:text-white dark:border-slate-400/50 dark:bg-slate-700 dark:text-white dark:hover:border-slate-300 dark:hover:bg-slate-600"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-sky-500/25 text-sky-300 dark:bg-sky-400/25 dark:text-sky-200">
                <Icon name="researcher" className="h-4 w-4" />
              </span>
              <span className="hidden max-w-[10rem] truncate text-sm font-semibold tracking-wide sm:inline">
                {displayName}
              </span>
            </button>

            {menuOpen ? (
              <div className="absolute right-0 mt-2 w-48 overflow-hidden rounded-xl border border-slate-600/80 bg-slate-900 py-1 shadow-xl">
                <div className="border-b border-slate-700 px-3 py-2">
                  <p className="truncate text-sm font-medium text-slate-100">{displayName}</p>
                  {user?.email ? (
                    <p className="truncate text-xs text-slate-400">{user.email}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="block w-full px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}

export default Navbar
