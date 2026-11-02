import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { configured } from './lib/supabase'
import Layout from './components/Layout'
import { BrandSplash } from './components/ui'
import { Login, Register, Forgot, SetPassword, VerifyEmail, AuthFrame } from './pages/auth/AuthPages'
import { SCREENS } from './pages/screens/registry'
import Screen from './pages/screens/Screen'

// Five roles (spec v5): super_admin, operations, owner, rider, customer.
// Only customers sign themselves up; every other account is created for them.
export default function App() {
  const { session, account, profile, role, loading, recovery, signOut } = useAuth()

  if (!configured) {
    return <AuthFrame><h1>Not connected yet</h1><p>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in <code>.env.local</code> (see <code>.env.example</code>).</p></AuthFrame>
  }
  if (loading) return <BrandSplash />

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot" element={<Forgot />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  if (recovery) return <SetPassword />
  if (account?.error || !profile) {
    return <AuthFrame><h1>Could not load your account</h1><p>{account?.error || 'No profile found.'}</p><button className="btn" onClick={signOut}>Sign out</button></AuthFrame>
  }
  if (profile.status !== 'active') {
    return <AuthFrame><h1>Account deactivated</h1><p>Contact Ọ̀nà support.</p><button className="btn" onClick={signOut}>Sign out</button></AuthFrame>
  }
  if (profile.must_change_password) return <SetPassword forced />
  if (role === 'customer' && !account.email_confirmed) return <VerifyEmail />

  return (
    <Routes>
      <Route element={<Layout />}>
        {(SCREENS[role] || []).map((s) => <Route key={s.path} path={s.path} element={<Screen screen={s} />} />)}
        <Route path="/account" element={<SetPassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
