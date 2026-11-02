import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase, rpc } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useLoad, q, Card, PageHead, Loading, Empty, StatusBadge, Modal, ReasonModal, useAction, Badge } from '../../components/ui'
import { windowLabel, VEHICLE, dateTime, timeOnly, ZONES, STATUS } from '../../lib/format'
import Icon from '../../components/icons'
import MapView from '../../components/Map'

const STEPS = [
  ['Order placed', ['awaiting_address', 'received', 'waiting_restock']],
  ['Packed', ['packed', 'awaiting_payment', 'payment_check', 'payment_rejected']],
  ['With Ọ̀nà', ['ready_for_pickup', 'rider_assigned', 'rider_at_shop', 'failed_pickup']],
  ['On the way', ['out_for_delivery', 'rider_changing']],
  ['Delivered', ['delivered', 'claim_open']],
]

export function MyOrders() {
  const { data, error } = useLoad(async () => {
    await rpc('link_my_orders').catch(() => 0)
    return q(supabase.from('orders').select('id, ref, status, window_start, window_end, drop_address, created_at, businesses(name), order_items(name, qty)').order('created_at', { ascending: false }))
  })
  const active = (data || []).filter((o) => !['delivered', 'cancelled', 'returned', 'claim_open'].includes(o.status))
  const past = (data || []).filter((o) => !active.includes(o))
  const Row = ({ o }) => (
    <Link to={`/orders/${o.id}`} className="list-row" style={{ color: 'inherit', textDecoration: 'none', alignItems: 'center' }}>
      <span className={`ic ${o.status === 'awaiting_address' ? 'warn' : o.status === 'delivered' ? 'good' : ''}`}><Icon name={o.status === 'out_for_delivery' ? 'bike' : 'box'} /></span>
      <div className="grow">
        <div className="row between"><strong>{o.businesses?.name}</strong><StatusBadge status={o.status} customer /></div>
        <div className="muted small">{o.order_items?.map((i) => `${i.qty} × ${i.name}`).join(', ')}</div>
        <div className="small">{o.status === 'awaiting_address' ? <b style={{ color: 'var(--warn)' }}>Choose your delivery address</b> : windowLabel(o.window_start, o.window_end)}</div>
      </div>
      <Icon name="arrow" size={16} />
    </Link>
  )
  return (
    <>
      <PageHead hero title="Your deliveries" sub="Orders that businesses send to your e-mail appear here. Give the rider your delivery code only after you've checked the items." />
      {!data ? <Loading error={error} /> : data.length === 0 ? (
        <Card><Empty>No orders yet. When a business sends an order to your e-mail, it shows up here.</Empty></Card>
      ) : (
        <>
          <Card title="On the way" pad={false}>{active.length === 0 ? <Empty>Nothing on the way right now.</Empty> : <div className="list">{active.map((o) => <Row key={o.id} o={o} />)}</div>}</Card>
          {past.length > 0 && <Card title="Earlier" pad={false}><div className="list">{past.map((o) => <Row key={o.id} o={o} />)}</div></Card>}
        </>
      )}
    </>
  )
}

export function CustomerOrder() {
  const { id } = useParams()
  const { data, error, reload } = useLoad(async () => ({
    o: await q(supabase.from('orders').select('*, businesses(name, phone), order_items(name, qty, unit_price)').eq('id', id).single()),
    t: await rpc('order_tracking', { p_order: id }),
    events: await q(supabase.from('order_events').select('*').eq('order_id', id).order('at')),
  }), [id])
  const [addr, setAddr] = useState(false)
  const [rate, setRate] = useState(false)
  const [report, setReport] = useState(false)
  useEffect(() => { const t = setInterval(reload, 30000); return () => clearInterval(t) }, [reload])
  if (!data) return <Loading error={error} />
  const { o, t } = data
  const stepIdx = STEPS.findIndex(([, ks]) => ks.includes(o.status))
  const goods = o.order_items.reduce((s, i) => s + i.qty * i.unit_price, 0)
  return (
    <>
      <div className="row"><Link to="/" className="small">← Your deliveries</Link></div>
      <PageHead title={`${o.businesses?.name}`} sub={`Order ${o.ref} · ${STATUS[o.status]?.customer}`}><StatusBadge status={o.status} customer /></PageHead>
      {o.status !== 'cancelled' && o.status !== 'returned' && (
        <div className="card"><div className="card-body">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STEPS.length}, 1fr)`, gap: 6 }}>
            {STEPS.map(([l], i) => <div key={l} style={{ display: 'grid', gap: 6 }}><div style={{ height: 6, borderRadius: 4, background: i <= stepIdx ? 'var(--indigo)' : 'var(--line)' }} /><span className="small" style={{ fontWeight: i === stepIdx ? 800 : 500, color: i <= stepIdx ? 'var(--ink)' : 'var(--ink-3)' }}>{l}</span></div>)}
          </div>
        </div></div>
      )}
      {o.status === 'awaiting_address' && (
        <div className="notice warn"><strong>Where should we deliver?</strong>Choose your address so {o.businesses?.name} can pack your order.<div><button className="btn sun" onClick={() => setAddr(true)}>Choose address</button></div></div>
      )}
      <div className="grid-main">
        <div className="stack-lg">
          {t?.delivery_code && (
            <div className="code-big"><small>Your delivery code · give it to the rider after checking the items</small>{t.delivery_code}</div>
          )}
          {t?.code_locked && <div className="notice bad">The code was locked after too many wrong tries. Ọ̀nà Operations will call you to confirm.</div>}
          {t?.rider && (
            <div className="card"><div className="list-row" style={{ alignItems: 'center' }}>
              <span className="ic good"><Icon name={t.rider.vehicle === 'bike' ? 'bike' : 'truck'} /></span>
              <div className="grow"><strong>{t.rider.name}</strong><div className="muted small">{VEHICLE[t.rider.vehicle]} · {t.rider.plate}</div></div>
              {t.rider.phone && <a className="btn" href={`tel:${t.rider.phone}`}><Icon name="phone" size={16} /> Call</a>}
            </div></div>
          )}
          {(t?.location || o.drop_lat) && ['rider_assigned', 'rider_at_shop', 'out_for_delivery', 'rider_changing'].includes(o.status) && (
            <MapView points={[{ ...t.pickup, kind: 'pickup', label: t.pickup?.name }, { ...t.drop, kind: 'drop', label: 'You' }, t.location && { ...t.location, kind: 'rider', label: t.rider?.name }]} />
          )}
          <Card title="Items">
            <div className="list">{o.order_items.map((i, n) => <div className="row between" key={n} style={{ padding: '4px 0' }}><span>{i.qty} × {i.name}</span></div>)}</div>
            <p className="muted small" style={{ marginTop: 8 }}>You pay {o.businesses?.name} for the goods directly, not Ọ̀nà.{goods ? '' : ''}</p>
          </Card>
          <Card title="Updates"><div className="timeline">{data.events.map((e) => <div className="tl" key={e.id}><span className="pt" /><div className="row between"><strong>{STATUS[e.to_status]?.customer}</strong><span className="muted small">{dateTime(e.at)}</span></div></div>)}</div></Card>
        </div>
        <div className="stack">
          <Card><dl className="dl">
            <dt>Window</dt><dd>{windowLabel(o.window_start, o.window_end)}</dd>
            {t?.eta && <><dt>Estimate</dt><dd>{timeOnly(t.eta)} {t.late_reason && <Badge tone="warn">{t.late_reason}</Badge>}</dd></>}
            <dt>Address</dt><dd>{o.drop_address || '—'}{o.drop_landmark && <div className="muted small">{o.drop_landmark}</div>}</dd>
            <dt>From</dt><dd>{o.businesses?.name}{o.businesses?.phone && <div className="muted small">{o.businesses.phone}</div>}</dd>
          </dl>
          {['received', 'waiting_restock', 'packed'].includes(o.status) && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setAddr(true)}>Change address</button>}
          </Card>
          {['delivered', 'claim_open'].includes(o.status) && (
            t?.feedback ? <div className="notice good"><strong>You rated {'★'.repeat(t.feedback.rating)}</strong>{t.feedback.comment}</div>
              : <button className="btn sun lg block" onClick={() => setRate(true)}><Icon name="star" /> Rate this delivery</button>
          )}
          <button className="btn ghost" onClick={() => setReport(true)}><Icon name="alert" size={16} /> Report a problem</button>
        </div>
      </div>
      {addr && <ChooseAddress order={o} onClose={() => setAddr(false)} onDone={reload} />}
      {rate && <RateModal order={o} onClose={() => setRate(false)} onDone={reload} />}
      {report && <ReasonModal title="Report a problem" label="What went wrong" minLength={10} confirm="Send" placeholder="An item was missing, the parcel was wet…" onClose={() => setReport(false)}
        onSubmit={(t2) => rpc('customer_report', { p_order: o.id, p_detail: t2 }).then(() => toast.success('Sent to the business and Ọ̀nà'))} />}
    </>
  )
}

function ChooseAddress({ order, onClose, onDone }) {
  const { data } = useLoad(() => q(supabase.from('customer_addresses').select('*').order('is_default', { ascending: false })))
  const [pick, setPick] = useState(null)
  const [f, setF] = useState({ address: '', landmark: '', phone: '', zone: order.zone || 'Lekki', save: true })
  const [run, busy] = useAction()
  const go = () => run(async () => {
    let a = data?.find((x) => x.id === pick)
    if (!a) {
      a = { address: f.address, landmark: f.landmark, phone: f.phone, zone: f.zone }
      if (f.save) await rpc('save_address', { p_id: null, p: { ...a, label: 'Home' } })
    }
    await rpc('set_order_address', { p_order: order.id, p_address: { address: a.address, landmark: a.landmark, phone: a.phone, zone: a.zone, lat: a.lat, lng: a.lng } })
  }, 'Address saved. The business can pack your order now.').then(() => { onDone(); onClose() })
  return (
    <Modal title="Delivery address" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button><button className="btn primary" disabled={busy || (!pick && f.address.length < 5)} onClick={go}>Use this address</button></>}>
      {data?.map((a) => <label key={a.id} className="list-row" style={{ border: '1px solid var(--line)', borderRadius: 12, cursor: 'pointer', background: pick === a.id ? 'var(--indigo-50)' : undefined }}>
        <input type="radio" checked={pick === a.id} onChange={() => setPick(a.id)} /><div className="grow"><strong>{a.label}</strong><div className="small">{a.address}</div><div className="muted small">{a.zone}{a.landmark && ` · ${a.landmark}`}</div></div></label>)}
      <label className="list-row" style={{ border: '1px solid var(--line)', borderRadius: 12, cursor: 'pointer', background: !pick ? 'var(--indigo-50)' : undefined }}>
        <input type="radio" checked={!pick} onChange={() => setPick(null)} /><strong>A new address</strong></label>
      {!pick && <div className="stack">
        <label className="field">Address<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="14 Bourdillon Road, Ikoyi" /></label>
        <div className="grid-2">
          <label className="field">Landmark<input value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} /></label>
          <label className="field">Phone at the door<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        </div>
        <label className="row"><input type="checkbox" checked={f.save} onChange={(e) => setF({ ...f, save: e.target.checked })} /> Save to my addresses</label>
      </div>}
      <p className="muted small">The delivery window ({windowLabel(order.window_start, order.window_end)}) was set by the business for the {order.zone} zone.</p>
    </Modal>
  )
}

function RateModal({ order, onClose, onDone }) {
  const [r, setR] = useState(5)
  const [c, setC] = useState('')
  const [run, busy] = useAction()
  return (
    <Modal title="How was your delivery?" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Later</button><button className="btn primary" disabled={busy} onClick={() => run(() => rpc('rate_order', { p_order: order.id, p_rating: r, p_comment: c }), 'Thank you').then(() => { onDone(); onClose() })}>Send</button></>}>
      <div className="row" style={{ fontSize: 34, justifyContent: 'center' }}>{[1, 2, 3, 4, 5].map((n) => <button key={n} className="btn ghost" style={{ fontSize: 32, color: n <= r ? '#d99a00' : 'var(--line-2)', height: 52 }} onClick={() => setR(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}>★</button>)}</div>
      <label className="field">Anything to add? <span className="hint">Optional</span><textarea value={c} onChange={(e) => setC(e.target.value)} /></label>
    </Modal>
  )
}

export function Addresses() {
  const { data, error, reload } = useLoad(() => q(supabase.from('customer_addresses').select('*').order('created_at')))
  const [edit, setEdit] = useState(null)
  const [run] = useAction()
  return (
    <>
      <PageHead title="Addresses" sub="Only you can see these. When a business sends you an order without an address, you pick one of these.">
        <button className="btn primary" onClick={() => setEdit({})}><Icon name="plus" size={16} /> Add address</button>
      </PageHead>
      {!data ? <Loading error={error} /> : data.length === 0 ? <Card><Empty>No saved addresses yet.</Empty></Card> : (
        <div className="grid-2">{data.map((a) => (
          <section className="card" key={a.id}><div className="card-body stack">
            <div className="row between"><strong>{a.label}</strong>{a.is_default && <Badge tone="info">Default</Badge>}</div>
            <span>{a.address}</span><span className="muted small">{a.zone}{a.landmark && ` · ${a.landmark}`}{a.phone && ` · ${a.phone}`}</span>
            <div className="row"><button className="btn sm" onClick={() => setEdit(a)}>Edit</button><button className="btn sm ghost" onClick={() => run(() => rpc('delete_address', { p_id: a.id }), 'Removed').then(reload)}>Remove</button></div>
          </div></section>))}</div>
      )}
      {edit && <AddressEdit a={edit} onClose={() => setEdit(null)} onDone={reload} />}
    </>
  )
}

function AddressEdit({ a, onClose, onDone }) {
  const [f, setF] = useState({ label: a.label || 'Home', address: a.address || '', landmark: a.landmark || '', zone: a.zone || 'Lekki', phone: a.phone || '', is_default: a.is_default || false })
  const [run, busy] = useAction()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  return (
    <Modal title={a.id ? 'Edit address' : 'New address'} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button><button className="btn primary" disabled={busy} onClick={() => run(() => rpc('save_address', { p_id: a.id || null, p: f }), 'Saved').then((r) => { if (r) { onDone(); onClose() } })}>Save</button></>}>
      <div className="grid-2"><label className="field">Name<input value={f.label} onChange={set('label')} placeholder="Home, Office…" /></label>
        <label className="field">Zone<select value={f.zone} onChange={set('zone')}>{ZONES.map((z) => <option key={z}>{z}</option>)}</select></label></div>
      <label className="field">Address<input value={f.address} onChange={set('address')} /></label>
      <div className="grid-2"><label className="field">Landmark<input value={f.landmark} onChange={set('landmark')} /></label>
        <label className="field">Phone at the door<input value={f.phone} onChange={set('phone')} /></label></div>
      <label className="row"><input type="checkbox" checked={f.is_default} onChange={set('is_default')} /> Use this first</label>
    </Modal>
  )
}

export function AccountSettings() {
  const { profile, refresh } = useAuth()
  const [f, setF] = useState({ name: profile?.full_name || '', phone: profile?.phone || '' })
  const [run, busy] = useAction()
  return (
    <>
      <PageHead title="Your account" sub="Riders see your name and this phone number only while they are delivering to you." />
      <Card><div className="stack" style={{ maxWidth: 480 }}>
        <label className="field">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <label className="field">E-mail<input value={profile?.email || ''} disabled /></label>
        <div className="row"><button className="btn primary" disabled={busy} onClick={() => run(() => rpc('update_my_profile', { p_full_name: f.name, p_phone: f.phone }), 'Saved').then(refresh)}>Save</button><Link to="/account">Change password</Link></div>
      </div></Card>
    </>
  )
}
