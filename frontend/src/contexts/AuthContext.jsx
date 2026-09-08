/**
 * Auth context — session restoration and auth actions for TRACE.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import * as authService from '../services/auth.service'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const isAuthenticated = Boolean(user)

  const refreshUser = useCallback(async () => {
    if (!authService.hasStoredToken()) {
      setUser(null)
      return null
    }

    try {
      const current = await authService.getCurrentUser()
      setUser(current)
      return current
    } catch {
      authService.logout()
      setUser(null)
      return null
    }
  }, [])

  useEffect(() => {
    let active = true

    async function bootstrap() {
      setLoading(true)
      try {
        if (!authService.hasStoredToken()) {
          if (active) setUser(null)
          return
        }
        const current = await authService.getCurrentUser()
        if (active) setUser(current)
      } catch {
        authService.logout()
        if (active) setUser(null)
      } finally {
        if (active) setLoading(false)
      }
    }

    bootstrap()
    return () => {
      active = false
    }
  }, [])

  const login = useCallback(async (credentials, options = {}) => {
    const result = await authService.login(credentials, options)
    setUser(result.user)
    return result
  }, [])

  const register = useCallback(async (payload, options = {}) => {
    const result = await authService.register(payload)
    // Backend returns JWT — auto-login for a smooth workspace entry.
    authService.persistToken(result.token, {
      remember: options.remember !== false,
    })
    setUser(result.user)
    return result
  }, [])

  const logout = useCallback(() => {
    authService.logout()
    setUser(null)
  }, [])

  const value = useMemo(
    () => ({
      user,
      isAuthenticated,
      loading,
      login,
      logout,
      register,
      refreshUser,
    }),
    [user, isAuthenticated, loading, login, logout, register, refreshUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

export default AuthContext
