import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Holds the signed-in user's notifications and a "tick" that bumps whenever
// a new one arrives, so open screens reload their data.
const LiveContext = createContext({ tick: 0, items: [], unread: 0, markRead: () => {}, markAll: () => {} })

export function LiveProvider({ children }) {
  const { user } = useAuth()
  const [items, setItems] = useState([])
  const [tick, setTick] = useState(0)

  const load = useCallback(async () => {
    if (!user) return setItems([])
    const { data } = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(40)
    setItems(data || [])
  }, [user])

  useEffect(() => {
    load()
    if (!user) return
    const ch = supabase
      .channel('notif-' + user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (p) => {
        setItems((prev) => [p.new, ...prev].slice(0, 40))
        setTick((t) => t + 1)
        toast(p.new.title, { icon: '🔔' })
      })
      .subscribe()
    // fallback when realtime is unavailable
    const poll = setInterval(() => { load(); setTick((t) => t + 1) }, 60000)
    return () => { supabase.removeChannel(ch); clearInterval(poll) }
  }, [user, load])

  const markRead = async (ids) => {
    await supabase.rpc('mark_notifications_read', { p_ids: ids })
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read_at: new Date().toISOString() } : n)))
  }
  const markAll = async () => {
    await supabase.rpc('mark_notifications_read', { p_ids: null })
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })))
  }
  const bump = () => setTick((t) => t + 1)

  return (
    <LiveContext.Provider value={{ tick, items, unread: items.filter((n) => !n.read_at).length, markRead, markAll, bump }}>
      {children}
    </LiveContext.Provider>
  )
}

export const useLive = () => useContext(LiveContext)
