import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, rpc } from '../../lib/supabase'
import { useLoad, q, Card, Kpi, PageHead, Loading, Empty, StatusBadge, BarChart, Seg, Modal, ReasonModal, useAction, Badge, FileLink } from '../../components/ui'
import { naira, windowLabel, pct, minutesSince, VEHICLE, dateTime, STATUS } from '../../lib/format'
import Icon from '../../components/icons'

const ISSUE = { complaint: 'Complaint', failed_pickup: 'Failed pickup', failed_delivery: 'Failed delivery', code_locked: 'Code locked', delay: 'Late', rider_problem: 'Rider problem', rider_change: 'Rider changed', override: 'Code override', claim: 'Claim' }
export const issueLabel = (k) => ISSUE[k] || k

// ------------------------------------------------------------ overview: revenue (fees only), receipts, issues, businesses
export function AdminOverview() {
  const { data, error } = useLoad(async () => ({
    ov: await rpc('admin_overview'),
    issues: await q(supabase.from('issues').select('*, businesses(name)').eq('status', 'open').order('created_at', { ascending: false }).limit(12)),
  }))
  const [prompt, setPrompt] = useState(null)
  if (!data) return <Loading error={error} />
  const { ov, issues } = data
  const s = ov.orders_by_status || {}
  const c = ov.counts || {}
  const late = ov.oldest_receipt_minutes ?? 0
  return (
    <>
      <PageHead hero title="Ọ̀nà today" sub="Revenue here is delivery fees and waiting charges only. Goods values and stock stay with each business.">
        <Link className="btn" to="/businesses"><Icon name="store" size={16} /> Businesses</Link>
        <Link className="btn sun" to="/payments"><Icon name="receipt" size={16} /> Receipts{ov.receipts_waiting ? ` (${ov.receipts_waiting})` : ''}</Link>
      </PageHead>
      <div className="kpis">
        <Kpi icon="money" label="Revenue today" value={naira(ov.revenue_today)} note={`${naira(ov.revenue_7d)} this week · ${naira(ov.revenue_30d)} in 30 days`} tone="sun" />
        <Kpi icon="receipt" label="Receipts to confirm" value={ov.receipts_waiting} note={ov.receipts_waiting ? `Oldest waiting ${late} min (target 15)` : 'All caught up'} to="/payments" tone={late >= 15 ? 'alert' : ''} />
        <Kpi icon="check" label="On time (30 days)" value={pct(ov.on_time_30d, ov.delivered_30d)} note={`${ov.delivered_30d} delivered · ${ov.late_traffic_30d} late from traffic`} tone="good" />
        <Kpi icon="alert" label="Open issues" value={ov.open_issues} note={`${ov.failed_30d} failed pickups or deliveries in 30 days`} tone={ov.open_issues ? 'alert' : ''} />
        <Kpi icon="store" label="Active businesses" value={c.businesses} note={`${c.customers} customers signed up`} to="/businesses" />
        <Kpi icon="bike" label="Riders available" value={`${c.riders_available}/${c.riders}`} note={`${c.vehicles} vehicles · ${c.operations_staff} Operations staff`} to="/riders" />
      </div>
      <div className="grid-main">
        <Card title="Revenue, last 14 days"><BarChart data={ov.revenue_by_day} series={[{ key: 'amount', label: 'Revenue' }]} format={naira} /></Card>
        <Card title="Orders by stage" pad={false}>
          <div className="list">{[['Being packed', ['awaiting_address', 'received', 'waiting_restock', 'packed']], ['Waiting for payment', ['awaiting_payment', 'payment_check', 'payment_rejected']], ['Waiting for a rider', ['ready_for_pickup']], ['On the road', ['rider_assigned', 'rider_at_shop', 'out_for_delivery', 'rider_changing']], ['Delivered', ['delivered']], ['Problems', ['failed_pickup', 'failed_delivery', 'returned', 'claim_open']]].map(([l, ks]) => {
            const n = ks.reduce((a, k) => a + (s[k] || 0), 0)
            return <div className="list-row" key={l} style={{ alignItems: 'center' }}><div className="grow"><div className="row between"><span>{l}</span><strong className="mono">{n}</strong></div></div></div>
          })}</div>
        </Card>
      </div>
      <div className="grid-main">
        <Card title="Businesses (30 days)" pad={false} action={<Link to="/businesses" className="small">Manage</Link>}>
          {ov.businesses.length === 0 ? <Empty>No businesses yet.</Empty> : (
            <div className="table-wrap"><table><thead><tr><th>Business</th><th>Orders</th><th>Fees paid</th><th>On time</th><th>Issues</th><th /></tr></thead>
              <tbody>{ov.businesses.map((b) => <tr key={b.id}><td><strong>{b.name}</strong><div className="muted small">{b.zone || '—'}{!b.active && ' · inactive'}</div></td>
                <td className="mono">{b.orders_30d}</td><td className="mono">{naira(b.revenue_30d)}</td><td>{pct(b.on_time_30d, b.delivered_30d)}</td>
                <td>{b.open_issues ? <Badge tone="bad">{b.open_issues}</Badge> : '—'}</td>
                <td><button className="btn sm" onClick={() => setPrompt(b)}>Prompt</button></td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Card title="Issues feed" pad={false}>
          {issues.length === 0 ? <Empty>No open issues.</Empty> : <div className="list">{issues.map((i) => (
            <div className="list-row" key={i.id}><span className="ic bad"><Icon name="alert" size={16} /></span>
              <div className="grow"><div className="row between"><strong>{issueLabel(i.kind)}</strong><span className="muted small">{minutesSince(i.created_at) < 120 ? `${minutesSince(i.created_at)} min ago` : dateTime(i.created_at)}</span></div>
                <div className="small">{i.businesses?.name}{i.businesses?.name && ' · '}{i.detail}</div>
                {i.business_id && <button className="btn sm ghost" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => setPrompt({ id: i.business_id, name: i.businesses?.name })}>Prompt the business →</button>}</div></div>))}</div>}
        </Card>
      </div>
      {prompt && <ReasonModal title={`Message ${prompt.name}`} label="Message to the business owner" confirm="Send" minLength={5}
        placeholder="e.g. Three of your pickups failed this week because parcels weren't ready. Please pack before requesting dispatch."
        onClose={() => setPrompt(null)} onSubmit={(m) => rpc('prompt_business', { p_business: prompt.id, p_message: m })} />}
    </>
  )
}

// ------------------------------------------------------------ receipts: confirm or reject; refunds to pay
export function AdminPayments() {
  const [tab, setTab] = useState('pending')
  const { data, error, reload } = useLoad(async () => {
    await rpc('expire_overdue_requests').catch(() => {})
    const [pays, claims, orders] = await Promise.all([
      q(supabase.from('payments').select('*, businesses(name), dispatch_requests(ref, total_fee, adjustments, amount_due, attempts)').order('created_at', { ascending: tab === 'pending' }).limit(200)),
      q(supabase.from('claims').select('*, businesses(name)').in('status', ['approved', 'paid']).order('decided_at', { ascending: false })),
      rpc('admin_orders', { p_status: null, p_limit: 1000 }),
    ])
    const ref = Object.fromEntries((orders || []).map((o) => [o.id, o.ref]))
    return { pays, claims: claims.map((c) => ({ ...c, ref: ref[c.order_id] })) }
  }, [tab])
  const [run, busy] = useAction()
  const [reject, setReject] = useState(null)
  const [refund, setRefund] = useState(null)
  if (!data) return <Loading error={error} />
  const pending = data.pays.filter((p) => p.status === 'pending')
  const shown = tab === 'pending' ? pending : tab === 'refunds' ? [] : data.pays.filter((p) => p.status !== 'pending')
  const toPay = data.claims.filter((c) => c.status === 'approved')
  return (
    <>
      <PageHead title="Payments" sub="Check each receipt against the bank app, then confirm it: the orders go straight to Operations' dispatch queue. Target: within 15 minutes in working hours." />
      <Seg value={tab} onChange={setTab} options={[{ value: 'pending', label: 'To confirm', count: pending.length }, { value: 'done', label: 'History' }, { value: 'refunds', label: 'Refunds to pay', count: toPay.length }]} />
      {tab !== 'refunds' && (
        <Card pad={false}>
          {shown.length === 0 ? <Empty>{tab === 'pending' ? 'No receipts waiting.' : 'No history yet.'}</Empty> : (
            <div className="table-wrap"><table><thead><tr><th>Waiting</th><th>Business</th><th>Request</th><th>Due</th><th>Paid</th><th>Reference</th><th>Receipt</th><th>{tab === 'pending' ? '' : 'Result'}</th></tr></thead>
              <tbody>{shown.map((p) => {
                const w = minutesSince(p.created_at); const r = p.dispatch_requests
                return (
                  <tr key={p.id}>
                    <td>{p.status === 'pending' ? <Badge tone={w >= 30 ? 'bad' : w >= 15 ? 'warn' : 'good'}>{w} min</Badge> : <span className="small nowrap">{dateTime(p.decided_at)}</span>}</td>
                    <td><strong>{p.businesses?.name}</strong><div className="muted small">attempt {p.attempt} of 3</div></td>
                    <td className="mono">{r?.ref}</td>
                    <td className="mono">{naira(r?.amount_due)}</td>
                    <td className="mono">{naira(p.amount)}{Number(p.amount) !== Number(r?.amount_due) && <div><Badge tone="warn">differs</Badge></div>}</td>
                    <td className="mono small">{p.reference}</td>
                    <td><FileLink bucket="receipts" path={p.receipt_path}>Open receipt</FileLink></td>
                    <td className="nowrap">{p.status === 'pending' ? <>
                      <button className="btn sm primary" disabled={busy} onClick={() => run(() => rpc('review_payment', { p_payment: p.id, p_approve: true, p_reason: null }), 'Confirmed: orders sent to dispatch').then(reload)}>Confirm</button>{' '}
                      <button className="btn sm danger" onClick={() => setReject(p)}>Reject</button></>
                      : p.status === 'confirmed' ? <Badge tone="good">Confirmed</Badge> : <span title={p.reject_reason}><Badge tone="bad">Rejected</Badge> <span className="muted small">{p.reject_reason}</span></span>}</td>
                  </tr>
                )
              })}</tbody></table></div>
          )}
        </Card>
      )}
      {tab === 'refunds' && (
        <Card pad={false}>
          {data.claims.length === 0 ? <Empty>No approved claims.</Empty> : (
            <div className="table-wrap"><table><thead><tr><th>Order</th><th>Business</th><th>Kind</th><th>Refund</th><th>Decision</th><th /></tr></thead>
              <tbody>{data.claims.map((c) => <tr key={c.id}><td className="mono">{c.ref}</td><td>{c.businesses?.name}</td><td>{c.kind}</td><td className="mono">{naira(c.payout)}</td><td className="small">{c.decision}</td>
                <td>{c.status === 'approved' ? <button className="btn sm primary" onClick={() => setRefund(c)}>Mark paid</button> : <Badge tone="good">Paid · {c.refund_reference}</Badge>}</td></tr>)}</tbody></table></div>
          )}
        </Card>
      )}
      {reject && <ReasonModal title={`Reject receipt from ${reject.businesses?.name}?`} options={['Amount does not match', 'No transfer found', 'Receipt unreadable', 'Wrong reference in narration']} label="Reason" confirm="Reject" danger
        onClose={() => setReject(null)} onSubmit={(r) => rpc('review_payment', { p_payment: reject.id, p_approve: false, p_reason: r }).then(reload)}>
        <p className="muted">The business is told and can upload another receipt. After the third rejection the request closes and the orders go back to Packed.</p>
      </ReasonModal>}
      {refund && <ReasonModal title={`Refund ${naira(refund.payout)} to ${refund.businesses?.name}`} label="Transfer reference" confirm="Mark paid" minLength={4}
        onClose={() => setRefund(null)} onSubmit={(r) => rpc('mark_claim_paid', { p_claim: refund.id, p_reference: r }).then(reload)} />}
    </>
  )
}

// ------------------------------------------------------------ all orders, without addresses or goods
export function AdminOrders() {
  const [status, setStatus] = useState('')
  const { data, error } = useLoad(() => rpc('admin_orders', { p_status: status || null, p_limit: 300 }), [status])
  return (
    <>
      <PageHead title="All orders" sub="Every business's orders with the delivery fee. Addresses and goods are not shown here." >
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 220 }}><option value="">Every status</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
      </PageHead>
      <Card pad={false}>
        {!data ? <Loading error={error} /> : data.length === 0 ? <Empty>No orders.</Empty> : (
          <div className="table-wrap"><table><thead><tr><th>Order</th><th>Business</th><th>Zone</th><th>Window</th><th>Vehicle</th><th>Fee</th><th>Waiting</th><th>Status</th></tr></thead>
            <tbody>{data.map((o) => <tr key={o.id}><td className="mono"><strong>{o.ref}</strong></td><td>{o.business}</td><td>{o.zone}</td><td className="nowrap small">{windowLabel(o.window_start, o.window_end)}</td>
              <td>{VEHICLE[o.vehicle_type]} · {o.bags}</td><td className="mono">{naira(o.fee)}</td><td className="mono">{Number(o.waiting_charge) ? naira(o.waiting_charge) : '—'}</td><td><StatusBadge status={o.status} /></td></tr>)}</tbody></table></div>
        )}
      </Card>
    </>
  )
}

// ------------------------------------------------------------ fees, slots and rules (settings)
const EDIT = [
  ['waiting_free_minutes', 'Free waiting at pickup (minutes)'], ['waiting_rate', 'Waiting charge per block (₦)'], ['waiting_block_minutes', 'Waiting block (minutes)'],
  ['failed_pickup_after_minutes', 'Failed pickup allowed after (minutes)'], ['slot_capacity', 'Orders per zone per window'], ['payment_cutoff_minutes', 'Fee confirmed before window (minutes)'],
  ['payment_window_hours', 'Time to pay after requesting (hours)'], ['receipt_target_minutes', 'Receipt confirmation target (minutes)'], ['max_receipt_attempts', 'Receipt uploads allowed'],
  ['code_max_attempts', 'Wrong code tries before lock'], ['claim_limit', 'Claim limit per order (₦)'], ['claim_hours', 'Hours to claim damage'], ['missing_item_hours', 'Hours to report a missing item'],
  ['location_retention_days', 'Keep rider location (days)'],
]
export function FeesSettings() {
  const { data, error, reload } = useLoad(async () => Object.fromEntries((await q(supabase.from('settings').select('key, value'))).map((s) => [s.key, s.value])))
  const [fees, setFees] = useState(null)
  const [vals, setVals] = useState({})
  const [bank, setBank] = useState(null)
  const [run, busy] = useAction()
  if (!data) return <Loading error={error} />
  const f = fees || data.fees
  const b = bank || data.bank_details
  const save = (key, value) => run(() => rpc('set_setting', { p_key: key, p_value: value }), 'Saved').then(reload)
  return (
    <>
      <PageHead title="Fees and slots" sub="Ọ̀nà's price list and rules. Changes apply to new orders straight away and are recorded in the audit log." />
      <Card title="Delivery fee by vehicle and distance (₦)" action={<button className="btn sm primary" disabled={busy || !fees} onClick={() => save('fees', f)}>Save fees</button>}>
        <div className="table-wrap"><table><thead><tr><th>Vehicle</th>{(data.distance_bands || []).map((d) => <th key={d}>{d}</th>)}</tr></thead>
          <tbody>{['bike', 'car', 'van', 'truck'].map((v) => <tr key={v}><td><strong>{VEHICLE[v]}</strong></td>{f[v].map((n, i) => <td key={i}><input type="number" min="0" value={n} style={{ width: 110 }}
            onChange={(e) => setFees({ ...f, [v]: f[v].map((x, j) => (j === i ? Number(e.target.value) : x)) })} /></td>)}</tr>)}</tbody></table></div>
      </Card>
      <div className="grid-main">
        <Card title="Rules">
          <div className="grid-2">{EDIT.map(([k, l]) => (
            <label className="field" key={k}>{l}
              <div className="row nowrap"><input type="number" value={vals[k] ?? data[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
                {vals[k] != null && String(vals[k]) !== String(data[k]) && <button className="btn sm primary" disabled={busy} onClick={() => save(k, Number(vals[k])).then(() => setVals({ ...vals, [k]: undefined }))}>Save</button>}</div>
            </label>))}</div>
        </Card>
        <div className="stack-lg">
          <Card title="Delivery windows">
            <div className="stack small">
              <span><b>Mon–Sat:</b> {(data.slots?.mon_sat || []).join(' · ')}</span>
              <span><b>Sunday:</b> {(data.slots?.sun || []).join(' · ')}</span>
              <span className="muted">Up to {data.slot_capacity} orders per zone per window.</span>
            </div>
          </Card>
          <Card title="Ọ̀nà's bank account" action={<button className="btn sm primary" disabled={busy || !bank} onClick={() => save('bank_details', b)}>Save</button>}>
            <div className="stack">
              <label className="field">Bank<input value={b.bank} onChange={(e) => setBank({ ...b, bank: e.target.value })} /></label>
              <label className="field">Account name<input value={b.account_name} onChange={(e) => setBank({ ...b, account_name: e.target.value })} /></label>
              <label className="field">Account number<input value={b.account_no} onChange={(e) => setBank({ ...b, account_no: e.target.value })} /></label>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
