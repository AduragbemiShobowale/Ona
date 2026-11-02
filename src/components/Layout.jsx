import { Component, useState, useEffect, useRef } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, matchPath } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLive } from './Live'
import { ROLE_LABEL, ago } from '../lib/format'
import { Modal } from './ui'
import Icon from './icons'
import { SCREENS } from '../pages/screens/registry'

// Menus come from the screen registry so the routes and the menu never disagree.
export const MENUS = Object.fromEntries(
  Object.entries(SCREENS).map(([role, list]) => [role, list.filter((x) => !x.hidden)]),
)

export const BrandMark = ({ size = 22 }) => (
  <span className="brand-mark" aria-hidden="true">
    <svg width={size} height={size} viewBox="0 0 120 120"><circle cx="60" cy="48" r="32" fill="none" stroke="#fff" strokeWidth="14" /><path d="M60 88c-7 0-13 6-13 13 0 9 13 19 13 19s13-10 13-19c0-7-6-13-13-13z" fill="#F2B705" /></svg>
  </span>
)

export function Bell() {
  const { items, unread, markRead, markAll } = useLive()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const nav = useNavigate()
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => {
    if (!open) return
    const off = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const esc = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', off); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="icon-btn" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="bell" />
        {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-pop">
          <div className="row between" style={{ padding: '14px 16px', borderBottom: '1px dashed var(--line-2)' }}>
            <h3>Notifications</h3>
            {unread > 0 && <button className="btn ghost sm" onClick={markAll}>Mark all read</button>}
          </div>
          {items.length === 0 && <div className="empty">Nothing yet. Updates about your orders and tasks appear here.</div>}
          {items.map((n) => (
            <div key={n.id} className={`notif ${n.read_at ? '' : 'unread'}`} onClick={() => { markRead([n.id]); if (n.link) nav(n.link); setOpen(false) }}>
              <div className="row between nowrap"><strong>{n.title}</strong><span className="muted small nowrap">{ago(n.created_at)}</span></div>
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
  return n > 0 ? <span className="count">{n > 99 ? '99+' : n}</span> : null
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

function NavItem({ m }) {
  return (
    <NavLink to={m.path} end={m.end}>
      <Icon name={m.icon} />
      <span>{m.label}</span>
      {m.count && <NavCount fn={m.count} />}
    </NavLink>
  )
}

export default function Layout() {
  const { role, profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [confirmOut, setConfirmOut] = useState(false)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  const items = MENUS[role] || []
  const groups = []
  items.forEach((m) => {
    const g = m.group || 'Menu'
    let found = groups.find((x) => x.name === g)
    if (!found) { found = { name: g, items: [] }; groups.push(found) }
    found.items.push(m)
  })
  const current = (SCREENS[role] || []).find((s) => matchPath({ path: s.path, end: true }, loc.pathname))
  const title = loc.pathname === '/account' ? 'Account & password' : current?.label || 'Ọ̀nà'
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="shell" data-role={role}>
      <aside className={`side ${open ? 'open' : ''}`} aria-label="Main menu">
        <NavLink to="/" className="brand" aria-label="Ọ̀nà home"><BrandMark /> ọ̀nà</NavLink>
        <div className="role-chip"><i /><b>{ROLE_LABEL[role]}</b><span>{profile?.business_name ? 'Business' : 'Ọ̀nà'}</span></div>
        <nav>
          {groups.map((g) => (
            <div className="nav-group" key={g.name}>
              <small>{g.name}</small>
              {g.items.map((m) => <NavItem key={m.path} m={m} />)}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <div className="me">
            <span className="avatar">{initials(profile?.full_name || profile?.email)}</span>
            <div style={{ minWidth: 0 }}>
              <b>{profile?.full_name || 'Your account'}</b>
              <small>{profile?.business_name || profile?.email}</small>
            </div>
          </div>
          <div className="side-actions">
            <NavLink to="/account"><Icon name="key" size={15} /> Password</NavLink>
            <button onClick={() => setConfirmOut(true)}><Icon name="logout" size={15} /> Sign out</button>
          </div>
        </div>
      </aside>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} />}

      <div className="main">
        <header className="top">
          <button className="icon-btn menu-btn" aria-label="Open the menu" onClick={() => setOpen(true)}><Icon name="menu" /></button>
          <div className="crumb"><small>{ROLE_LABEL[role]}</small><b>{title}</b></div>
          <span className="today">{today}</span>
          <Bell />
        </header>
        <main className="page">
          <PageErrorBoundary path={loc.pathname}><Outlet /></PageErrorBoundary>
        </main>
      </div>

      <nav className="btabs" aria-label="Quick menu">
        {items.slice(0, 4).map((m) => <NavItem key={m.path} m={m} />)}
        <a href="#menu" onClick={(e) => { e.preventDefault(); setOpen(true) }}><Icon name="menu" /><span>More</span></a>
      </nav>

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
