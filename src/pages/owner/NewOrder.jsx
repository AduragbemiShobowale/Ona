import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase, rpc } from '../../lib/supabase'
import { useLoad, q, Card, PageHead, Loading, Empty, Badge } from '../../components/ui'
import { naira, ZONES, isoDay, timeOnly, VEHICLE } from '../../lib/format'
import Icon from '../../components/icons'

const SIZE_RANK = { small: 1, medium: 2, large: 3, bulky: 4 }
const suggest = (max, bags) => (max === 'bulky' || bags > 12 ? 'truck' : max === 'large' || bags > 6 ? 'van' : max === 'medium' || bags > 3 ? 'car' : 'bike')
const bandIndex = (km, limits) => (km <= limits[0] ? 0 : km <= limits[1] ? 1 : km <= limits[2] ? 2 : 3)
const typo = (e) => {
  const m = e.toLowerCase().match(/@(.+)$/)
  if (!m) return null
  const fixes = { 'gmial.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gamil.com': 'gmail.com', 'yahoo.co': 'yahoo.com', 'yaho.com': 'yahoo.com', 'hotmial.com': 'hotmail.com', 'outlok.com': 'outlook.com' }
  return fixes[m[1]] ? e.replace(/@.+$/, '@' + fixes[m[1]]) : null
}

// A single order: items from stock, the customer's e-mail, a delivery window from Ọ̀nà's slots.
export default function NewOrder() {
  const nav = useNavigate()
  const { data, error } = useLoad(async () => ({
    products: await q(supabase.from('products').select('*').eq('active', true).order('name')),
    settings: Object.fromEntries((await q(supabase.from('settings').select('key, value').in('key', ['fees', 'band_limits_km']))).map((s) => [s.key, s.value])),
  }))
  const [f, setF] = useState({ email: '', name: '', zone: 'Lekki', date: isoDay(1), address: '', landmark: '', phone: '', km: '3', note: '' })
  const [items, setItems] = useState([])
  const [slot, setSlot] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(null)
  const slots = useLoad(() => rpc('slots_for', { p_zone: f.zone, p_date: f.date }), [f.zone, f.date])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const lines = items.map((i) => ({ ...i, p: data?.products.find((p) => p.id === i.product_id) })).filter((i) => i.p)
  const nItems = lines.reduce((s, i) => s + Number(i.qty || 0), 0)
  const bags = Math.max(1, Math.ceil(nItems / 3))
  const maxSize = lines.reduce((m, i) => (SIZE_RANK[i.p.size_class] > SIZE_RANK[m] ? i.p.size_class : m), 'small')
  const vehicle = suggest(maxSize, bags)
  const fee = data ? data.settings.fees?.[vehicle]?.[bandIndex(Number(f.km || 0), data.settings.band_limits_km || [5, 15, 30])] : null
  const goods = lines.reduce((s, i) => s + Number(i.qty || 0) * Number(i.p.price), 0)
  const suggestion = typo(f.email)
  const over = lines.find((i) => Number(i.qty) > i.p.on_hand - i.p.reserved)

  const add = (pid) => pid && !items.some((i) => i.product_id === pid) && setItems([...items, { product_id: pid, qty: 1 }])
  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (!slot) return setErr('Choose a delivery window.')
    if (!lines.length) return setErr('Add at least one item.')
    setBusy(true)
    try {
      const ref = await rpc('send_order', {
        p_email: f.email, p_customer_name: f.name || null, p_items: lines.map((i) => ({ product_id: i.product_id, qty: Number(i.qty) })),
        p_window_start: slot, p_zone: f.zone,
        p_address: f.address ? { address: f.address, landmark: f.landmark, phone: f.phone, zone: f.zone } : null,
        p_bags: bags, p_vehicle: null, p_distance_km: Number(f.km || 0), p_note: f.note || null,
      })
      setDone(ref)
      toast.success(`Order ${ref} created`)
    } catch (e2) { setErr(e2.message) } finally { setBusy(false) }
  }

  if (!data) return <Loading error={error} />
  if (done) return (
    <div className="waybill" style={{ maxWidth: 560, margin: '24px auto', boxShadow: 'none', border: '1px solid var(--line)' }}>
      <div className="waybill-head"><span>Order created · <b>{done}</b></span><span className="barcode" /></div>
      <div className="waybill-body">
        <h1>{done}</h1>
        <p>{f.address ? 'Pack it, then send it to Ọ̀nà from your Orders board.' : 'We have told the customer. Once they choose their address, you can pack it.'} If <strong>{f.email}</strong> has no Ọ̀nà account yet, the order waits for them when they sign up with that e-mail.</p>
        <div className="row"><button className="btn primary" onClick={() => nav('/orders?tab=pack')}>Go to orders</button><button className="btn" onClick={() => { setDone(null); setItems([]); setSlot(null); setF({ ...f, email: '', name: '', address: '', landmark: '', phone: '' }) }}>Another order</button></div>
      </div>
    </div>
  )
  return (
    <form onSubmit={submit} className="stack-lg">
      <PageHead title="New order" sub="Pick the items from your stock, say who it is for and when it should arrive. Ọ̀nà picks the vehicle and the fee." />
      {data.products.length === 0 && <div className="notice warn">You have no products yet. Add them on the Stock page first.</div>}
      <div className="grid-main">
        <div className="stack-lg">
          <Card title="1 · Items">
            <div className="stack">
              <select value="" onChange={(e) => add(e.target.value)}>
                <option value="">Add an item from stock…</option>
                {data.products.map((p) => <option key={p.id} value={p.id} disabled={p.on_hand - p.reserved <= 0}>{p.name} · {p.on_hand - p.reserved} available</option>)}
              </select>
              {lines.length === 0 ? <Empty>No items yet.</Empty> : (
                <div className="table-wrap"><table><thead><tr><th>Item</th><th>Available</th><th style={{ width: 110 }}>Qty</th><th>Price</th><th /></tr></thead>
                  <tbody>{lines.map((i) => (
                    <tr key={i.product_id}><td><strong>{i.p.name}</strong><div className="muted small">{i.p.sku} · {i.p.size_class}</div></td>
                      <td className="mono">{i.p.on_hand - i.p.reserved}</td>
                      <td><input type="number" min="1" className={Number(i.qty) > i.p.on_hand - i.p.reserved ? 'bad' : ''} value={i.qty} onChange={(e) => setItems(items.map((x) => (x.product_id === i.product_id ? { ...x, qty: e.target.value } : x)))} /></td>
                      <td className="mono">{naira(Number(i.qty || 0) * i.p.price)}</td>
                      <td><button type="button" className="btn ghost sm" onClick={() => setItems(items.filter((x) => x.product_id !== i.product_id))} aria-label="Remove"><Icon name="x" size={15} /></button></td></tr>
                  ))}</tbody></table></div>
              )}
              {over && <div className="notice bad">Only {over.p.on_hand - over.p.reserved} of {over.p.name} available.</div>}
            </div>
          </Card>
          <Card title="2 · Customer">
            <div className="stack">
              <div className="grid-2">
                <label className="field">Customer's e-mail <span className="hint">They track the order and hold the delivery code</span><input type="email" required value={f.email} onChange={set('email')} placeholder="kemi@example.com" /></label>
                <label className="field">Name <span className="hint">Optional</span><input value={f.name} onChange={set('name')} placeholder="Kemi Adeyemi" /></label>
              </div>
              {suggestion && <div className="notice warn">Did you mean <a href="#fix" onClick={(e) => { e.preventDefault(); setF({ ...f, email: suggestion }) }}>{suggestion}</a>?</div>}
              <label className="field">Delivery address <span className="hint">Leave empty to let the customer choose it in the app</span><input value={f.address} onChange={set('address')} placeholder="14 Bourdillon Road, Ikoyi" /></label>
              {f.address && <div className="grid-2">
                <label className="field">Landmark<input value={f.landmark} onChange={set('landmark')} placeholder="Opposite the church" /></label>
                <label className="field">Phone at the door<input value={f.phone} onChange={set('phone')} placeholder="0803 555 0142" /></label>
              </div>}
            </div>
          </Card>
          <Card title="3 · Delivery window">
            <div className="stack">
              <div className="grid-2">
                <label className="field">Zone<select value={f.zone} onChange={(e) => { setSlot(null); set('zone')(e) }}>{ZONES.map((z) => <option key={z}>{z}</option>)}</select></label>
                <label className="field">Date<input type="date" min={isoDay(0)} value={f.date} onChange={(e) => { setSlot(null); set('date')(e) }} /></label>
              </div>
              {!slots.data ? <Loading error={slots.error} /> : (
                <div className="slots">{slots.data.map((s) => (
                  <button type="button" key={s.w_start} disabled={!s.open} className={`slot ${slot === s.w_start ? 'on' : ''}`} onClick={() => setSlot(s.w_start)}>
                    <b>{timeOnly(s.w_start)}–{timeOnly(s.w_end)}</b><small>{s.open ? `${s.capacity - s.used} places left` : s.used >= s.capacity ? 'Full' : 'Too soon'}</small>
                  </button>))}</div>
              )}
              <p className="muted small">The fee must be confirmed at least an hour before the window starts. Full and too-soon windows are greyed out.</p>
            </div>
          </Card>
        </div>
        <div className="stack" style={{ position: 'sticky', top: 90 }}>
          <section className="waybill" style={{ boxShadow: 'none', border: '1px solid var(--line)' }}>
            <div className="waybill-head"><span>Summary</span><span>{f.zone}</span></div>
            <div className="waybill-body">
              <dl className="dl">
                <dt>Items</dt><dd>{nItems}</dd>
                <dt>Bags</dt><dd>{bags}</dd>
                <dt>Vehicle</dt><dd><Badge tone="info">{VEHICLE[vehicle]}</Badge></dd>
                <dt>Distance</dt><dd><input type="number" min="0" step="0.5" value={f.km} onChange={set('km')} style={{ height: 34, width: 90 }} /> km <span className="muted small">estimate</span></dd>
                <dt>Delivery fee</dt><dd className="mono" style={{ fontSize: 20 }}>{naira(fee)}</dd>
                <dt>Goods value</dt><dd className="mono">{naira(goods)} <div className="muted small">collected by you, not Ọ̀nà</div></dd>
              </dl>
              <label className="field">Note for Ọ̀nà <span className="hint">Optional</span><input value={f.note} onChange={set('note')} placeholder="Fragile, call before arriving…" /></label>
              {err && <div className="notice bad">{err}</div>}
              <button className="btn primary lg block" disabled={busy || !!over}>{busy ? 'Creating…' : 'Create order'}</button>
            </div>
          </section>
        </div>
      </div>
    </form>
  )
}
