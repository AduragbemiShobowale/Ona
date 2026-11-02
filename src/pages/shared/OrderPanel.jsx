import { useState } from 'react'
import { supabase, rpc } from '../../lib/supabase'
import { useLoad, q, Modal, Loading, StatusBadge, Timeline, ReasonModal, FileLink, useAction, Badge } from '../../components/ui'
import { naira, windowLabel, VEHICLE, dateTime, minutesSince } from '../../lib/format'
import MapView from '../../components/Map'
import Icon from '../../components/icons'

// One order, as the business sees it (or Operations, without goods or money).
export default function OrderPanel({ id, onClose, ops }) {
  const { data, loading, error, reload } = useLoad(async () => {
    const order = await q(supabase.from('orders').select(ops ? '*, businesses(name, phone)' : '*, order_items(*), order_charges(fee, waiting_charge)').eq('id', id).single())
    const events = await q(supabase.from('order_events').select('*').eq('order_id', id).order('at'))
    const track = await rpc('order_tracking', { p_order: id })
    return { order, events, track }
  }, [id])
  const [modal, setModal] = useState(null)
  const [run, busy] = useAction()
  const o = data?.order
  const t = data?.track
  const charges = Array.isArray(o?.order_charges) ? o.order_charges[0] : o?.order_charges
  const goods = (o?.order_items || []).reduce((s, i) => s + i.qty * i.unit_price, 0)

  const act = (to, reason) => run(() => rpc('owner_set_status', { p_order: id, p_to: to, p_reason: reason || null }), 'Updated').then(reload)

  return (
    <Modal wide title={o ? `Order ${o.ref}` : 'Order'} onClose={onClose} footer={o && !ops && (
      <>
        {o.status === 'received' && <><button className="btn" disabled={busy} onClick={() => act('waiting_restock', 'Waiting for restock')}>Waiting for restock</button>
          <button className="btn primary" disabled={busy} onClick={() => act('packed')}><Icon name="box" size={16} /> Mark packed</button></>}
        {o.status === 'waiting_restock' && <button className="btn primary" disabled={busy} onClick={() => act('received', 'Restocked')}>Back in stock</button>}
        {o.status === 'packed' && <button className="btn" disabled={busy} onClick={() => act('received', 'Unpacked')}>Unpack</button>}
        {['awaiting_address', 'received', 'waiting_restock', 'packed'].includes(o.status) && <button className="btn" onClick={() => setModal('address')}>{o.drop_address ? 'Change address' : 'Add address'}</button>}
        {['awaiting_address', 'received', 'waiting_restock', 'packed', 'awaiting_payment', 'payment_rejected', 'ready_for_pickup'].includes(o.status) &&
          <button className="btn danger" onClick={() => setModal('cancel')}>Cancel order</button>}
        {['delivered', 'returned'].includes(o.status) && <button className="btn" onClick={() => setModal('claim')}>Open a claim</button>}
      </>
    )}>
      {loading && !data ? <Loading error={error} /> : (
        <div className="grid-main">
          <div className="stack-lg">
            <div className="row between">
              <StatusBadge status={o.status} />
              <span className="muted small">Created {dateTime(o.created_at)}</span>
            </div>
            {t?.pickup_code && (
              <div className="code-big"><small>Pickup code · read it to the rider</small>{t.pickup_code}</div>
            )}
            {t?.rider && (
              <div className="list-row" style={{ border: '1px solid var(--line)', borderRadius: 14 }}>
                <span className="ic good"><Icon name={t.rider.vehicle === 'bike' ? 'bike' : 'truck'} /></span>
                <div className="grow"><strong>{t.rider.name}</strong><div className="muted small">{VEHICLE[t.rider.vehicle]} · {t.rider.plate}{t.rider.phone ? ` · ${t.rider.phone}` : ''}</div></div>
                {t.pickup_stop?.arrived_at && o.status === 'rider_at_shop' && <Badge tone="warn">At your door {minutesSince(t.pickup_stop.arrived_at)} min</Badge>}
              </div>
            )}
            {(t?.location || (t?.pickup?.lat && o.drop_lat)) && (
              <MapView points={[{ ...t.pickup, kind: 'pickup', label: t.pickup?.name }, { lat: o.drop_lat, lng: o.drop_lng, kind: 'drop', label: 'Drop-off' }, t.location && { ...t.location, kind: 'rider', label: 'Rider' }]} />
            )}
            {!ops && (
              <section className="card">
                <div className="card-head"><h2>Items</h2><span className="muted small">{o.bags} bag{o.bags > 1 ? 's' : ''}</span></div>
                <div className="table-wrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Price</th></tr></thead>
                  <tbody>{o.order_items.map((i) => <tr key={i.id}><td>{i.name}</td><td>{i.qty}</td><td className="mono">{naira(i.qty * i.unit_price)}</td></tr>)}</tbody>
                  <tfoot><tr><td colSpan={2}><strong>Goods value</strong> <span className="muted small">(you collect this from the customer yourself)</span></td><td className="mono"><strong>{naira(goods)}</strong></td></tr></tfoot>
                </table></div>
              </section>
            )}
            <section className="card"><div className="card-head"><h2>History</h2></div><div className="card-body"><Timeline events={data.events} /></div></section>
          </div>
          <div className="stack">
            <section className="card"><div className="card-body">
              <dl className="dl">
                {ops && <><dt>Business</dt><dd>{o.businesses?.name}</dd></>}
                <dt>Customer</dt><dd>{o.customer_name || '—'}<div className="muted small">{o.customer_email}</div></dd>
                <dt>Address</dt><dd>{o.drop_address || <span className="warn-text">Waiting for the customer to choose</span>}{o.drop_landmark && <div className="muted small">{o.drop_landmark}</div>}</dd>
                <dt>Phone</dt><dd>{o.drop_phone || '—'}</dd>
                <dt>Zone</dt><dd>{o.zone}</dd>
                <dt>Window</dt><dd>{windowLabel(o.window_start, o.window_end)}</dd>
                {o.eta && <><dt>Estimate</dt><dd>{dateTime(o.eta)} {o.late_reason && <Badge tone="warn">{o.late_reason}</Badge>}</dd></>}
                <dt>Vehicle</dt><dd>{VEHICLE[o.vehicle_type]} · {o.distance_km ?? 0} km</dd>
                {!ops && <><dt>Delivery fee</dt><dd className="mono">{naira(charges?.fee)}{Number(charges?.waiting_charge) > 0 && <div className="muted small">+ {naira(charges.waiting_charge)} waiting</div>}</dd></>}
              </dl>
            </div></section>
            {(t?.pickup_photo || t?.drop_photo) && (
              <section className="card"><div className="card-head"><h2>Condition photos</h2></div><div className="card-body stack">
                <span>Pickup: <FileLink bucket="photos" path={t.pickup_photo}>Open photo</FileLink></span>
                <span>Door: <FileLink bucket="photos" path={t.drop_photo}>Open photo</FileLink></span>
              </div></section>
            )}
            {t?.feedback && <div className="notice good"><strong>{'★'.repeat(t.feedback.rating)}{'☆'.repeat(5 - t.feedback.rating)}</strong>{t.feedback.comment}</div>}
          </div>
        </div>
      )}
      {modal === 'cancel' && <ReasonModal title={`Cancel ${o.ref}?`} danger confirm="Cancel order" minLength={3} placeholder="e.g. Customer changed their mind"
        onClose={() => setModal(null)} onSubmit={(r) => rpc('owner_set_status', { p_order: id, p_to: 'cancelled', p_reason: r }).then(reload)}>
        <p className="muted">Reserved stock goes back on the shelf. If the fee was already confirmed, it becomes credit on your next payment.</p>
      </ReasonModal>}
      {modal === 'address' && <AddressModal order={o} onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'claim' && <ClaimModal order={o} goods={goods} onClose={() => setModal(null)} onDone={reload} />}
    </Modal>
  )
}

function AddressModal({ order, onClose, onDone }) {
  const [f, setF] = useState({ address: order.drop_address || '', landmark: order.drop_landmark || '', phone: order.drop_phone || '', zone: order.zone || '' })
  const [run, busy] = useAction()
  return (
    <Modal title="Delivery address" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button>
      <button className="btn primary" disabled={busy} onClick={() => run(() => rpc('set_order_address', { p_order: order.id, p_address: f }), 'Address saved').then(() => { onDone(); onClose() })}>Save</button></>}>
      <label className="field">Address<input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
      <label className="field">Landmark<input value={f.landmark} onChange={(e) => setF({ ...f, landmark: e.target.value })} /></label>
      <label className="field">Phone at the door<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
    </Modal>
  )
}

function ClaimModal({ order, goods, onClose, onDone }) {
  const [f, setF] = useState({ kind: 'damage', value: goods || '', statement: '' })
  const [run, busy] = useAction()
  return (
    <Modal title={`Claim on ${order.ref}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button>
      <button className="btn primary" disabled={busy} onClick={() => run(() => rpc('open_claim', { p_order: order.id, p_kind: f.kind, p_value: Number(f.value), p_statement: f.statement, p_proof: null }), 'Claim sent to Operations').then((r) => { if (r) { onDone(); onClose() } })}>Send claim</button></>}>
      <div className="notice info">Ọ̀nà refunds the goods value when the rider caused the loss or damage, up to ₦100,000 per order. Claims must be made within 48 hours of delivery, or 24 hours for missing items. Operations decides from the pickup and door photos.</div>
      <label className="field">What happened<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="damage">Damaged</option><option value="missing">Item missing</option><option value="loss">Parcel lost</option></select></label>
      <label className="field">Goods value claimed (₦)<input type="number" min="1" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></label>
      <label className="field">Describe it<textarea value={f.statement} onChange={(e) => setF({ ...f, statement: e.target.value })} placeholder="What was wrong, and when the customer told you" /></label>
    </Modal>
  )
}
