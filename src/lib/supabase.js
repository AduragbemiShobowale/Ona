import { createClient } from '@supabase/supabase-js'

// Publishable values: safe to ship to the browser. Access is enforced by
// row-level security and the database functions, not by hiding these.
// Defaults point at the Ọ̀nà project; override with .env.local for another project.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://sezjhdfmgjndnbsjtsjp.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_mKEzUbmXH4MiDdqfiT4C-Q_4dUMFbTE'

export const configured = Boolean(url && key)

export const supabase = createClient(url || 'https://not-configured.invalid', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

// Call a database function and turn its error into a plain message.
export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message || 'Something went wrong.')
  return data
}

// Staff and rider accounts are created by an edge function, because that needs the service key.
export async function adminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    let msg = error.message
    try {
      const j = await error.context.json()
      if (j?.error) msg = j.error
    } catch { /* keep the generic message */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export async function uploadFile(bucket, file, ownerId, folder) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${ownerId}/${folder ? folder + '/' : ''}${Date.now()}-${safe}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false })
  if (error) throw new Error(error.message)
  return path
}

export async function signedUrl(bucket, path) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300)
  if (error) throw new Error(error.message)
  return data.signedUrl
}
