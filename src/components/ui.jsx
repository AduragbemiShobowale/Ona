import { useEffect, useState, useCallback, useRef } from 'react'
import { STATUS, RULE_LABEL, dateTime } from '../lib/format'
import toast from 'react-hot-toast'
import { useLive } from './Live'

// Loads data and reloads it when the caller's deps change or a live
// notification arrives for this user.
export function useLoad(fn, deps = []) {
  const { tick } = useLive()
  const [state, setState] = useState({ data: null, loading: true, error: null })
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    try {
      const data = await fnRef.current()
      setState({ data, loading: false, error: null })
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e.message }))
    }
  }, [])
  useEffect(() => { reload() }, [...deps, tick]) // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload }
}

// Throws on a Supabase error so useLoad can show it.
export const q = async (promise) => {
  const { data, error, count } = await promise
  if (error) throw new Error(error.message)
  return count != null && data == null ? count : data
}
export const countOf = async (promise) => {
  const { count, error } = await promise
  if (error) throw new Error(error.message)
  return count ?? 0
}

export function StatusBadge({ status, customer }) {
  const s = STATUS[status] || { label: status, tone: 'muted', customer: status }
  return <span className={`badge t-${s.tone}`}>{customer ? s.customer : s.label}</span>
}

export const Badge = ({ tone = 'muted', children }) => <span className={`badge t-${tone}`}>{children}</span>

export function Kpi({ label, value, alert, to }) {
  const body = (
    <div className={`kpi ${alert ? 'alert' : ''}`}>
      <div className="v">{value ?? '…'}</div>
      <div className="l">{label}</div>
    </div>
  )
  return to ? <a href={to} style={{ color: 'inherit', textDecoration: 'none' }}>{body}</a> : body
}

export function Card({ title, action, children, pad = true, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-head">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {pad ? <div className="card-body">{children}</div> : children}
    </section>
  )
}

export const Empty = ({ children }) => <div className="empty">{children}</div>

export function PageHead({ title, sub, children, hero }) {
  return (
    <div className={`page-head ${hero ? 'hero' : ''}`}>
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  )
}

// Full-screen splash, the same markup and styles as the one in index.html, so the hand-over is seamless.
export function BrandSplash() {
  return (
    <div className="v-splash" role="status" aria-label="Loading Ọ̀nà">
      <div className="v-mark" aria-hidden="true">
        <svg viewBox="0 0 120 130">
          <circle className="v-ripple" cx="60" cy="112" r="10" /><circle className="v-ripple r2" cx="60" cy="112" r="10" />
          <circle className="v-ring" cx="60" cy="48" r="32" />
          <path className="v-pin" d="M60 88c-7 0-13 6-13 13 0 9 13 19 13 19s13-10 13-19c0-7-6-13-13-13z" />
          <circle className="v-pin-dot" cx="60" cy="101" r="4.5" />
        </svg>
      </div>
      <div className="v-word"><span>ọ̀</span><span>n</span><span>à</span></div>
      <div className="v-tag">Last-mile delivery for Lagos businesses</div>
      <div className="v-road" aria-hidden="true"><i /></div>
    </div>
  )
}

export function Loading({ error }) {
  if (error) return <div className="notice bad">{error}</div>
  return (
    <div className="empty v-inline" role="status">
      <span className="v-mini"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="48" r="32" fill="none" stroke="currentColor" strokeWidth="14" /><path d="M60 88c-7 0-13 6-13 13 0 9 13 19 13 19s13-10 13-19c0-7-6-13-13-13z" fill="#f2b705" /></svg></span>
      <span>Loading…</span>
    </div>
  )
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

// Asks for a reason (or other text) and runs an action with it.
export function ReasonModal({ title, label = 'Reason', placeholder, confirm = 'Confirm', danger, required = true, minLength = 1, options, onClose, onSubmit, children }) {
  const { bump } = useLive()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const ok = !required || text.trim().length >= minLength
  const go = async () => {
    setBusy(true); setErr(null)
    try {
      await onSubmit(text.trim())
      bump?.()
      onClose()
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Back</button>
      <button className={`btn ${danger ? 'danger solid' : 'primary'}`} disabled={!ok || busy} onClick={go}>{busy ? 'Working…' : confirm}</button>
    </>}>
      {children}
      {options ? (
        <label className="field">{label}
          <select value={text} onChange={(e) => setText(e.target.value)}>
            <option value="">Choose…</option>
            {options.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
      ) : (
        <label className="field">{label}
          <textarea autoFocus value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      {err && <div className="notice bad">{err}</div>}
    </Modal>
  )
}

export function ValidationReport({ results, compact }) {
  if (!results?.length) return null
  const icon = { fail: '✕', warn: '!', pass: '✓' }
  return (
    <div className="vr">
      {results.map((r, i) => (
        <div key={i} className={`vr-item ${r.severity}`}>
          <strong>{icon[r.severity]}</strong>
          <div>
            {!compact && <div className="rule">{RULE_LABEL[r.rule] || r.rule}</div>}
            <div>{r.message}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export function Timeline({ events, customer }) {
  if (!events?.length) return <Empty>No history yet.</Empty>
  return (
    <div className="timeline">
      {events.map((e) => (
        <div className="tl" key={e.id}>
          <span className="pt" />
          <div>
            <div className="row between">
              <strong>{customer ? STATUS[e.to_status]?.customer : STATUS[e.to_status]?.label}</strong>
              <span className="muted small">{dateTime(e.at)}</span>
            </div>
            {e.note && !(customer && e.note.startsWith('OVERRIDE')) && <div className="muted small">{e.note}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}

// Runs an async action with a busy flag and toast on error/success.
export function useAction() {
  const { bump } = useLive()
  const [busy, setBusy] = useState(false)
  const run = async (fn, success) => {
    setBusy(true)
    try {
      const r = await fn()
      bump?.()
      if (success) toast.success(typeof success === 'function' ? success(r) : success)
      return r
    } catch (e) {
      toast.error(e.message)
      return undefined
    } finally {
      setBusy(false)
    }
  }
  return [run, busy]
}
