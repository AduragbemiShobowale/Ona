// Riders without e-mail sign in with their phone number. Their login address is
// built the same way the admin-users function builds it.
export const RIDER_LOGIN_DOMAIN = 'rider.ona.invalid'

export function loginAddress(input) {
  const v = String(input || '').trim()
  if (v.includes('@')) return v.toLowerCase()
  let d = v.replace(/\D/g, '')
  if (d.startsWith('0')) d = '234' + d.slice(1)
  return `${d}@${RIDER_LOGIN_DOMAIN}`
}

export const isPhoneLogin = (email) => String(email || '').endsWith('@' + RIDER_LOGIN_DOMAIN)
export const phoneFromLogin = (email) => (isPhoneLogin(email) ? '0' + email.split('@')[0].slice(3) : null)
