import { useState, useEffect } from 'react'
import { rpc } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useLoad, Card, PageHead, Loading, Empty, ReasonModal, useAction, PhotoInput } from '../../components/ui'
import { windowLabel, minutesSince, VEHICLE, dateTime, timeOnly } from '../../lib/format'
import Icon from '../../components/icons'
import MapView from '../../components/Map'

const here = () => new Promise((res) => {
  if (!navigator.geolocation) return res({})
  navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude }), () => res({}), { enableHighAccuracy: true, timeout: 8000 })
})

// Sends the rider's position about every 30 seconds, only while a route is open.
function useTripLocation(active) {
  useEffect(() => {
    if (!active || !navigator.geolocation) return
    let last = 0
    const id = navigator.geolocation.watchPosition((p) => {
      if (Date.now() - last < 30000) return
      last = Date.now()
      rpc('ping_location', { p_lat: p.coords.latitude, p_lng: p.coords.longitude }).catch(() => {})
    }, () => {}, { enableHighAccuracy: true, maximumAge: 15000 })
    return () => navigator.geolocation.clearWatch(id)
  }, [active])
}

// The rider's whole app: no prices, no earnings, no pickup or delivery code on screen.
export default function RiderApp() {
  const { account, refresh } = useAuth()
  const rider = account?.rider
  const { data, error, loading, reload } = useLoad(() => rpc('rider_route'))
  const [run, busy] = useAction()
  const [decline, setDecline] = useState(false)
  const [problem, setProblem] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t) }, [])
  useTripLocation(data?.route?.status === 'active')
  if (error) return <Loading error={error} />
  if (loading) return <Loading />

  const route = data?.route
  const stops = data?.stops || []
  const current = stops.find((s) => !s.done_at)
  const avail = rider?.availability

  if (data?.handover_out && route?.status !== 'active') return <HandoverOut h={data.handover_out} />
  if (!route) return (
    <>
      <PageHead hero title={`Hello${account?.profile?.full_name ? ', ' + account.profile.full_name.split(' ')[0] : ''}`} sub={rider?.vehicle ? `${VEHICLE[rider.vehicle.type]} ${rider.vehicle.plate} · carries ${rider.vehicle.capacity_bags} bags` : 'No vehicle attached yet. Ask Operations.'} />
      <Card>
        <div className="stack" style={{ textAlign: 'center', justifyItems: 'center' }}>
          <span className="code-big" style={{ fontSize: 16, letterSpacing: '.08em' }}>{avail === 'available' ? 'You are available' : avail === 'paused' ? 'Paused by Operations' : 'You are off'}</span>
          <p className="muted">{avail === 'available' ? 'Operations will send you a route. Keep the app open.' : avail === 'paused' ? 'Call Operations to be switched back on.' : 'Switch on when you are ready to work.'}</p>
          {avail !== 'paused' && avail !== 'on_trip' && <button className="btn lg sun" disabled={busy} onClick={() => run(() => rpc('set_my_availability', { p_available: avail !== 'available' })).then(refresh)}>{avail === 'available' ? 'Go off for today' : 'Start working'}</button>}
        </div>
      </Card>
      <History />
    </>
  )

  if (route.status === 'offered') return (
    <>
      <PageHead hero title={`New route ${route.ref}`} sub={`${stops.length} stops · accept the whole route or decline it`} />
      <MapView points={stops.map((s) => s.kind === 'pickup' ? { lat: s.business?.lat, lng: s.business?.lng, kind: 'pickup', label: s.business?.name } : { lat: s.order?.lat, lng: s.order?.lng, kind: 'drop', label: s.order?.ref })} />
      <Card pad={false}><StopList stops={stops} /></Card>
      <div className="row"><button className="btn lg sun" style={{ flex: 1 }} disabled={busy} onClick={() => run(() => rpc('respond_route', { p_route: route.id, p_accept: true, p_reason: null }), 'Route accepted').then(reload)}>Accept route</button>
        <button className="btn lg" onClick={() => setDecline(true)}>Decline</button></div>
      {decline && <ReasonModal title="Decline this route?" options={['Vehicle problem', 'Too far from me', 'Not enough fuel', 'Unwell']} confirm="Decline" danger onClose={() => setDecline(false)}
        onSubmit={(r) => rpc('respond_route', { p_route: route.id, p_accept: false, p_reason: r }).then(() => { reload(); refresh() })} />}
    </>
  )

  return (
    <>
      <div className="row between">
        <div><h1 style={{ fontSize: 22 }}>{route.ref}</h1><span className="muted small">{stops.filter((s) => s.done_at).length} of {stops.length} stops done</span></div>
        <button className="btn sm" onClick={() => setProblem(true)}><Icon name="alert" size={15} /> Problem</button>
      </div>
      {data.handover_out && <HandoverOut h={data.handover_out} inline />}
      {current ? <StopCard key={current.id} s={current} route={route} onDone={() => { reload(); refresh() }} /> : <Card><Empty>All stops done. Well done.</Empty></Card>}
      <Card title="Route" pad={false}><StopList stops={stops} current={current?.id} /></Card>
      {problem && <ReasonModal title="Tell Operations" label="What's wrong" minLength={5} confirm="Send" placeholder="Flat tyre at Lekki toll gate" onClose={() => setProblem(false)} onSubmit={(t) => rpc('report_problem', { p_detail: t })} />}
    </>
  )
}

function StopList({ stops, current }) {
  return (
    <div className="list">{stops.map((s) => (
      <div className="list-row" key={s.id} style={{ background: s.id === current ? 'var(--sun-soft)' : undefined }}>
        <span className={`ic ${s.done_at ? (s.failed_reason ? 'bad' : 'good') : ''}`}><Icon name={s.done_at ? (s.failed_reason ? 'x' : 'check') : s.kind === 'pickup' ? 'store' : s.kind === 'handover' ? 'swap' : 'pin'} size={16} /></span>
        <div className="grow">
          {s.kind === 'pickup' && <><strong>Pick up · {s.business?.name}</strong><div className="muted small">{s.business?.address} · {s.business?.bags ?? '—'} bags</div></>}
          {s.kind === 'drop' && <><strong>Deliver · {s.order?.customer || 'Customer'}</strong><div className="muted small">{s.order?.ref} · {s.order?.zone} · by {timeOnly(s.order?.window_end)}</div></>}
          {s.kind === 'handover' && <><strong>Collect bags from {s.handover?.from}</strong><div className="muted small">Handover</div></>}
          {s.failed_reason && <div className="small" style={{ color: 'var(--bad)' }}>{s.failed_reason}</div>}
        </div>
      </div>))}</div>
  )
}

function StopCard({ s, route, onDone }) {
  const { profile } = useAuth()
  const [photo, setPhoto] = useState(null)
  const [code, setCode] = useState('')
  const [bags, setBags] = useState('')
  const [msg, setMsg] = useState(null)
  const [fail, setFail] = useState(false)
  const [run, busy] = useAction()
  const arrive = async () => { const pos = await here(); run(() => rpc('arrive_stop', { p_stop: s.id, p_lat: pos.lat ?? null, p_lng: pos.lng ?? null }), 'Checked in').then(onDone) }
  const submit = async () => {
    setMsg(null)
    const fn = s.kind === 'pickup' ? rpc('confirm_pickup', { p_stop: s.id, p_code: code, p_bags: Number(bags), p_photo: photo })
      : s.kind === 'handover' ? rpc('accept_handover', { p_stop: s.id, p_code: code, p_photo: photo })
        : rpc('deliver_order', { p_order: s.order.id, p_code: code, p_photo: photo })
    const r = await run(() => fn)
    if (r?.ok) { onDone() } else if (r) { setMsg(r.message); setCode('') }
  }
  const waited = minutesSince(s.arrived_at)
  const place = s.kind === 'pickup' ? s.business : s.order
  const label = s.kind === 'pickup' ? 'pickup code (the shop reads it to you)' : s.kind === 'handover' ? 'handover code (on the other rider\'s screen)' : 'delivery code (the customer reads it to you)'
  return (
    <section className="waybill" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
      <div className="waybill-head"><span>{s.kind === 'pickup' ? 'Pickup' : s.kind === 'handover' ? 'Handover' : 'Delivery'} · <b>stop {s.seq}</b></span><span>{s.kind === 'drop' ? `by ${timeOnly(s.order?.window_end)}` : route.ref}</span></div>
      <div className="waybill-body">
        <div>
          <h2 style={{ fontSize: 20 }}>{s.kind === 'pickup' ? s.business?.name : s.kind === 'handover' ? `Meet ${s.handover?.from}` : s.order?.customer || 'Customer'}</h2>
          {place?.address && <p>{place.address}{place.landmark && <span className="muted"> · {place.landmark}</span>}</p>}
          {s.kind === 'drop' && <p className="muted small">{s.order?.ref} · {s.order?.bags} bag{s.order?.bags > 1 ? 's' : ''} · {windowLabel(s.order?.window_start, s.order?.window_end)}</p>}
          {s.kind === 'pickup' && <p className="muted small">Collect {s.business?.bags} bag{s.business?.bags > 1 ? 's' : ''} · {(s.business?.orders || []).join(', ')}</p>}
        </div>
        <div className="row">
          {place?.phone && <a className="btn" href={`tel:${place.phone}`}><Icon name="phone" size={16} /> Call</a>}
          {place?.lat && <a className="btn" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/directions?to=${place.lat},${place.lng}`}><Icon name="map" size={16} /> Directions</a>}
        </div>
        {s.kind !== 'handover' && !s.arrived_at ? (
          <button className="btn lg sun block" disabled={busy} onClick={arrive}><Icon name="pin" /> I've arrived</button>
        ) : (
          <div className="stack">
            {s.kind === 'pickup' && <div className={`notice ${waited > 10 ? 'warn' : 'info'}`}>Waiting {waited} min. {waited <= 10 ? `${10 - waited} free minutes left.` : 'The waiting charge is running for the shop.'}{s.extra_time && ' The shop asked for 10 more minutes.'}</div>}
            <PhotoInput label={s.kind === 'drop' ? 'Photo of the handover' : 'Photo of the bags'} owner={profile?.id} folder={route.ref} value={photo} onChange={setPhoto} />
            {s.kind === 'pickup' && <label className="field">Bags counted<input type="number" inputMode="numeric" min="1" value={bags} onChange={(e) => setBags(e.target.value)} /></label>}
            <label className="field">Type the {label}<input inputMode="numeric" autoComplete="off" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ fontFamily: 'var(--mono)', fontSize: 24, letterSpacing: '.3em', height: 56, textAlign: 'center' }} /></label>
            {msg && <div className="notice bad">{msg}</div>}
            <button className="btn lg primary block" disabled={busy || !photo || code.length !== 6 || (s.kind === 'pickup' && !bags)} onClick={submit}>{s.kind === 'pickup' ? 'Confirm pickup' : s.kind === 'handover' ? 'Confirm handover' : 'Confirm delivery'}</button>
            {s.kind !== 'handover' && <button className="btn ghost" onClick={() => setFail(true)}>{s.kind === 'pickup' ? 'Pickup failed' : 'Could not deliver'}</button>}
          </div>
        )}
      </div>
      {fail && <ReasonModal title={s.kind === 'pickup' ? 'Pickup failed' : 'Could not deliver'} confirm="Record" danger
        options={s.kind === 'pickup' ? ['Shop closed', 'Parcel not ready', "Bags don't match label", 'Owner unreachable'] : ['Customer not home', 'Customer unreachable', 'Customer refused an item', 'Wrong address', 'Unsafe to deliver']}
        onClose={() => setFail(false)} onSubmit={(r) => (s.kind === 'pickup' ? rpc('fail_pickup', { p_stop: s.id, p_reason: r }) : rpc('fail_delivery', { p_order: s.order.id, p_reason: r })).then(onDone)}>
        {s.kind === 'pickup' && <p className="muted small">Allowed after 20 minutes of waiting (30 if the shop asked for more time), or at once if the shop is closed.</p>}
      </ReasonModal>}
    </section>
  )
}

function HandoverOut({ h, inline }) {
  const body = (
    <div className="stack">
      <div className="code-big"><small>Handover code · show it to {h.to}</small>{h.code}</div>
      <p className="muted">Hand all your bags to {h.to} ({h.route}). They photograph them and type this code. Your delivery codes stay with the customers.</p>
    </div>
  )
  return inline ? <Card title="Hand over your bags">{body}</Card> : <><PageHead hero title="Hand over your bags" sub={`Operations has moved your deliveries to ${h.to}.`} /><Card>{body}</Card></>
}

function History() {
  const { data } = useLoad(() => rpc('rider_history'))
  return (
    <Card title="Your recent routes" pad={false}>
      {!data ? <Loading /> : data.length === 0 ? <Empty>No routes yet.</Empty> : (
        <div className="list">{data.map((r) => <div className="list-row" key={r.ref}><span className="ic good"><Icon name="route" size={16} /></span>
          <div className="grow"><div className="row between"><strong className="mono">{r.ref}</strong><span className="muted small">{dateTime(r.finished_at)}</span></div>
            <div className="muted small">{r.delivered} of {r.drops} delivered{r.status === 'cancelled' ? ' · declined' : ''}</div></div></div>)}</div>
      )}
    </Card>
  )
}

