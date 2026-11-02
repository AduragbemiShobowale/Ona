import { useState } from 'react'
import { supabase, rpc } from '../../lib/supabase'
import { useLoad, q, Card, PageHead, Loading, Badge, useAction } from '../../components/ui'
import Icon from '../../components/icons'

const COLS = ['email', 'name', 'sku', 'qty', 'zone', 'date', 'window', 'address', 'phone', 'landmark']
const SAMPLE = `email,name,sku,qty,zone,date,window,address,phone,landmark
kemi@example.com,Kemi Adeyemi,ANK-01,2,Ikoyi,2026-11-05,10:00-12:00,14 Bourdillon Road,08035550142,Opposite the church
kemi@example.com,Kemi Adeyemi,LACE-02,1,Ikoyi,2026-11-05,10:00-12:00,14 Bourdillon Road,08035550142,Opposite the church
tunde@example.com,Tunde B,ANK-01,1,Lekki,2026-11-05,12:00-14:00,,,`

// Simple CSV: commas, optional double quotes.
function parseCsv(text) {
  const rows = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const out = []; let cur = ''; let inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
      else if (c === ',' && !inQ) { out.push(cur.trim()); cur = '' }
      else cur += c
    }
    out.push(cur.trim()); rows.push(out)
  }
  return rows
}

// Bulk entry, as in Verity: one row per item; rows with the same customer, window and address become one order.
export default function Bulk() {
  const { data, error } = useLoad(() => q(supabase.from('products').select('id, sku, name, on_hand, reserved, active')))
  const [text, setText] = useState('')
  const [checked, setChecked] = useState(null)
  const [results, setResults] = useState(null)
  const [run, busy] = useAction()

  const check = () => {
    const rows = parseCsv(text)
    if (!rows.length) return setChecked({ orders: [], bad: [{ line: 0, msg: 'Paste or upload some rows first.' }] })
    const head = rows[0].map((h) => h.toLowerCase())
    const body = head.includes('email') ? rows.slice(1) : rows
    const idx = (k) => (head.includes('email') ? head.indexOf(k) : COLS.indexOf(k))
    const left = Object.fromEntries((data || []).map((p) => [p.sku.toUpperCase(), { ...p, avail: p.on_hand - p.reserved }]))
    const orders = new Map(); const bad = []
    body.forEach((r, n) => {
      const g = (k) => (idx(k) >= 0 ? r[idx(k)] || '' : '')
      const line = n + (head.includes('email') ? 2 : 1)
      const email = g('email').toLowerCase(); const sku = g('sku').toUpperCase(); const qty = Number(g('qty')); const win = g('window'); const date = g('date')
      const p = left[sku]
      const msg = !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email) ? 'E-mail looks wrong' : !p || !p.active ? `No product with SKU ${sku}` : !(qty > 0) ? 'Quantity must be a number above 0'
        : qty > p.avail ? `Only ${p.avail} of ${p.name} left` : !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 'Date must look like 2026-11-05' : !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(win) ? 'Window must look like 10:00-12:00' : !g('zone') ? 'Zone missing' : null
      if (msg) return bad.push({ line, msg })
      p.avail -= qty
      const key = [email, date, win, g('address').toLowerCase()].join('|')
      if (!orders.has(key)) orders.set(key, { email, name: g('name'), zone: g('zone'), start: `${date}T${win.slice(0, 5)}:00+01:00`, label: `${date} ${win}`, address: g('address'), phone: g('phone'), landmark: g('landmark'), items: [], lines: [] })
      const o = orders.get(key)
      const ex = o.items.find((i) => i.product_id === p.id)
      if (ex) ex.qty += qty; else o.items.push({ product_id: p.id, qty, name: p.name })
      o.lines.push(line)
    })
    setChecked({ orders: [...orders.values()], bad }); setResults(null)
  }

  const send = () => run(async () => {
    const out = []
    for (const o of checked.orders) {
      try {
        const ref = await rpc('send_order', { p_email: o.email, p_customer_name: o.name || null, p_items: o.items.map(({ product_id, qty }) => ({ product_id, qty })), p_window_start: o.start, p_zone: o.zone,
          p_address: o.address ? { address: o.address, phone: o.phone, landmark: o.landmark, zone: o.zone } : null, p_bags: null, p_vehicle: null, p_distance_km: null, p_note: null })
        out.push({ ...o, ok: true, ref })
      } catch (e) { out.push({ ...o, ok: false, msg: e.message }) }
    }
    setResults(out)
    return out
  }, (out) => `${out.filter((o) => o.ok).length} of ${out.length} orders created`)

  const file = async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageHead title="Bulk orders" sub="Upload a spreadsheet saved as CSV, one row per item. Rows for the same customer, window and address become one order. Bad rows are listed; good ones are created." />
      <div className="grid-main">
        <Card title="Rows">
          <div className="stack">
            <div className="row">
              <label className="btn"><Icon name="upload" size={16} /> Choose CSV file<input type="file" accept=".csv,text/csv" hidden onChange={file} /></label>
              <button className="btn ghost" onClick={() => setText(SAMPLE)}>Fill with an example</button>
            </div>
            <textarea style={{ minHeight: 220, fontFamily: 'var(--mono)', fontSize: 12.5 }} value={text} onChange={(e) => setText(e.target.value)} placeholder={COLS.join(',')} />
            <div className="row"><button className="btn primary" onClick={check} disabled={!text.trim()}>Check rows</button>
              {checked?.orders.length > 0 && !results && <button className="btn sun" disabled={busy} onClick={send}>{busy ? 'Creating…' : `Create ${checked.orders.length} order${checked.orders.length > 1 ? 's' : ''}`}</button>}</div>
          </div>
        </Card>
        <Card title="Columns">
          <div className="stack small">
            <code>{COLS.join(', ')}</code>
            <span><b>window</b> is one of Ọ̀nà's slots: 08:00-10:00 … 18:00-20:00 (Sunday 12:00-18:00).</span>
            <span><b>address</b> can be empty: the customer then chooses it in the app.</span>
            <span>Each row is checked against your available stock, counting earlier rows.</span>
          </div>
        </Card>
      </div>
      {checked && (
        <div className="grid-2">
          <Card title={`Ready (${checked.orders.length})`} pad={false}>
            <div className="list">{(results || checked.orders).map((o, i) => (
              <div className="list-row" key={i}><span className={`ic ${o.ok === false ? 'bad' : 'good'}`}><Icon name={o.ok === false ? 'x' : 'check'} size={16} /></span>
                <div className="grow"><div className="row between"><strong>{o.name || o.email}</strong>{o.ref && <Badge tone="good">{o.ref}</Badge>}</div>
                  <div className="muted small">{o.items.map((x) => `${x.qty} × ${x.name}`).join(', ')} · {o.zone} · {o.label} · rows {o.lines.join(', ')}</div>
                  {o.msg && <div className="small" style={{ color: 'var(--bad)' }}>{o.msg}</div>}</div></div>))}</div>
          </Card>
          <Card title={`Rows with problems (${checked.bad.length})`} pad={false}>
            {checked.bad.length === 0 ? <div className="empty">None.</div> : <div className="list">{checked.bad.map((b, i) => (
              <div className="list-row" key={i}><span className="ic bad"><Icon name="alert" size={16} /></span><div className="grow"><strong>Row {b.line}</strong><div className="small">{b.msg}</div></div></div>))}</div>}
          </Card>
        </div>
      )}
    </>
  )
}
