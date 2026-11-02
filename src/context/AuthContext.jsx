import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase, rpc } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [account, setAccount] = useState(null)
  const [recovery, setRecovery] = useState(false)

  const loadAccount = useCallback(async () => {
    try {
      // never leave the loading screen up forever if the server does not answer
      const timeout = new Promise((_, no) => setTimeout(() => no(new Error('Ọ̀nà did not answer in time. Check your connection and try again.')), 15000))
      setAccount((await Promise.race([rpc('my_account'), timeout])) || {})
    } catch (e) {
      setAccount({ error: e.message })
    }
  }, [])

  useEffect(() => {
    // if the saved session cannot be read (blocked storage, in-app browsers), start signed out
    const giveUp = setTimeout(() => setSession((s) => (s === undefined ? null : s)), 8000)
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null))
      .finally(() => clearTimeout(giveUp))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => { clearTimeout(giveUp); sub.subscription.unsubscribe() }
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
