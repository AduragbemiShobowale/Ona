export const money = (n) =>
  n == null || n === '' ? '—' : '₦' + Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const moneyShort = (n) => {
  const v = Number(n || 0)
  if (v >= 1e6) return '₦' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'm'
  if (v >= 1e3) return '₦' + Math.round(v / 1e3) + 'k'
  return '₦' + v.toFixed(0)
}

export const date = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

export const dateTime = (d) =>
  d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export const ago = (d) => {
  if (!d) return ''
  const s = (Date.now() - new Date(d).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + ' min ago'
  if (s < 86400) return Math.floor(s / 3600) + ' h ago'
  return Math.floor(s / 86400) + ' d ago'
}

export const hoursLeft = (d) => {
  const h = (new Date(d).getTime() - Date.now()) / 3600000
  if (h <= 0) return 'expired'
  if (h < 1) return Math.max(1, Math.round(h * 60)) + ' min left'
  return Math.floor(h) + ' h left'
}

// internal status -> label, tone, and what the customer sees (spec v5, section 10)
export const STATUS = {
  awaiting_address: { label: 'Awaiting address', tone: 'warn', customer: 'Choose an address' },
  received: { label: 'Received', tone: 'info', customer: 'Order placed' },
  waiting_restock: { label: 'Waiting for restock', tone: 'warn', customer: 'Preparing' },
  packed: { label: 'Packed', tone: 'info', customer: 'Packed' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'warn', customer: 'Packed' },
  payment_check: { label: 'Payment check', tone: 'warn', customer: 'Packed' },
  payment_rejected: { label: 'Payment rejected', tone: 'bad', customer: 'Packed' },
  ready_for_pickup: { label: 'Ready for pickup', tone: 'info', customer: 'Handed to Ọ̀nà' },
  rider_assigned: { label: 'Rider assigned', tone: 'info', customer: 'Rider assigned' },
  rider_at_shop: { label: 'Rider at shop', tone: 'warn', customer: 'Rider collecting' },
  failed_pickup: { label: 'Failed pickup', tone: 'bad', customer: 'Short delay at the shop' },
  out_for_delivery: { label: 'Out for delivery', tone: 'accent', customer: 'Out for delivery' },
  rider_changing: { label: 'Rider changing', tone: 'warn', customer: 'Out for delivery' },
  delivered: { label: 'Delivered', tone: 'good', customer: 'Delivered' },
  failed_delivery: { label: 'Failed delivery', tone: 'bad', customer: 'Delivery not completed' },
  returned: { label: 'Returned', tone: 'muted', customer: 'Returned to the business' },
  cancelled: { label: 'Cancelled', tone: 'muted', customer: 'Cancelled' },
  claim_open: { label: 'Claim open', tone: 'bad', customer: 'Being reviewed' },
}

export const ACTIVE_STATUSES = Object.keys(STATUS).filter((s) => !['delivered', 'cancelled', 'returned'].includes(s))

export const ROLE_LABEL = {
  super_admin: 'Super admin',
  operations: 'Operations',
  owner: 'Business owner',
  rider: 'Rider',
  customer: 'Customer',
}

export const RULE_LABEL = {
  mandatory: 'Mandatory fields',
  sku: 'SKU',
  quantity: 'Quantity',
  stock: 'Stock availability',
  customer_status: 'Customer status',
  pricing: 'Pricing',
  duplicate: 'Duplicate order',
  delivery: 'Delivery date and address',
  unusual_quantity: 'Unusual quantity',
  all: 'All rules',
}

export const tomorrow = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}
