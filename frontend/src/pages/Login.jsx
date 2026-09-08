import { useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/auth/AuthLayout'
import { useAuth } from '../hooks/useAuth'
import { getRememberPreference } from '../utils/tokenStorage'

const EMAIL_RE = /^\S+@\S+\.\S+$/

function Login() {
  const { login, isAuthenticated, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(getRememberPreference)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  const redirectTo = useMemo(
    () => location.state?.from?.pathname || '/',
    [location.state]
  )

  if (!authLoading && isAuthenticated) {
    return <Navigate to="/" replace />
  }

  function validate() {
    const next = {}
    if (!email.trim()) next.email = 'Email is required'
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address'
    if (!password) next.password = 'Password is required'
    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (!validate() || submitting) return

    setSubmitting(true)
    try {
      await login(
        { email: email.trim().toLowerCase(), password },
        { remember }
      )
      navigate(redirectTo === '/login' || redirectTo === '/register' ? '/' : redirectTo, {
        replace: true,
      })
    } catch (err) {
      const details = Array.isArray(err?.errors) ? err.errors.join(' ') : ''
      setError([err?.message, details].filter(Boolean).join(' '))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Access your TRACE research workspace."
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </div>
        ) : null}

        <div>
          <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-ink-soft">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none ring-accent/30 transition focus:border-accent focus:ring-2"
            placeholder="you@university.edu"
          />
          {fieldErrors.email ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.email}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-ink-soft">
            Password
          </label>
          <div className="relative">
            <input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 pr-16 text-sm text-ink outline-none ring-accent/30 transition focus:border-accent focus:ring-2"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-2 my-auto h-8 rounded-lg px-2 text-xs font-medium text-ink-muted hover:text-ink"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {fieldErrors.password ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.password}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
            />
            Remember me
          </label>
          <button
            type="button"
            disabled
            title="Coming soon"
            className="cursor-not-allowed text-sm text-ink-muted/70"
          >
            Forgot password?
          </button>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        New to TRACE?{' '}
        <Link to="/register" className="font-semibold text-accent hover:text-accent-deep">
          Create account
        </Link>
      </p>
    </AuthLayout>
  )
}

export default Login
