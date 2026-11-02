import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase, rpc } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { BrandMark } from '../../components/Layout'
import Icon from '../../components/icons'
import { markActive, takeSignOutReason } from '../../components/IdleSignOut'
import { loginAddress } from '../../lib/login'

// The journey every delivery takes, drawn on the sign-in screen.
function Journey() {
  return (
    <div className="journey" aria-hidden="true">
      <div className="stop"><span className="node"><Icon name="store" size={22} /></span><b>The shop</b>packs</div>
      <div className="leg"><span>pickup code</span><i className="rider" /></div>
      <div className="stop"><span className="node sun"><Icon name="bike" size={22} /></span><b>Ọ̀nà rider</b>carries</div>
      <div className="leg"><span>delivery code</span></div>
      <div className="stop"><span className="node"><Icon name="pin" size={22} /></span><b>Your door</b>receives</div>
    </div>
  )
}

// The frame for every signed-out screen: the story on the left, a waybill on the right.
export function AuthFrame({ children, label = 'Sign in', no }) {
  return (
    <div className="gate">
      <section className="gate-story">
        <div className="gate-mark"><BrandMark size={26} /></div>
        <div className="gate-word">ọ̀nà</div>
        <p className="gate-tag">Lagos businesses pack. We pick up and bring it to the door, with a code at every handover.</p>
        <Journey />
        <div className="gate-who">
          <div><b>Shopping from a business?</b> Create your own account with the e-mail you give the shop.</div>
          <div><b>Business owners, riders and Ọ̀nà staff:</b> your account is created for you. Sign in with what you were given.</div>
        </div>
      </section>
      <section className="gate-form">
        <div className="waybill">
          <div className="waybill-head"><span>Ọ̀nà · <b>{label}</b></span><span>{no || 'Nº ' + new Date().toISOString().slice(2, 10).replace(/-/g, '')}</span></div>
          <div className="waybill-body">{children}</div>
        </div>
      </section>
    </div>
  )
}

export function Login() {
  const [notice] = useState(() => takeSignOutReason())
  const [who, setWho] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const { error } = await supabase.auth.signInWithPassword({ email: loginAddress(who), password })
    setBusy(false)
    if (error) return setErr(error.message === 'Invalid login credentials' ? 'That e-mail, phone number or password is wrong.' : error.message)
    markActive()
    rpc('touch_login').catch(() => {})
  }
  return (
    <AuthFrame label="Sign in">
      <div><h1>Welcome back</h1><p className="muted" style={{ marginTop: 6 }}>Riders can sign in with their phone number.</p></div>
      {notice && <div className="notice info">{notice}</div>}
      <form className="stack" onSubmit={submit}>
        <label className="field">E-mail or phone number<input type="text" inputMode="email" autoComplete="username" placeholder="you@example.com or 0803…" value={who} onChange={(e) => setWho(e.target.value)} required /></label>
        <label className="field">Password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {err && <div className="notice bad">{err}</div>}
        <button className="btn primary lg block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <div className="waybill-foot" style={{ padding: 0, border: 0 }}>
        <Link to="/forgot">Forgot your password?</Link>
        <span>Expecting a delivery? <Link to="/register">Create a customer account</Link></span>
      </div>
    </AuthFrame>
  )
}

// Customers are the only people who sign themselves up.
export function Register() {
  const [f, setF] = useState({ full_name: '', email: '', phone: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    if (f.full_name.trim().length < 2) return setErr('Enter your name.')
    if (f.phone.replace(/\D/g, '').length < 10) return setErr('Enter a phone number the rider can call.')
    if (f.password.length < 8) return setErr('Use at least 8 characters for the password.')
    setBusy(true); setErr(null)
    const { data, error } = await supabase.auth.signUp({
      email: f.email.trim().toLowerCase(), password: f.password,
      options: { data: { full_name: f.full_name.trim(), phone: f.phone.trim() }, emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) return setErr(/registered|exists/i.test(error.message) ? 'That e-mail already has an account. Sign in or reset your password.' : error.message)
    if (!data.session) setSent(true)
  }
  if (sent) {
    return (
      <AuthFrame label="Check your e-mail">
        <h1>One more step</h1>
        <p>We sent a link to <strong>{f.email}</strong>. Open it, then sign in. Any orders a business has already sent to this e-mail will be waiting for you.</p>
        <Link className="btn primary block" to="/login">Go to sign in</Link>
      </AuthFrame>
    )
  }
  return (
    <AuthFrame label="New customer">
      <div><h1>Get your deliveries</h1><p className="muted" style={{ marginTop: 6 }}>Use the e-mail you give shops when you buy from them. Their orders, your rider and your delivery code all show up here.</p></div>
      <form className="stack" onSubmit={submit}>
        <label className="field">Your name<input autoComplete="name" value={f.full_name} onChange={set('full_name')} required /></label>
        <label className="field">E-mail<input type="email" autoComplete="email" value={f.email} onChange={set('email')} required /></label>
        <label className="field">Phone number <span className="hint">So the rider can call you at the door</span><input type="tel" autoComplete="tel" placeholder="0803 555 0142" value={f.phone} onChange={set('phone')} required /></label>
        <label className="field">Password <span className="hint">At least 8 characters</span><input type="password" autoComplete="new-password" value={f.password} onChange={set('password')} required /></label>
        {err && <div className="notice bad">{err}</div>}
        <button className="btn sun lg block" disabled={busy}>{busy ? 'Creating your account…' : 'Create my account'}</button>
      </form>
      <div className="waybill-foot" style={{ padding: 0, border: 0 }}>
        <span>Already have an account? <Link to="/login">Sign in</Link></span>
        <span className="muted small">Running a business? Ọ̀nà sets up your account for you.</span>
      </div>
    </AuthFrame>
  )
}

export function Forgot() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + '/reset' })
    if (error) return toast.error(error.message)
    setDone(true)
  }
  return (
    <AuthFrame label="Reset password">
      <h1>Forgot your password?</h1>
      {done ? (
        <div className="notice good">If an account exists for {email}, a reset link is on its way.</div>
      ) : (
        <form className="stack" onSubmit={submit}>
          <label className="field">E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <button className="btn primary lg block">Send reset link</button>
        </form>
      )}
      <p className="muted small">Riders who sign in with a phone number: ask Ọ̀nà Operations for a new temporary password.</p>
      <Link to="/login">Back to sign in</Link>
    </AuthFrame>
  )
}

// Used for a recovery link and for the forced first-sign-in change.
export function SetPassword({ forced }) {
  const { setRecovery, refresh, signOut } = useAuth()
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const submit = async (e) => {
    e.preventDefault()
    if (p1.length < 8) return toast.error('Use at least 8 characters.')
    if (p1 !== p2) return toast.error('The passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: p1 })
    if (error) { setBusy(false); return toast.error(error.message) }
    await rpc('password_changed').catch(() => {})
    toast.success('Password saved.')
    setRecovery(false)
    await refresh()
    nav('/')
  }
  const body = (
    <>
      <div><h1>{forced ? 'Make it yours' : 'Set a new password'}</h1>
        {forced && <p className="muted" style={{ marginTop: 6 }}>You signed in with a temporary password. Choose your own to continue.</p>}</div>
      <form className="stack" onSubmit={submit}>
        <label className="field">New password <span className="hint">At least 8 characters</span><input type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} required /></label>
        <label className="field">Type it again<input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} required /></label>
        <button className="btn primary lg block" disabled={busy}>Save password</button>
      </form>
      {forced && <button className="btn ghost" onClick={signOut}>Sign out</button>}
    </>
  )
  if (!forced) return <div className="card" style={{ maxWidth: 480 }}><div className="card-body stack-lg">{body}</div></div>
  return <AuthFrame label="First sign-in">{body}</AuthFrame>
}

export function VerifyEmail() {
  const { user, signOut } = useAuth()
  const resend = async () => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: user.email, options: { emailRedirectTo: window.location.origin } })
    error ? toast.error(error.message) : toast.success('Sent again.')
  }
  return (
    <AuthFrame label="Verify e-mail">
      <h1>Check your inbox</h1>
      <p>Open the link we sent to <strong>{user?.email}</strong>. That's how we know orders sent to this e-mail are really yours.</p>
      <div className="row"><button className="btn primary" onClick={resend}>Send it again</button><button className="btn" onClick={() => window.location.reload()}>I've opened it</button></div>
      <button className="btn ghost" onClick={signOut}>Sign out</button>
    </AuthFrame>
  )
}
