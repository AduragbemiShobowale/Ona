import { Component, useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLive } from './Live'
import { ROLE_LABEL, ago } from '../lib/format'
import { Modal } from './ui'
import Icon from './icons'
import { SCREENS } from '../pages/screens/registry'

// Menus come from the screen registry so the routes and the menu never disagree.
export const MENUS = Object.fromEntries(
  Object.entries(SCREENS).map(([role, list]) => [role, list.filter((x) => !x.hidden).map((x) => ({ to: x.path, label: x.label, end: x.end, icon: x.icon, count: x.count }))]),
)

export const BrandMark = ({ size = 22 }) => (
  <span className="brand-mark" aria-hidden="true">
    <svg width={size} height={size} viewBox="0 0 120 120"><circle cx="60" cy="48" r="32" fill="none" stroke="#fff" strokeWidth="14" /><path d="M60 88c-7 0-13 6-13 13 0 9 13 19 13 19s13-10 13-19c0-7-6-13-13-13z" fill="#F2B705" /></svg>
  </span>
)

function usePopover() {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    if (!open) return
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  return { open, setOpen, ref }
}

export function Bell() {
  const { items, unread, markRead, markAll } = useLive()
  const pop = usePopover()
  const nav = useNavigate()
  return (
    <div ref={pop.ref} style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label={`Notifications, ${unread} unread`} aria-expanded={pop.open} onClick={() => pop.setOpen((o) => !o)}>
        <Icon name="bell" />
        {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {pop.open && (
        <div className="bell-pop">
          <div className="row between" style={{ padding: '12px 14px', borderBottom: '1px dashed var(--line-2)' }}>
            <h3>Notifications</h3>
            {unread > 0 && <button className="btn ghost sm" onClick={markAll}>Mark all read</button>}
          </div>
          {items.length === 0 && <div className="empty">Nothing yet.</div>}
          {items.map((n) => (
            <div key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => { markRead([n.id]); if (n.link) nav(n.link); pop.setOpen(false) }}>
              <div className="row between"><strong>{n.title}</strong><span className="muted small">{ago(n.created_at)}</span></div>
              {n.body && <div className="muted small">{n.body}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NavCount({ fn }) {
  const { tick } = useLive()
  const loc = useLocation()
  const [n, setN] = useState(0)
  useEffect(() => { fn().then(setN).catch(() => {}) }, [tick, loc.pathname]) // eslint-disable-line react-hooks/exhaustive-deps
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
        <strong>This page could not be shown.</strong> Try reloading. If it keeps happening, tell Ọ̀nà support.
        <div className="muted small mono">{String(this.state.error.message || this.state.error)}</div>
      </div>
    )
  }
}

const initials = (s) => (s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

export default function Layout() {
  const { role, profile, signOut } = useAuth()
  const menu = usePopover()
  const [confirmOut, setConfirmOut] = useState(false)
  const loc = useLocation()
  const items = MENUS[role] || []
  const link = (m, cls) => (
    <NavLink key={m.to} to={m.to} end={m.end} className={({ isActive }) => (isActive ? 'active' : '') + (cls ? ' ' + cls : '')}>
      <Icon name={m.icon} />
      <span>{m.label}</span>
      {m.count && <NavCount fn={m.count} />}
    </NavLink>
  )
  return (
    <div className="app" data-role={role}>
      <header className="topbar">
        <div className="topbar-in">
          <NavLink to="/" className="brand" aria-label="Ọ̀nà home"><BrandMark /> ọ̀nà</NavLink>
          <nav className="tabs" aria-label="Main">{items.map((m) => link(m))}</nav>
          <div className="who">
            <Bell />
            <div ref={menu.ref} style={{ position: 'relative' }}>
              <button className="avatar" aria-label="Your account" aria-expanded={menu.open} onClick={() => menu.setOpen((o) => !o)}>{initials(profile?.full_name || profile?.email)}</button>
              {menu.open && (
                <div className="menu-pop" role="menu">
                  <div className="head">
                    <strong>{profile?.full_name || 'Your account'}</strong>
                    <div className="muted small">{profile?.business_name || profile?.email}</div>
                    <span className="role">{ROLE_LABEL[role]}</span>
                  </div>
                  <NavLink to="/account" role="menuitem">Change password</NavLink>
                  <button className="item" role="menuitem" onClick={() => { menu.setOpen(false); setConfirmOut(true) }}>Sign out</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      <main className="page">
        <PageErrorBoundary path={loc.pathname}><Outlet /></PageErrorBoundary>
      </main>
      <nav className="btabs" aria-label="Main">{items.map((m) => link(m))}</nav>
      {confirmOut && (
        <Modal title="Sign out?" onClose={() => setConfirmOut(false)} footer={<>
          <button className="btn" onClick={() => setConfirmOut(false)}>Stay signed in</button>
          <button className="btn primary" onClick={signOut}>Sign out</button>
        </>}>
          <p>You will need your e-mail or phone number and password to sign in again.</p>
        </Modal>
      )}
    </div>
  )
}
