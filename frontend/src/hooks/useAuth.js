/**
 * Convenience hook for authentication state and actions.
 */
import { useAuthContext } from '../contexts/AuthContext'

export function useAuth() {
  return useAuthContext()
}

export default useAuth
