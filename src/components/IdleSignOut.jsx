import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { Modal } from './ui'

// Signs the user out after a period without activity: 12 hours for riders, 30 minutes for every other role.
// The last-activity time is kept in localStorage so it is shared by every open tab and survives closing the
// browser; reopening Ọ̀nà after the limit has passed signs the user out straight away.
const MIN = 60 * 1000
const LIMIT = { rider: 12 * 60 * MIN }
const DEFAULT_LIMIT = 30 * MIN
const WARN = 1 * MIN
const KEY = 'ona:lastActive'
const REASON_KEY = 'ona:signedOutReason'
const EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove']

const read = () => {
  try { return Number(localStorage.getItem(KEY)) || 0 } catch { return 0 }
}
const write = (t) => {
  try { localStorage.setItem(KEY, String(t)) } catch { /* storage blocked: the in-memory timer still works */ }
}
export const markActive = () => write(Date.now())

export function takeSignOutReason() {
  try {
    const r = localStorage.getItem(REASON_KEY)
    localStorage.removeItem(REASON_KEY)
    return r
  } catch { return null }
}

export function limitFor(role) {
  return LIMIT[role] || DEFAULT_LIMIT
}

export default function IdleSignOut() {
  const { session, role } = useAuth()
  const limit = limitFor(role)
  const [left, setLeft] = useState(null) // ms left while the warning shows
  const local = useRef(0)
  const ending = useRef(false)
  const warning = left !== null

  const touch = useCallback(() => {
    local.current = Date.now()
    write(local.current)
    setLeft(null)
  }, [])

  const expire = useCallback(async () => {
    if (ending.current) return
    ending.current = true
    const mins = Math.round(limit / MIN)
    try {
      localStorage.setItem(REASON_KEY, `You were signed out after ${mins >= 60 ? `${mins / 60} hours` : `${mins} minutes`} without activity.`)
      localStorage.removeItem(KEY)
    } catch { /* ignore */ }
    setLeft(null)
    await supabase.auth.signOut({ scope: 'local' })
    ending.current = false
  }, [limit])

  // a fresh sign-in counts as activity, even when an earlier session in this browser had gone stale
  useEffect(() => {
    if (!session) return
    const signedIn = Date.parse(session.user?.last_sign_in_at || '') || 0
    if (signedIn > read()) write(signedIn)
    if (!read()) write(Date.now())
    // if storage is blocked, count from now so the user is not signed out at once
    local.current = Math.max(local.current, read() ? 0 : Date.now())
  }, [session?.user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // record activity; while the warning is open only a click on "Stay signed in" counts
  useEffect(() => {
    if (!session || warning) return
    let last = 0
    const on = () => {
      const now = Date.now()
      if (now - last > 5000) { last = now; local.current = now; write(now) }
    }
    EVENTS.forEach((e) => window.addEventListener(e, on, { passive: true }))
    return () => EVENTS.forEach((e) => window.removeEventListener(e, on))
  }, [session, warning])

  // check the idle time every second and when the tab becomes visible again (waits until the role is known)
  useEffect(() => {
    if (!session || !role) return
    const check = () => {
      const lastActive = Math.max(read(), local.current)
      const idle = Date.now() - lastActive
      if (idle >= limit) expire()
      else if (idle >= limit - WARN) setLeft(limit - idle)
      else setLeft(null)
    }
    check()
    const t = setInterval(check, 1000)
    document.addEventListener('visibilitychange', check)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check) }
  }, [session, role, limit, expire])

  if (!session || !warning) return null
  return (
    <Modal title="Still there?" onClose={touch}
      footer={<><button className="btn ghost" onClick={expire}>Sign out now</button><button className="btn primary" onClick={touch}>Stay signed in</button></>}>
      <p>For security you will be signed out in about {Math.max(1, Math.ceil(left / 1000))} seconds because there has been no activity.</p>
    </Modal>
  )
}
