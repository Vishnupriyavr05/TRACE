import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import AuthLayout from '../components/auth/AuthLayout'
import { useAuth } from '../hooks/useAuth'

const EMAIL_RE = /^\S+@\S+\.\S+$/

function isStrongPassword(password) {
  if (typeof password !== 'string' || password.length < 8) return false
  if (!/[A-Za-z]/.test(password)) return false
  if (!/[0-9]/.test(password)) return false
  return true
}

function Register() {
  const { register, isAuthenticated, loading: authLoading } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  if (!authLoading && isAuthenticated) {
    return <Navigate to="/" replace />
  }

  function validate() {
    const next = {}
    const trimmedName = name.trim()
    if (!trimmedName) next.name = 'Name is required'
    else if (trimmedName.length < 2) next.name = 'Name must be at least 2 characters'

    if (!email.trim()) next.email = 'Email is required'
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address'

    if (!password) next.password = 'Password is required'
    else if (!isStrongPassword(password)) {
      next.password =
        'Password must be at least 8 characters and include a letter and a number'
    }

    if (!confirmPassword) next.confirmPassword = 'Confirm your password'
    else if (confirmPassword !== password) {
      next.confirmPassword = 'Passwords do not match'
    }

    setFieldErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (!validate() || submitting) return

    setSubmitting(true)
    try {
      await register({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      })
      // Backend returns JWT — session is established; enter workspace.
      navigate('/', { replace: true })
    } catch (err) {
      const details = Array.isArray(err?.errors) ? err.errors.join(' ') : ''
      setError([err?.message, details].filter(Boolean).join(' '))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Create account"
      subtitle="Start researching with TRACE across connected evidence."
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
          <label htmlFor="register-name" className="mb-1.5 block text-sm font-medium text-ink-soft">
            Full name
          </label>
          <input
            id="register-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none ring-accent/30 transition focus:border-accent focus:ring-2"
            placeholder="Ada Researcher"
          />
          {fieldErrors.name ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.name}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="register-email" className="mb-1.5 block text-sm font-medium text-ink-soft">
            Email
          </label>
          <input
            id="register-email"
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
          <label htmlFor="register-password" className="mb-1.5 block text-sm font-medium text-ink-soft">
            Password
          </label>
          <div className="relative">
            <input
              id="register-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 pr-16 text-sm text-ink outline-none ring-accent/30 transition focus:border-accent focus:ring-2"
              placeholder="At least 8 characters"
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

        <div>
          <label
            htmlFor="register-confirm"
            className="mb-1.5 block text-sm font-medium text-ink-soft"
          >
            Confirm password
          </label>
          <input
            id="register-confirm"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-ink outline-none ring-accent/30 transition focus:border-accent focus:ring-2"
            placeholder="Re-enter password"
          />
          {fieldErrors.confirmPassword ? (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {fieldErrors.confirmPassword}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-accent hover:text-accent-deep">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  )
}

export default Register
