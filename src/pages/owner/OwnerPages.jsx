import { useState, useMemo, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase, rpc, uploadFile } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useLoad, q, Card, Kpi, PageHead, Loading, Empty, StatusBadge, BarChart, Seg, Modal, useAction, Badge, FileLink } from '../../components/ui'
import { naira, windowLabel, pct, minutesSince, VEHICLE
, dateTime, date } from '../../lib/format'
import Icon from '../../components/icons'
import OrderPanel from '../shared/OrderPanel'

// ------------------------------------------------------------ home
export function OwnerHome() {
  const { profile } = useAuth()
  const { data, error } = useLoad(async () => ({ ov: await rpc('owner_overview'), pickups: await rpc('owner_pickups') }))
  const [run, busy] = useAction()
  const [, force] = useState(0)
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 30000); return () => clearInterval(t) }, [])
  if (!data) return <Loading error={error} />
  const { ov, pickups } = data
  const s = ov.orders_by_status || {}
  const toPack = (s.received || 0)
  const first = (profile?.full_name || '').split(' ')[0]
  return (
    <>
      <PageHead hero title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}${first ? ', ' + first : ''}`}
        sub={`${profile?.business_name}. Pack your orders, send them to Ọ̀nà and we deliver them, with a code at every handover.`}>
        <Link className="btn" to="/stock"><Icon name="layers" size={16} /> Stock</Link>
        <Link className="btn sun" to="/new-order"><Icon name="plus" size={16} /> New order</Link>
      </PageHead>

      {pickups.length > 0 && (
        <Card title="Rider coming for pickup" pad={false}>
          {pickups.map((p) => {
            const waited = minutesSince(p.arrived_at)
            return (
              <div key={p.stop_id} className="list-row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <span className={`ic ${p.arrived_at ? 'warn' : ''}`}><Icon name={p.vehicle === 'bike' ? 'bike' : 'truck'} /></span>
                <div className="grow">
                  <strong>{p.rider}</strong> · {VEHICLE[p.vehicle]} {p.plate}
                  <div className="muted small">{p.bags} bag{p.bags > 1 ? 's' : ''} · {(p.orders || []).join(', ')} · {p.arrived_at ? `at your door ${waited} min${waited > 10 ? ` (waiting charge ${naira(Math.ceil((waited - 10) / 5) * 200)})` : ' (10 free minutes)'}` : p.route_status === 'offered' ? 'waiting for the rider to accept' : 'on the way to you'}</div>
                </div>
                <div className="code-big" style={{ fontSize: 26, padding: '8px 16px' }}><small>Pickup code</small>{p.code}</div>
                {p.arrived_at && !p.extra_time && <button className="btn" disabled={busy} onClick={() => run(() => rpc('owner_more_time', { p_stop: p.stop_id }), 'Rider told: 10 more minutes')}>Need 10 more minutes</button>}
              </div>
            )
          })}
          <div className="card-body muted small" style={{ borderTop: '1px dashed var(--line-2)' }}>Check the rider's name and plate, hand over the bags, then read out the code. The rider never sees it.</div>
        </Card>
      )}

      <div className="kpis">
        <Kpi icon="box" label="To pack" value={toPack} note={`${s.awaiting_address || 0} waiting for the customer's address`} to="/orders?tab=pack" tone={toPack ? 'sun' : ''} />
        <Kpi icon="card" label="Waiting for payment" value={(s.awaiting_payment || 0) + (s.payment_check || 0) + (s.payment_rejected || 0)} note={s.payment_rejected ? `${s.payment_rejected} rejected` : 'Ọ̀nà confirms within 15 min'} to="/payments" tone={s.payment_rejected ? 'alert' : ''} />
        <Kpi icon="route" label="With Ọ̀nà now" value={['ready_for_pickup', 'rider_assigned', 'rider_at_shop', 'out_for_delivery', 'rider_changing'].reduce((a, k) => a + (s[k] || 0), 0)} to="/orders?tab=ona" />
        <Kpi icon="check" label="On time (30 days)" value={pct(ov.on_time_30d, ov.delivered_30d)} note={`${ov.delivered_30d} delivered${ov.late_traffic_30d ? ` · ${ov.late_traffic_30d} late from traffic` : ''}`} tone="good" />
        <Kpi icon="money" label="Delivery fees (30 days)" value={naira(ov.fees_30d)} note={Number(ov.balance) < 0 ? `${naira(-ov.balance)} credit on your next payment` : Number(ov.balance) > 0 ? `${naira(ov.balance)} waiting charges to add` : 'Nothing carried over'} to="/payments" />
        <Kpi icon="layers" label="Low stock" value={ov.low_stock} note={`Stock value ${naira(ov.stock_value)}`} to="/stock" tone={ov.low_stock ? 'alert' : ''} />
      </div>

      <div className="grid-main">
        <Card title="Orders, last 14 days"><BarChart data={ov.by_day} series={[{ key: 'created', label: 'Created' }, { key: 'delivered', label: 'Delivered' }]} /></Card>
        <Card title="How customers rate you">
          <div className="stack">
            <div className="row"><span style={{ fontSize: 34, fontWeight: 800 }}>{ov.rating ?? '—'}</span><span className="muted">/ 5 from {ov.ratings} rating{ov.ratings === 1 ? '' : 's'}</span></div>
            <div className="muted small">{ov.customers} customer{ov.customers === 1 ? '' : 's'} have received orders from you through Ọ̀nà.</div>
            <div className="muted small">{ov.packing_issues} packing issue{ov.packing_issues === 1 ? '' : 's'} found in pickup photos · {ov.failed_30d} failed pickup or delivery in 30 days.</div>
            <Link to="/feedback">See feedback and claims →</Link>
          </div>
        </Card>
      </div>
    </>
  )
}

// ------------------------------------------------------------ orders board
const TABS = [
  { value: 'pack', label: 'To pack', st: ['awaiting_address', 'received', 'waiting_restock'] },
  { value: 'send', label: 'Packed', st: ['packed'] },
  { value: 'pay', label: 'Payment', st: ['awaiting_payment', 'payment_check', 'payment_rejected'] },
  { value: 'ona', label: 'With Ọ̀nà', st: ['ready_for_pickup', 'rider_assigned', 'rider_at_shop', 'out_for_delivery', 'rider_changing'] },
  { value: 'done', label: 'Delivered', st: ['delivered'] },
  { value: 'problem', label: 'Problems', st: ['failed_pickup', 'failed_delivery', 'returned', 'claim_open'] },
  { value: 'all', label: 'All', st: null },
]

export function OwnerOrders() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'pack'
  const [open, setOpen] = useState(params.get('o'))
  const [sel, setSel] = useState([])
  const [search, setSearch] = useState('')
  const nav = useNavigate()
  const [run, busy] = useAction()
  const { data, error, reload } = useLoad(() => q(supabase.from('orders').select('id, ref, status, customer_name, customer_email, zone, window_start, window_end, bags, vehicle_type, created_at, drop_address, order_charges(fee)').order('created_at', { ascending: false }).limit(500)))
  const rows = data || []
  const counts = Object.fromEntries(TABS.map((t) => [t.value, t.st ? rows.filter((r) => t.st.includes(r.status)).length : rows.length]))
  const st = TABS.find((t) => t.value === tab)?.st
  const shown = rows.filter((r) => (!st || st.includes(r.status)) && (!search || `${r.ref} ${r.customer_name} ${r.customer_email}`.toLowerCase().includes(search.toLowerCase())))
  const fee = (r) => Number((Array.isArray(r.order_charges) ? r.order_charges[0] : r.order_charges)?.fee || 0)
  const selected = rows.filter((r) => sel.includes(r.id))
  const total = selected.reduce((a, r) => a + fee(r), 0)
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const request = () => run(() => rpc('request_dispatch', { p_orders: sel }), `Dispatch requested for ${sel.length} order${sel.length > 1 ? 's' : ''}`).then((r) => { if (r) { setSel([]); nav('/payments') } })
  const pack = (id) => run(() => rpc('owner_set_status', { p_order: id, p_to: 'packed', p_reason: null }), 'Packed').then(reload)

  return (
    <>
      <PageHead title="Orders" sub="Pack each order, tick the packed ones and send them to Ọ̀nà together with one payment.">
        <Link className="btn" to="/bulk"><Icon name="upload" size={16} /> Bulk orders</Link>
        <Link className="btn primary" to="/new-order"><Icon name="plus" size={16} /> New order</Link>
      </PageHead>
      <div className="row between">
        <Seg value={tab} onChange={(v) => { setParams({ tab: v }); setSel([]) }} options={TABS.map((t) => ({ value: t.value, label: t.label, count: t.value === 'all' ? 0 : counts[t.value] }))} />
        <input style={{ maxWidth: 260 }} placeholder="Search order or customer" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <Card pad={false}>
        {!data ? <Loading error={error} /> : shown.length === 0 ? <Empty>No orders here.</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr>{tab === 'send' && <th />}<th>Order</th><th>Customer</th><th>Window</th><th>Zone</th><th>Bags</th><th>Fee</th><th>Status</th><th /></tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id} onClick={() => setOpen(r.id)} style={{ cursor: 'pointer' }}>
                {tab === 'send' && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.ref}`} /></td>}
                <td className="mono"><strong>{r.ref}</strong></td>
                <td>{r.customer_name || r.customer_email}{r.customer_name && <div className="muted small">{r.customer_email}</div>}</td>
                <td className="nowrap">{windowLabel(r.window_start, r.window_end)}</td>
                <td>{r.zone}</td>
                <td className="nowrap">{r.bags} · {VEHICLE[r.vehicle_type]}</td>
                <td className="mono">{naira(fee(r))}</td>
                <td><StatusBadge status={r.status} /></td>
                <td onClick={(e) => e.stopPropagation()}>{r.status === 'received' && <button className="btn sm primary" disabled={busy} onClick={() => pack(r.id)}>Mark packed</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      {tab === 'send' && shown.length > 0 && (
        <div className="sel-bar">
          <label className="row" style={{ color: '#fff' }}><input type="checkbox" checked={sel.length === shown.length} onChange={(e) => setSel(e.target.checked ? shown.map((r) => r.id) : [])} /> Select all</label>
          <span className="spacer" />
          <span>{sel.length} selected · <strong>{naira(total)}</strong></span>
          <button className="btn sun" disabled={!sel.length || busy} onClick={request}>Request dispatch{sel.length ? ` for ${sel.length}` : ''}</button>
        </div>
      )}
      {open && <OrderPanel id={open} onClose={() => { setOpen(null); reload() }} />}
    </>
  )
}

// ------------------------------------------------------------ stock
export function Stock() {
  const { data, error, reload } = useLoad(() => q(supabase.from('products').select('*').order('name')))
  const [edit, setEdit] = useState(null)
  const [move, setMove] = useState(null)
  const [hist, setHist] = useState(null)
  const [show, setShow] = useState('all')
  const rows = (data || []).filter((p) => show === 'all' || (show === 'low' && p.active && p.on_hand - p.reserved <= p.low_stock_at) || (show === 'off' && !p.active))
  const low = (data || []).filter((p) => p.active && p.on_hand - p.reserved <= p.low_stock_at).length
  return (
    <>
      <PageHead title="Stock" sub="What you have on the shelf. New orders reserve stock; it leaves your count when the rider collects it.">
        <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" size={16} /> Add product</button>
      </PageHead>
      <Seg value={show} onChange={setShow} options={[{ value: 'all', label: 'All products' }, { value: 'low', label: 'Low stock', count: low }, { value: 'off', label: 'Hidden' }]} />
      <Card pad={false}>
        {!data ? <Loading error={error} /> : rows.length === 0 ? <Empty>{data.length ? 'Nothing here.' : 'Add your first product to start taking orders.'}</Empty> : (
          <div className="table-wrap"><table>
            <thead><tr><th>SKU</th><th>Product</th><th>Size</th><th>Price</th><th>On shelf</th><th>Reserved</th><th>Available</th><th /></tr></thead>
            <tbody>{rows.map((p) => {
              const avail = p.on_hand - p.reserved
              return (
                <tr key={p.id}>
                  <td className="mono">{p.sku}</td>
                  <td><strong>{p.name}</strong>{!p.active && <> <Badge>hidden</Badge></>}</td>
                  <td className="small">{p.size_class}</td>
                  <td className="mono">{naira(p.price)}</td>
                  <td className="mono">{p.on_hand}</td>
                  <td className="mono">{p.reserved}</td>
                  <td>{avail <= p.low_stock_at ? <Badge tone={avail <= 0 ? 'bad' : 'warn'}>{avail}</Badge> : <span className="mono">{avail}</span>}</td>
                  <td className="nowrap">
                    <button className="btn sm" onClick={() => setMove({ p, kind: 'stock_in' })}>Stock in</button>{' '}
                    <button className="btn sm ghost" onClick={() => setMove({ p, kind: 'adjust' })}>Adjust</button>
                    <button className="btn sm ghost" onClick={() => setEdit(p)}>Edit</button>
                    <button className="btn sm ghost" onClick={() => setHist(p)}>History</button>
                  </td>
                </tr>
              )
            })}</tbody>
          </table></div>
        )}
      </Card>
      {edit && <ProductModal p={edit} onClose={() => setEdit(null)} onDone={reload} />}
      {move && <MoveModal {...move} onClose={() => setMove(null)} onDone={reload} />}
      {hist && <HistoryModal p={hist} onClose={() => setHist(null)} />}
    </>
  )
}

function ProductModal({ p, onClose, onDone }) {
  const [f, setF] = useState({ sku: p.sku || '', name: p.name || '', size: p.size_class || 'small', price: p.price ?? '', low: p.low_stock_at ?? 3, active: p.active ?? true })
  const [run, busy] = useAction()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const save = () => run(() => rpc('save_product', { p_id: p.id || null, p_sku: f.sku, p_name: f.name, p_size: f.size, p_price: Number(f.price || 0), p_low: Number(f.low || 0), p_active: f.active }), 'Saved').then((r) => { if (r) { onDone(); onClose() } })
  return (
    <Modal title={p.id ? `Edit ${p.name}` : 'Add a product'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="grid-2">
        <label className="field">SKU <span className="hint">Your own short code</span><input value={f.sku} onChange={set('sku')} placeholder="ANK-01" /></label>
        <label className="field">Price (₦) <span className="hint">Only you and your customer see it</span><input type="number" min="0" value={f.price} onChange={set('price')} /></label>
      </div>
      <label className="field">Product name<input value={f.name} onChange={set('name')} placeholder="Ankara fabric, 6 yards" /></label>
      <div className="grid-2">
        <label className="field">Size <span className="hint">Picks the vehicle</span>
          <select value={f.size} onChange={set('size')}><option value="small">Small (fits a bike box)</option><option value="medium">Medium (needs a car)</option><option value="large">Large (needs a van)</option><option value="bulky">Bulky (needs a truck)</option></select></label>
        <label className="field">Warn me when available falls to<input type="number" min="0" value={f.low} onChange={set('low')} /></label>
      </div>
      {p.id && <label className="row"><input type="checkbox" checked={f.active} onChange={set('active')} /> Show this product in new orders</label>}
      {!p.id && <p className="muted small">Add the quantity with Stock in after saving.</p>}
    </Modal>
  )
}

function MoveModal({ p, kind, onClose, onDone }) {
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [run, busy] = useAction()
  const save = () => run(() => rpc('move_stock', { p_product: p.id, p_kind: kind, p_qty: Number(qty), p_reason: reason || null }), 'Stock updated').then(() => { onDone(); onClose() })
  return (
    <Modal title={`${kind === 'stock_in' ? 'Stock in' : 'Adjust'}: ${p.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button><button className="btn primary" disabled={busy || !qty} onClick={save}>Save</button></>}>
      <p className="muted">On the shelf now: <strong>{p.on_hand}</strong> · reserved for orders: <strong>{p.reserved}</strong></p>
      <label className="field">{kind === 'stock_in' ? 'How many came in' : 'Change (use a minus for fewer, e.g. -2)'}<input type="number" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></label>
      <label className="field">{kind === 'stock_in' ? 'Note (optional)' : 'Reason'}<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'stock_in' ? 'Supplier delivery' : 'Damaged on the shelf, counted wrong…'} /></label>
    </Modal>
  )
}

function HistoryModal({ p, onClose }) {
  const { data, error } = useLoad(() => q(supabase.from('stock_movements').select('*').eq('product_id', p.id).order('at', { ascending: false }).limit(100)), [p.id])
  const label = { stock_in: 'Stock in', adjust: 'Adjustment', reserve: 'Reserved', release: 'Released', dispatch: 'Collected' }
  return (
    <Modal wide title={`Stock history: ${p.name}`} onClose={onClose}>
      {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>No movements yet.</Empty> : (
        <div className="table-wrap"><table><thead><tr><th>When</th><th>What</th><th>Qty</th><th>Note</th></tr></thead>
          <tbody>{data.map((m) => <tr key={m.id}><td className="nowrap small">{dateTime(m.at)}</td><td>{label[m.kind]}</td><td className="mono">{m.qty > 0 ? '+' : ''}{m.qty}</td><td className="muted small">{m.reason}</td></tr>)}</tbody></table></div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------ customers (only those this business has sent orders to)
export function MyCustomers() {
  const { data, error } = useLoad(() => q(supabase.from('business_customers').select('*').order('last_order_at', { ascending: false })))
  return (
    <>
      <PageHead title="My customers" sub="People you have sent orders to through Ọ̀nà. There is no search of other customers: you reach someone only by sending them an order." />
      <Card pad={false}>
        {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>No customers yet. They appear here after your first order to them.</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>Customer</th><th>Orders</th><th>First order</th><th>Last order</th><th>Account</th></tr></thead>
            <tbody>{data.map((c) => <tr key={c.email}><td><strong>{c.display_name || c.email}</strong>{c.display_name && <div className="muted small">{c.email}</div>}</td>
              <td className="mono">{c.orders_count}</td><td className="small">{date(c.first_order_at)}</td><td className="small">{date(c.last_order_at)}</td>
              <td>{c.customer_id ? <Badge tone="good">Tracking in the app</Badge> : <Badge>Not signed up yet</Badge>}</td></tr>)}</tbody></table></div>
        )}
      </Card>
    </>
  )
}

// ------------------------------------------------------------ payments (Verity approach: transfer, upload receipt, Ọ̀nà confirms)
export function OwnerPayments() {
  const { account } = useAuth()
  const bid = account?.profile?.business_id
  const { data, error, reload } = useLoad(async () => {
    await rpc('expire_overdue_requests').catch(() => {})
    const [reqs, pays, adj, settings] = await Promise.all([
      q(supabase.from('dispatch_requests').select('*').order('created_at', { ascending: false }).limit(50)),
      q(supabase.from('payments').select('*').order('created_at', { ascending: false }).limit(100)),
      q(supabase.from('business_adjustments').select('*').order('created_at', { ascending: false }).limit(100)),
      q(supabase.from('settings').select('key, value').in('key', ['bank_details'])),
    ])
    return { reqs, pays, adj, bank: settings.find((s) => s.key === 'bank_details')?.value }
  })
  const [pay, setPay] = useState(null)
  const [run] = useAction()
  if (!data) return <Loading error={error} />
  const open = data.reqs.filter((r) => ['awaiting_payment', 'payment_check'].includes(r.status))
  const balance = data.adj.filter((a) => !a.request_id).reduce((s, a) => s + Number(a.amount), 0)
  const lastReject = (rid) => data.pays.find((p) => p.request_id === rid && p.status === 'rejected')
  return (
    <>
      <PageHead title="Payments" sub="Transfer the delivery fee to Ọ̀nà, upload the receipt, and we confirm it (target: within 15 minutes in working hours). Then a rider is assigned." />
      <div className="kpis">
        <Kpi icon="card" label="Waiting for your transfer" value={open.filter((r) => r.status === 'awaiting_payment').length} tone={open.some((r) => r.status === 'awaiting_payment') ? 'sun' : ''} />
        <Kpi icon="clock" label="Receipts being checked" value={open.filter((r) => r.status === 'payment_check').length} />
        <Kpi icon="money" label={balance < 0 ? 'Credit for your next payment' : 'Waiting charges to add'} value={naira(Math.abs(balance))} note="Applied automatically to the next request" />
      </div>
      {open.map((r) => {
        const rej = lastReject(r.id)
        return (
          <section className="waybill" key={r.id} style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
            <div className="waybill-head"><span>Dispatch request · <b>{r.ref}</b></span><span>{r.status === 'awaiting_payment' ? `Pay by ${dateTime(r.due_at)}` : 'Receipt being checked'}</span></div>
            <div className="waybill-body">
              <div className="grid-2">
                <dl className="dl">
                  <dt>Delivery fees</dt><dd className="mono">{naira(r.total_fee)}</dd>
                  {Number(r.adjustments) !== 0 && <><dt>{Number(r.adjustments) < 0 ? 'Credit used' : 'Waiting charges'}</dt><dd className="mono">{Number(r.adjustments) < 0 ? '−' : '+'}{naira(Math.abs(r.adjustments))}</dd></>}
                  <dt>To transfer</dt><dd className="mono" style={{ fontSize: 22 }}>{naira(r.amount_due)}</dd>
                  <dt>Reference</dt><dd className="mono">{r.ref}</dd>
                </dl>
                <div className="notice info">
                  <strong>Pay to</strong>
                  <span>{data.bank?.bank}</span><span>{data.bank?.account_name}</span><span className="mono" style={{ fontSize: 18 }}>{data.bank?.account_no}</span>
                  <span className="small">Put <b>{r.ref}</b> in the transfer narration.</span>
                </div>
              </div>
              {rej && r.status === 'awaiting_payment' && <div className="notice bad"><strong>Last receipt rejected:</strong> {rej.reject_reason}. Attempt {r.attempts} of 3.</div>}
              <div className="row">
                {r.status === 'awaiting_payment' && <button className="btn sun" onClick={() => setPay(r)}><Icon name="upload" size={16} /> I've paid: upload receipt</button>}
                {r.status === 'awaiting_payment' && <button className="btn ghost" onClick={() => run(() => rpc('cancel_request', { p_request: r.id }), 'Request withdrawn').then(reload)}>Withdraw request</button>}
              </div>
            </div>
          </section>
        )
      })}
      <div className="grid-main">
        <Card title="Payment history" pad={false}>
          {data.pays.length === 0 ? <Empty>No payments yet.</Empty> : (
            <div className="table-wrap"><table><thead><tr><th>Sent</th><th>Request</th><th>Amount</th><th>Reference</th><th>Receipt</th><th>Result</th></tr></thead>
              <tbody>{data.pays.map((p) => <tr key={p.id}><td className="small nowrap">{dateTime(p.created_at)}</td><td className="mono">{data.reqs.find((r) => r.id === p.request_id)?.ref}</td>
                <td className="mono">{naira(p.amount)}</td><td className="mono small">{p.reference}</td><td><FileLink bucket="receipts" path={p.receipt_path} /></td>
                <td>{p.status === 'confirmed' ? <Badge tone="good">Confirmed</Badge> : p.status === 'rejected' ? <span title={p.reject_reason}><Badge tone="bad">Rejected</Badge></span> : <Badge tone="warn">Checking</Badge>}</td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Card title="Credits and waiting charges" pad={false}>
          {data.adj.length === 0 ? <Empty>None.</Empty> : <div className="list">{data.adj.map((a) => (
            <div className="list-row" key={a.id}><span className={`ic ${a.kind === 'credit' ? 'good' : 'warn'}`}><Icon name={a.kind === 'credit' ? 'money' : 'clock'} size={16} /></span>
              <div className="grow"><div className="row between"><strong className="mono">{Number(a.amount) < 0 ? '−' : '+'}{naira(Math.abs(a.amount))}</strong><span className="muted small">{a.request_id ? 'used' : 'next payment'}</span></div><div className="muted small">{a.reason}</div></div></div>))}</div>}
        </Card>
      </div>
      {pay && <ReceiptModal r={pay} bid={bid} onClose={() => setPay(null)} onDone={reload} />}
    </>
  )
}

function ReceiptModal({ r, bid, onClose, onDone }) {
  const [file, setFile] = useState(null)
  const [ref, setRef] = useState('')
  const [amount, setAmount] = useState(r.amount_due)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const path = await uploadFile('receipts', file, bid, r.ref)
      await rpc('submit_payment', { p_request: r.id, p_reference: ref, p_receipt_path: path, p_amount: Number(amount) })
      onDone(); onClose()
    } catch (e) { setErr(e.message); setBusy(false) }
  }
  return (
    <Modal title={`Receipt for ${r.ref}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button><button className="btn sun" disabled={busy || !file || ref.length < 4} onClick={send}>{busy ? 'Sending…' : 'Send receipt'}</button></>}>
      <label className="field">Amount transferred (₦)<input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label className="field">Transfer reference <span className="hint">From your bank app</span><input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. 000123456789" /></label>
      <label className="field">Receipt <span className="hint">Photo, screenshot or PDF, up to 5 MB</span><input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ paddingTop: 9 }} /></label>
      {err && <div className="notice bad">{err}</div>}
    </Modal>
  )
}

// ------------------------------------------------------------ feedback, issues and claims
export function OwnerFeedback() {
  const { data, error } = useLoad(async () => {
    const [fb, issues, claims] = await Promise.all([
      q(supabase.from('order_feedback').select('*, orders(ref, customer_name, customer_email)').order('created_at', { ascending: false })),
      q(supabase.from('issues').select('*, orders(ref)').order('created_at', { ascending: false }).limit(100)),
      q(supabase.from('claims').select('*, orders(ref)').order('created_at', { ascending: false })),
    ])
    return { fb, issues, claims }
  })
  const [open, setOpen] = useState(null)
  if (!data) return <Loading error={error} />
  const claimTone = { open: 'warn', approved: 'info', rejected: 'muted', paid: 'good' }
  return (
    <>
      <PageHead title="Feedback and claims" sub="What customers said, problems on your orders, and claims you have made. To open a claim, open the delivered order." />
      <div className="grid-main">
        <div className="stack-lg">
          <Card title="Claims" pad={false}>
            {data.claims.length === 0 ? <Empty>No claims.</Empty> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Kind</th><th>Claimed</th><th>Cause</th><th>Status</th><th>Decision</th></tr></thead>
              <tbody>{data.claims.map((c) => <tr key={c.id} onClick={() => setOpen(c.order_id)} style={{ cursor: 'pointer' }}><td className="mono">{c.orders?.ref}</td><td>{c.kind}</td><td className="mono">{naira(c.claimed_value)}</td><td>{c.cause === 'store' ? 'Packing (yours)' : c.cause || '—'}</td>
                <td><Badge tone={claimTone[c.status]}>{c.status}</Badge></td><td className="small">{c.decision}{c.refund_reference && <div className="muted">Refund ref {c.refund_reference}</div>}</td></tr>)}</tbody></table></div>}
          </Card>
          <Card title="Problems on your orders" pad={false}>
            {data.issues.length === 0 ? <Empty>No problems reported.</Empty> : <div className="list">{data.issues.map((i) => (
              <div className="list-row" key={i.id} onClick={() => i.order_id && setOpen(i.order_id)} style={{ cursor: i.order_id ? 'pointer' : 'default' }}>
                <span className={`ic ${i.status === 'open' ? 'bad' : 'good'}`}><Icon name={i.status === 'open' ? 'alert' : 'check'} size={16} /></span>
                <div className="grow"><div className="row between"><strong>{i.kind.replace(/_/g, ' ')} · <span className="mono">{i.orders?.ref}</span></strong><span className="muted small">{dateTime(i.created_at)}</span></div>
                  <div className="small">{i.detail}</div>{i.resolution && <div className="muted small">Resolved: {i.resolution}</div>}</div></div>))}</div>}
          </Card>
        </div>
        <Card title="Ratings" pad={false}>
          {data.fb.length === 0 ? <Empty>No ratings yet.</Empty> : <div className="list">{data.fb.map((f) => (
            <div className="list-row" key={f.order_id}><span className="ic"><Icon name="star" size={16} /></span>
              <div className="grow"><div className="row between"><strong style={{ color: '#a77800' }}>{'★'.repeat(f.rating)}<span style={{ color: 'var(--line-2)' }}>{'★'.repeat(5 - f.rating)}</span></strong><span className="mono small">{f.orders?.ref}</span></div>
                {f.comment && <div className="small">“{f.comment}”</div>}<div className="muted small">{f.orders?.customer_name || f.orders?.customer_email}</div></div></div>))}</div>}
        </Card>
      </div>
      {open && <OrderPanel id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

