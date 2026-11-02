import { useState, useEffect } from 'react'
import { supabase, rpc } from '../../lib/supabase'
import { useLoad, q, Card, Kpi, PageHead, Loading, Empty, StatusBadge, Seg, Modal, ReasonModal, useAction, Badge, FileLink } from '../../components/ui'
import { naira, windowLabel, minutesSince, VEHICLE, dateTime, timeOnly } from '../../lib/format'
import Icon from '../../components/icons'
import MapView from '../../components/Map'
import OrderPanel from '../shared/OrderPanel'
import { issueLabel } from '../admin/AdminPages'

// ------------------------------------------------------------ dispatch board: paid orders, suggested routes, assign a rider
export function Dispatch() {
  const { data, error, reload } = useLoad(async () => ({
    ov: await rpc('ops_overview'),
    queue: await q(supabase.from('orders').select('id, ref, zone, window_start, window_end, bags, vehicle_type, drop_lat, drop_lng, businesses(name, zone, pickup_lat, pickup_lng)').eq('status', 'ready_for_pickup').order('window_start')),
    suggestions: await rpc('suggest_routes'),
  }))
  const [sel, setSel] = useState([])
  const [assign, setAssign] = useState(null)
  const [open, setOpen] = useState(null)
  if (!data) return <Loading error={error} />
  const { ov, queue, suggestions } = data
  const toggle = (id) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const picked = queue.filter((o) => sel.includes(o.id))
  const rank = { bike: 1, car: 2, van: 3, truck: 4 }
  const need = (orders) => {
    const bags = orders.reduce((a, o) => a + o.bags, 0)
    const v = Math.max(...orders.map((o) => rank[o.vehicle_type]), bags > 12 ? 4 : bags > 6 ? 3 : bags > 3 ? 2 : 1)
    return { bags, vehicle: Object.keys(rank)[v - 1] }
  }
  return (
    <>
      <PageHead hero title="Dispatch desk" sub="Paid orders from every business, ready for a rider. Accept a suggested route, or tick orders and build your own." />
      <div className="kpis">
        <Kpi icon="box" label="Waiting for a rider" value={ov.to_dispatch} tone={ov.to_dispatch ? 'sun' : ''} />
        <Kpi icon="route" label="Routes on the road" value={ov.routes_active} note={`${ov.routes_offered} waiting for the rider to accept`} to="/trips" />
        <Kpi icon="clock" label="Running late" value={ov.late} note={`${ov.at_shops} rider${ov.at_shops === 1 ? '' : 's'} waiting at shops`} to="/trips" tone={ov.late ? 'alert' : ''} />
        <Kpi icon="alert" label="Needs you" value={ov.failed_open + ov.codes_locked + ov.claims_open} note={`${ov.failed_open} failed · ${ov.codes_locked} codes locked · ${ov.claims_open} claims`} to="/disputes" tone={ov.failed_open + ov.codes_locked + ov.claims_open ? 'alert' : ''} />
        <Kpi icon="bike" label="Riders available" value={`${ov.counts?.riders_available}/${ov.counts?.riders}`} note={ov.licences_expiring ? `${ov.licences_expiring} licence${ov.licences_expiring > 1 ? 's' : ''} expire within 30 days` : `${ov.delivered_today} delivered today`} to="/fleet" />
      </div>
      {suggestions.length > 0 && (
        <Card title="Suggested routes" pad={false}>
          <div className="list">{suggestions.map((g, i) => (
            <div className="list-row" key={i} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="ic"><Icon name={g.combined ? 'route' : 'box'} /></span>
              <div className="grow">
                <strong>{g.combined ? `${g.order_ids.length} orders together` : 'Single order'}</strong> · {g.businesses.join(', ')}
                <div className="muted small">Pickup {g.pickup_zone} → drop {g.drop_zone} · {windowLabel(g.window_start, g.window_end)} · {g.bags} bag{g.bags > 1 ? 's' : ''} · needs a {VEHICLE[g.vehicle].toLowerCase()} · {g.refs.join(', ')}</div>
              </div>
              <button className="btn sm" onClick={() => setSel(g.order_ids)}>Edit</button>
              <button className="btn sm primary" onClick={() => setAssign({ ids: g.order_ids, ...need(queue.filter((o) => g.order_ids.includes(o.id))), suggested: true })}>Assign rider</button>
            </div>))}</div>
        </Card>
      )}
      <div className="grid-main">
        <Card title="Queue" pad={false}>
          {queue.length === 0 ? <Empty>No paid orders waiting. They appear here when the super admin confirms a receipt.</Empty> : (
            <div className="table-wrap"><table><thead><tr><th /><th>Order</th><th>Business</th><th>Drop zone</th><th>Window</th><th>Bags</th></tr></thead>
              <tbody>{queue.map((o) => <tr key={o.id} onClick={() => setOpen(o.id)} style={{ cursor: 'pointer' }}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.includes(o.id)} onChange={() => toggle(o.id)} aria-label={`Select ${o.ref}`} /></td>
                <td className="mono"><strong>{o.ref}</strong></td><td>{o.businesses?.name}<div className="muted small">{o.businesses?.zone}</div></td><td>{o.zone}</td>
                <td className="nowrap small">{windowLabel(o.window_start, o.window_end)}{minutesSince(o.window_start) > 0 && <div><Badge tone="bad">window started</Badge></div>}</td>
                <td className="nowrap">{o.bags} · {VEHICLE[o.vehicle_type]}</td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Card title="Map">
          <MapView route={false} points={queue.flatMap((o) => [{ lat: o.businesses?.pickup_lat, lng: o.businesses?.pickup_lng, kind: 'pickup', label: o.businesses?.name }, { lat: o.drop_lat, lng: o.drop_lng, kind: 'drop', label: o.ref }])} />
          <p className="muted small" style={{ marginTop: 8 }}>Yellow: pickup shops · Indigo: drop-offs. Only orders with map pins are shown.</p>
        </Card>
      </div>
      {sel.length > 0 && (
        <div className="sel-bar">
          <span>{sel.length} order{sel.length > 1 ? 's' : ''} · {need(picked).bags} bags · needs a {VEHICLE[need(picked).vehicle].toLowerCase()}</span>
          <span className="spacer" />
          <button className="btn ghost" style={{ color: '#fff' }} onClick={() => setSel([])}>Clear</button>
          <button className="btn sun" onClick={() => setAssign({ ids: sel, ...need(picked), suggested: false })}>Assign rider</button>
        </div>
      )}
      {assign && <AssignModal {...assign} onClose={() => setAssign(null)} onDone={() => { setSel([]); reload() }} />}
      {open && <OrderPanel ops id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function AssignModal({ ids, bags, vehicle, suggested, onClose, onDone }) {
  const { data, error } = useLoad(() => rpc('available_riders', { p_vehicle: vehicle, p_bags: bags }), [vehicle, bags])
  const [rider, setRider] = useState(null)
  const [run, busy] = useAction()
  return (
    <Modal title={`Assign a rider · ${ids.length} order${ids.length > 1 ? 's' : ''}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button>
      <button className="btn primary" disabled={!rider || busy} onClick={() => run(() => rpc('create_route', { p_rider: rider, p_orders: ids, p_suggested: suggested, p_note: null }), 'Route sent to the rider').then((r) => { if (r) { onDone(); onClose() } })}>Send route</button></>}>
      <p className="muted">Only riders who are available, not paused, with papers in date and a vehicle that carries {bags} bags ({VEHICLE[vehicle].toLowerCase()} or bigger) are listed.</p>
      {!data ? <Loading error={error} /> : data.length === 0 ? <div className="notice warn">No rider fits right now. Split the orders, or wait for a rider to come back.</div> : (
        <div className="list" style={{ border: '1px solid var(--line)', borderRadius: 14 }}>{data.map((r) => (
          <label className="list-row" key={r.rider_id} style={{ cursor: 'pointer', background: rider === r.rider_id ? 'var(--indigo-50)' : undefined }}>
            <input type="radio" name="rider" checked={rider === r.rider_id} onChange={() => setRider(r.rider_id)} />
            <div className="grow"><strong>{r.full_name}</strong><div className="muted small">{VEHICLE[r.vehicle_type]} {r.plate} · carries {r.capacity_bags} · {r.zone || 'any zone'} · {r.trips_today} route{r.trips_today === 1 ? '' : 's'} today</div></div>
          </label>))}</div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------ live trips
export function LiveTrips() {
  const { data, error, reload } = useLoad(() => rpc('live_trips'))
  const [open, setOpen] = useState(null)
  const [change, setChange] = useState(null)
  const [delay, setDelay] = useState(null)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => { tick((x) => x + 1); reload() }, 30000); return () => clearInterval(t) }, [reload])
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageHead title="Live trips" sub="Every route on the road, with the rider's last position. Refreshes every 30 seconds." />
      <Card pad={false}><div style={{ padding: 12 }}><MapView tall route={false} points={data.filter((t) => t.location).map((t) => ({ ...t.location, kind: 'rider', label: `${t.rider} · ${t.plate}` }))} /></div></Card>
      {data.length === 0 ? <Card><Empty>No routes on the road.</Empty></Card> : (
        <div className="grid-2">{data.map((t) => (
          <section className="card" key={t.id}>
            <div className="card-head"><h2>{t.ref} · {t.rider}</h2><Badge tone={t.status === 'active' ? 'info' : 'warn'}>{t.status === 'active' ? 'On the road' : 'Waiting to accept'}</Badge></div>
            <div className="card-body stack">
              <div className="row between small"><span>{VEHICLE[t.vehicle]} {t.plate} · {t.phone}</span><span>{t.stops_done}/{t.stops_total} stops</span></div>
              <div className="meter"><i style={{ width: `${(t.stops_done / Math.max(1, t.stops_total)) * 100}%` }} /></div>
              {t.waiting_since && <div className="notice warn">Waiting at a shop for {minutesSince(t.waiting_since)} min{minutesSince(t.waiting_since) > 10 ? ' · waiting charge running' : ''}</div>}
              <div className="list">{(t.orders || []).map((o) => (
                <div className="list-row" key={o.id} style={{ padding: '8px 0' }} onClick={() => setOpen(o.id)}>
                  <div className="grow"><div className="row between"><span><strong className="mono">{o.ref}</strong> · {o.business} → {o.zone}</span><StatusBadge status={o.status} /></div>
                    <div className="muted small">Window ends {timeOnly(o.window_end)}{o.eta && ` · estimate ${timeOnly(o.eta)}`}{o.code_locked && ' · '}{o.code_locked && <b style={{ color: 'var(--bad)' }}>delivery code locked</b>}</div></div>
                  {o.status === 'out_for_delivery' && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); setDelay(o) }}>Delay</button>}
                </div>))}</div>
              {t.status === 'active' && (t.orders || []).some((o) => o.status === 'out_for_delivery') && <button className="btn" onClick={() => setChange(t)}><Icon name="swap" size={16} /> Change rider</button>}
            </div>
          </section>))}</div>
      )}
      {open && <OrderPanel ops id={open} onClose={() => setOpen(null)} />}
      {change && <ChangeRider trip={change} onClose={() => setChange(null)} onDone={reload} />}
      {delay && <DelayModal order={delay} onClose={() => setDelay(null)} onDone={reload} />}
    </>
  )
}

function ChangeRider({ trip, onClose, onDone }) {
  const { data, error } = useLoad(() => rpc('available_riders', { p_vehicle: trip.vehicle, p_bags: 1 }))
  const [rider, setRider] = useState('')
  const [reason, setReason] = useState('')
  const [run, busy] = useAction()
  return (
    <Modal title={`Change rider on ${trip.ref}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button>
      <button className="btn primary" disabled={!rider || reason.length < 3 || busy} onClick={() => run(() => rpc('change_rider', { p_route: trip.id, p_new_rider: rider, p_reason: reason }), 'New rider sent. The handover code is on the first rider\'s screen.').then((r) => { if (r) { onDone(); onClose() } })}>Change rider</button></>}>
      <p className="muted">The new rider goes to {trip.rider}'s position, collects the bags, photographs them and types the handover code shown on {trip.rider}'s screen. The customer and business are told; the delivery code stays the same.</p>
      <label className="field">Reason<select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Choose…</option><option>Vehicle breakdown</option><option>Accident</option><option>Rider unwell</option><option>Route rebalancing</option></select></label>
      {!data ? <Loading error={error} /> : <label className="field">New rider<select value={rider} onChange={(e) => setRider(e.target.value)}><option value="">Choose…</option>{data.map((r) => <option key={r.rider_id} value={r.rider_id}>{r.full_name} · {VEHICLE[r.vehicle_type]} {r.plate}</option>)}</select></label>}
    </Modal>
  )
}

function DelayModal({ order, onClose, onDone }) {
  const [mins, setMins] = useState(30)
  const [reason, setReason] = useState('Heavy traffic')
  const [run, busy] = useAction()
  const eta = new Date(Date.now() + mins * 60000)
  return (
    <Modal title={`New estimate for ${order.ref}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button>
      <button className="btn primary" disabled={busy} onClick={() => run(() => rpc('report_delay', { p_order: order.id, p_eta: eta.toISOString(), p_reason: reason }), 'Estimate updated').then(() => { onDone(); onClose() })}>Save estimate</button></>}>
      <label className="field">Arrives in (minutes)<input type="number" min="5" value={mins} onChange={(e) => setMins(Number(e.target.value))} /></label>
      <label className="field">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Heavy traffic on the Lekki–Epe Expressway" /></label>
      <p className="muted small">Estimate {timeOnly(eta)}; window ends {timeOnly(order.window_end)}. {eta > new Date(order.window_end) ? 'The customer and business will be told it is late, with your reason.' : 'Still inside the window.'}</p>
    </Modal>
  )
}

// ------------------------------------------------------------ disputes: failed pickups and deliveries, locked codes, claims, complaints
export function Disputes() {
  const [tab, setTab] = useState('failed')
  const { data, error, reload } = useLoad(async () => {
    const [failed, onroad, claims, issues] = await Promise.all([
      q(supabase.from('orders').select('id, ref, status, zone, customer_name, drop_phone, businesses(name, phone)').in('status', ['failed_pickup', 'failed_delivery'])),
      q(supabase.from('orders').select('id, ref, zone, customer_name, drop_phone, businesses(name)').eq('status', 'out_for_delivery')),
      q(supabase.from('claims').select('*, businesses(name), orders(ref)').order('created_at', { ascending: false })),
      q(supabase.from('issues').select('*, businesses(name), orders(ref)').order('created_at', { ascending: false }).limit(150)),
    ])
    const locked = (await Promise.all(onroad.map(async (o) => ({ ...o, t: await rpc('order_tracking', { p_order: o.id }) })))).filter((o) => o.t?.code_locked)
    return { failed, locked, claims, issues }
  })
  const [resolve, setResolve] = useState(null)
  const [override, setOverride] = useState(null)
  const [claim, setClaim] = useState(null)
  const [fix, setFix] = useState(null)
  const [open, setOpen] = useState(null)
  if (!data) return <Loading error={error} />
  const openClaims = data.claims.filter((c) => c.status === 'open')
  const openIssues = data.issues.filter((i) => i.status === 'open')
  return (
    <>
      <PageHead title="Disputes and claims" sub="Everything that needs a decision. Each decision is recorded with your name and reason." />
      <Seg value={tab} onChange={setTab} options={[{ value: 'failed', label: 'Failed', count: data.failed.length }, { value: 'locked', label: 'Locked codes', count: data.locked.length }, { value: 'claims', label: 'Claims', count: openClaims.length }, { value: 'issues', label: 'All issues', count: openIssues.length }]} />
      {tab === 'failed' && <Card pad={false}>{data.failed.length === 0 ? <Empty>No failed pickups or deliveries.</Empty> : <div className="list">{data.failed.map((o) => (
        <div className="list-row" key={o.id} style={{ alignItems: 'center', flexWrap: 'wrap' }}><span className="ic bad"><Icon name="alert" size={16} /></span>
          <div className="grow" onClick={() => setOpen(o.id)} style={{ cursor: 'pointer' }}><strong className="mono">{o.ref}</strong> · <StatusBadge status={o.status} /><div className="muted small">{o.businesses?.name} ({o.businesses?.phone}) → {o.customer_name || 'customer'} {o.drop_phone} · {o.zone}</div></div>
          {o.status === 'failed_pickup' ? <><button className="btn sm" onClick={() => setResolve({ o, fn: 'resolve_failed_pickup', cause: 'business', title: 'Business caused it: fee kept, back to Packed' })}>Business caused</button>
            <button className="btn sm primary" onClick={() => setResolve({ o, fn: 'resolve_failed_pickup', cause: 'rider', title: 'Ọ̀nà caused it: reassign free' })}>Ọ̀nà caused</button></>
            : <><button className="btn sm" onClick={() => setResolve({ o, fn: 'resolve_failed_delivery', cause: 'customer', title: 'Customer caused it: return to the business' })}>Customer caused</button>
              <button className="btn sm primary" onClick={() => setResolve({ o, fn: 'resolve_failed_delivery', cause: 'ona', title: 'Ọ̀nà caused it: free re-delivery' })}>Ọ̀nà caused</button></>}
        </div>))}</div>}</Card>}
      {tab === 'locked' && <Card pad={false}>{data.locked.length === 0 ? <Empty>No locked delivery codes.</Empty> : <div className="list">{data.locked.map((o) => (
        <div className="list-row" key={o.id} style={{ alignItems: 'center' }}><span className="ic bad"><Icon name="key" size={16} /></span>
          <div className="grow"><strong className="mono">{o.ref}</strong> · {o.businesses?.name}<div className="muted small">Call {o.customer_name || 'the customer'} on {o.drop_phone || 'their number'}, confirm their name and the items, then record the delivery.</div></div>
          <button className="btn sm primary" onClick={() => setOverride(o)}>Record delivery</button></div>))}</div>}</Card>}
      {tab === 'claims' && <Card pad={false}>{data.claims.length === 0 ? <Empty>No claims.</Empty> : <div className="table-wrap"><table><thead><tr><th>Order</th><th>Business</th><th>Kind</th><th>Claimed</th><th>Statement</th><th>Status</th><th /></tr></thead>
        <tbody>{data.claims.map((c) => <tr key={c.id}><td className="mono" onClick={() => setOpen(c.order_id)} style={{ cursor: 'pointer' }}>{c.orders?.ref}</td><td>{c.businesses?.name}</td><td>{c.kind}</td><td className="mono">{naira(c.claimed_value)}</td><td className="small">{c.statement}</td>
          <td><Badge tone={c.status === 'open' ? 'warn' : c.status === 'rejected' ? 'muted' : 'good'}>{c.status}</Badge>{c.cause && <div className="muted small">{c.cause}</div>}</td>
          <td>{c.status === 'open' && <button className="btn sm primary" onClick={() => setClaim(c)}>Decide</button>}</td></tr>)}</tbody></table></div>}</Card>}
      {tab === 'issues' && <Card pad={false}>{data.issues.length === 0 ? <Empty>No issues.</Empty> : <div className="list">{data.issues.map((i) => (
        <div className="list-row" key={i.id}><span className={`ic ${i.status === 'open' ? 'bad' : 'good'}`}><Icon name={i.status === 'open' ? 'alert' : 'check'} size={16} /></span>
          <div className="grow"><div className="row between"><strong>{issueLabel(i.kind)}{i.orders?.ref && <> · <span className="mono">{i.orders.ref}</span></>}</strong><span className="muted small">{dateTime(i.created_at)}</span></div>
            <div className="small">{i.businesses?.name}{i.businesses?.name && ' · '}{i.detail}</div>{i.resolution && <div className="muted small">Resolved: {i.resolution}</div>}</div>
          {i.status === 'open' && <button className="btn sm" onClick={() => setFix(i)}>Resolve</button>}</div>))}</div>}</Card>}

      {resolve && <ReasonModal title={resolve.title} label="Note for the record" confirm="Settle" minLength={3} onClose={() => setResolve(null)}
        onSubmit={(n) => rpc(resolve.fn, { p_order: resolve.o.id, p_cause: resolve.cause, p_note: n }).then(reload)} />}
      {override && <ReasonModal title={`Record delivery of ${override.ref}`} label="How you verified the customer" confirm="Record delivery" minLength={10} placeholder="Called Kemi on 0803…, confirmed her name and the two items"
        onClose={() => setOverride(null)} onSubmit={(r) => rpc('override_delivery', { p_order: override.id, p_reason: r }).then(reload)}>
        <div className="notice warn">This is logged in the audit trail and shown to the super admin and the business.</div></ReasonModal>}
      {claim && <ClaimDecision c={claim} onClose={() => setClaim(null)} onDone={reload} />}
      {fix && <ReasonModal title={`Resolve: ${issueLabel(fix.kind)}`} label="How it was resolved" confirm="Resolve" minLength={3} onClose={() => setFix(null)} onSubmit={(r) => rpc('resolve_issue', { p_issue: fix.id, p_resolution: r }).then(reload)} />}
      {open && <OrderPanel ops id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

function ClaimDecision({ c, onClose, onDone }) {
  const { data } = useLoad(() => rpc('order_tracking', { p_order: c.order_id }), [c.order_id])
  const [cause, setCause] = useState('rider')
  const [approve, setApprove] = useState(true)
  const [text, setText] = useState('')
  const [run, busy] = useAction()
  return (
    <Modal wide title={`Claim on ${c.orders?.ref}: ${c.kind}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button>
      <button className="btn primary" disabled={busy || text.length < 10} onClick={() => run(() => rpc('decide_claim', { p_claim: c.id, p_cause: cause, p_approve: cause === 'store' ? false : approve, p_decision: text }), 'Decision recorded').then(() => { onDone(); onClose() })}>Record decision</button></>}>
      <div className="grid-2">
        <div className="stack">
          <dl className="dl"><dt>Business</dt><dd>{c.businesses?.name}</dd><dt>Claimed</dt><dd className="mono">{naira(c.claimed_value)}</dd><dt>Statement</dt><dd>{c.statement}</dd></dl>
          <div className="row"><span>Pickup photo:</span><FileLink bucket="photos" path={data?.pickup_photo}>Open</FileLink><span>Door photo:</span><FileLink bucket="photos" path={data?.drop_photo}>Open</FileLink></div>
          <p className="muted small">Intact at pickup and damaged at the door means the rider caused it. Damaged, wrong or badly packed in the pickup photo means the store did.</p>
        </div>
        <div className="stack">
          <label className="field">Cause<select value={cause} onChange={(e) => setCause(e.target.value)}><option value="rider">Rider (Ọ̀nà refunds the goods value)</option><option value="store">Store (business's responsibility)</option><option value="unclear">Unclear (your decision)</option></select></label>
          {cause !== 'store' && <label className="row"><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> Approve refund of {naira(c.claimed_value)}</label>}
          <label className="field">Decision<textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="What the photos and timeline show, and why" /></label>
        </div>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------ rider performance and pay (Operations and super admin only)
export function RiderPay() {
  const { data, error, reload } = useLoad(async () => ({ stats: await rpc('rider_stats'), pays: await q(supabase.from('rider_payouts').select('*').order('created_at', { ascending: false }).limit(100)) }))
  const [pay, setPay] = useState(null)
  if (!data) return <Loading error={error} />
  const name = (id) => data.stats.find((r) => r.rider_id === id)?.name || '—'
  return (
    <>
      <PageHead title="Rider performance and pay" sub="Deliveries, failures and claims per rider, and what Ọ̀nà owes them. Riders do not see pay in their app." />
      <Card pad={false}>
        {data.stats.length === 0 ? <Empty>No riders yet.</Empty> : <div className="table-wrap"><table><thead><tr><th>Rider</th><th>Vehicle</th><th>Status</th><th>Routes</th><th>Delivered</th><th>Failed</th><th>Claims</th><th>Owed</th><th>Paid</th><th /></tr></thead>
          <tbody>{data.stats.map((r) => <tr key={r.rider_id}><td><strong>{r.name}</strong><div className="muted small">{r.phone} · {r.zone || '—'}</div></td><td>{r.vehicle ? `${VEHICLE[r.vehicle]} ${r.plate}` : '—'}</td>
            <td><Badge tone={r.availability === 'available' ? 'good' : r.availability === 'paused' ? 'bad' : 'muted'}>{r.availability.replace('_', ' ')}</Badge></td>
            <td className="mono">{r.routes_done}</td><td className="mono">{r.delivered}</td><td className="mono">{r.failed}</td><td className="mono">{r.rider_claims}</td>
            <td className="mono">{naira(r.pay_owed)}</td><td className="mono">{naira(r.pay_paid)}</td><td><button className="btn sm" onClick={() => setPay(r)}>Record pay</button></td></tr>)}</tbody></table></div>}
      </Card>
      <Card title="Pay records" pad={false}>
        {data.pays.length === 0 ? <Empty>No pay recorded yet.</Empty> : <div className="table-wrap"><table><thead><tr><th>Rider</th><th>Period</th><th>Trips</th><th>Amount</th><th>Reference</th><th>Status</th></tr></thead>
          <tbody>{data.pays.map((p) => <tr key={p.id}><td>{name(p.rider_id)}</td><td>{p.period}</td><td className="mono">{p.trips}</td><td className="mono">{naira(p.amount)}</td><td className="mono small">{p.reference || '—'}</td><td><Badge tone={p.status === 'paid' ? 'good' : 'warn'}>{p.status}</Badge></td></tr>)}</tbody></table></div>}
      </Card>
      {pay && <PayModal r={pay} onClose={() => setPay(null)} onDone={reload} />}
    </>
  )
}

function PayModal({ r, onClose, onDone }) {
  const [f, setF] = useState({ period: new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), amount: '', reference: '', paid: true })
  const [run, busy] = useAction()
  return (
    <Modal title={`Pay ${r.name}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Back</button>
      <button className="btn primary" disabled={busy || !f.amount} onClick={() => run(() => rpc('record_payout', { p_rider: r.rider_id, p_period: f.period, p_amount: Number(f.amount), p_reference: f.reference || null, p_paid: f.paid }), 'Recorded').then(() => { onDone(); onClose() })}>Save</button></>}>
      <label className="field">Period<input value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></label>
      <label className="field">Amount (₦)<input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
      <label className="field">Transfer reference<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
      <label className="row"><input type="checkbox" checked={f.paid} onChange={(e) => setF({ ...f, paid: e.target.checked })} /> Already paid</label>
    </Modal>
  )
}
