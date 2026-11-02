import { Component, useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLive } from './Live'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL, ago } from '../lib/format'
import { Modal } from './ui'

import { SCREENS } from '../pages/screens/registry'

// Menus come from the screen registry so the routes and the menu never disagree.
export const MENUS = Object.fromEntries(
  Object.entries(SCREENS).map(([role, list]) => [role, list.filter((x) => !x.hidden).map((x) => ({ to: x.path, label: x.label, end: x.end, count: x.count }))]),
)

export function Bell() {
  const { items, unread, markRead, markAll } = useLive()
  const [open, setOpen] = useState(false)
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  return (
    <>
      <button className="icon-btn" aria-label={`Notifications, ${unread} unread`} onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
        {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-pop">
          <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
            <h3>Notifications</h3>
            {unread > 0 && <button className="btn ghost sm" onClick={markAll}>Mark all read</button>}
          </div>
          {items.length === 0 && <div className="empty">Nothing yet.</div>}
          {items.map((n) => (
            <div key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => { markRead([n.id]); if (n.link) nav(n.link); setOpen(false) }}>
              <div className="row between"><strong>{n.title}</strong><span className="muted small">{ago(n.created_at)}</span></div>
              {n.body && <div className="muted small">{n.body}</div>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function NavCount({ fn }) {
  const { tick } = useLive()
  const loc = useLocation()
  const [n, setN] = useState(0)
  useEffect(() => { fn().then(setN).catch(() => {}) }, [tick, loc.pathname, loc.search]) // eslint-disable-line react-hooks/exhaustive-deps
  return n > 0 ? <span className="count">{n}</span> : null
}

// Keeps a crash in one page from blanking the whole screen. Resets when the route changes.
class PageErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidUpdate(prev) { if (prev.path !== this.props.path && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="notice warn">
        <strong>This page could not be shown.</strong> Try reloading. If it keeps happening, tell the administrator.
        <div className="muted small mono">{String(this.state.error.message || this.state.error)}</div>
      </div>
    )
  }
}

export const BrandMark = () => (
  <span className="brand-mark">
    <svg width="18" height="18" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="48" r="32" fill="none" stroke="#fff" strokeWidth="14" /><path d="M60 88c-7 0-13 6-13 13 0 9 13 19 13 19s13-10 13-19c0-7-6-13-13-13z" fill="#F2B705" /></svg>
  </span>
)

export default function Layout() {
  const { role, profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  const menu = MENUS[role] || []
  return (
    <div className="shell" data-role={role}>
      <aside className={`side ${open ? 'open' : ''}`}>
        <NavLink to="/" className="brand" style={{ textDecoration: 'none' }} aria-label="Ọ̀nà home"><BrandMark /> ọ̀nà</NavLink>
        <div className="role-chip">{ROLE_LABEL[role]}</div>
        <nav className="nav">
          {menu.map((m) => (
            <NavLink key={m.to} to={m.to} end={m.end}>
              <span>{m.label}</span>
              {m.count && <NavCount fn={m.count} />}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div>
            <strong>{profile?.full_name || profile?.email}</strong>
            <div className="muted small">{profile?.business_name || profile?.email}</div>
          </div>
          <NavLink to="/account" className="small">Account & password</NavLink>
          <button className="btn sm" onClick={() => setConfirmOut(true)}>Sign out</button>
        </div>
      </aside>
      <div className="main">
        <header className="top">
          <button className="icon-btn menu-btn" aria-label="Menu" onClick={() => setOpen((o) => !o)}>☰</button>
          <div className="spacer" />
          <Bell />
        </header>
        <main className="page">
          <PageErrorBoundary path={loc.pathname}><Outlet /></PageErrorBoundary>
        </main>
      </div>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} />}
      {confirmOut && (
        <Modal title="Sign out?" onClose={() => setConfirmOut(false)} footer={<>
          <button className="btn" onClick={() => setConfirmOut(false)}>Stay signed in</button>
          <button className="btn primary" onClick={signOut}>Sign out</button>
        </>}>
          <p>You will need your e-mail and password to sign in again.</p>
        </Modal>
      )}
    </div>
  )
}
