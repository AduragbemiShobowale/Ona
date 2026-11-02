import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase, rpc } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [account, setAccount] = useState(null)
  const [recovery, setRecovery] = useState(false)

  const loadAccount = useCallback(async () => {
    try {
      setAccount((await rpc('my_account')) || {})
    } catch (e) {
      setAccount({ error: e.message })
    }
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session) {
      loadAccount()
    } else if (session === null) {
      setAccount(null)
    }
  }, [session?.user?.id, loadAccount])

  const signOut = async () => {
    await supabase.auth.signOut()
    setAccount(null)
  }

  const value = {
    session,
    user: session?.user ?? null,
    account,
    profile: account?.profile ?? null,
    customer: account?.customer ?? null,
    role: account?.profile?.role ?? null,
    loading: session === undefined || (session && !account),
    recovery,
    setRecovery,
    refresh: loadAccount,
    signOut,
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
