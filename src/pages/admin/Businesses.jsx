import { useState } from 'react'
import { supabase, rpc, adminUsers } from '../../lib/supabase'
import { PageHead, Card, Loading, Empty, Badge, ReasonModal, useLoad, q, useAction } from '../../components/ui'
import TempPassword from '../../components/TempPassword'
import { date } from '../../lib/format'

const BLANK = { name: '', sector: '', phone: '', pickup_address: '', pickup_landmark: '', zone: '', owner_name: '', owner_email: '' }

export default function Businesses() {
  const list = useLoad(async () => {
    const [biz, owners] = await Promise.all([
      q(supabase.from('businesses').select('*').order('created_at', { ascending: false })),
      q(supabase.from('profiles').select('id,full_name,email,status,last_login,business_id').eq('role', 'owner')),
    ])
    return biz.map((b) => ({ ...b, owner: owners.find((o) => o.business_id === b.id) }))
  })
  const [f, setF] = useState(BLANK)
  const [shown, setShown] = useState(null)
  const [toggle, setToggle] = useState(null)
  const [run, busy] = useAction()
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const create = async (e) => {
    e.preventDefault()
    const r = await run(() => adminUsers({ action: 'create_business', ...f }), 'Business added')
    if (r) { setShown({ who: f.owner_name, login: r.login, password: r.temp_password }); setF(BLANK); list.reload() }
  }
  const reset = async (o) => {
    const r = await run(() => adminUsers({ action: 'reset_password', user_id: o.id }), 'Password reset')
    if (r) setShown({ who: o.full_name, login: o.email, password: r.temp_password })
  }

  return (
    <>
      <PageHead title="Businesses" sub="Each business gets one owner account. The owner sets their own password at first sign-in." />
      <div className="grid-main wide-table">
        <Card title="All businesses" pad={false}>
          {list.loading || list.error ? <Loading error={list.error} /> : list.data.length === 0 ? <Empty>No businesses yet. Add the first one.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Business</th><th>Owner</th><th>Pickup</th><th>Added</th><th>Status</th><th /></tr></thead>
              <tbody>{list.data.map((b) => (
                <tr key={b.id}>
                  <td><strong>{b.name}</strong><div className="muted small">{b.sector || '—'}</div></td>
                  <td>{b.owner ? <>{b.owner.full_name}<div className="muted small">{b.owner.email}</div></> : '—'}</td>
                  <td>{b.pickup_address || '—'}<div className="muted small">{[b.pickup_landmark, b.zone].filter(Boolean).join(' · ')}</div></td>
                  <td className="nowrap">{date(b.created_at)}</td>
                  <td>{b.active ? <Badge tone="good">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
                  <td><div className="row nowrap">
                    {b.owner && <button className="btn sm" disabled={busy} onClick={() => reset(b.owner)}>Reset owner password</button>}
                    <button className="btn sm" onClick={() => setToggle(b)}>{b.active ? 'Deactivate' : 'Reactivate'}</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
        <Card title="Add a business">
          <form className="stack" onSubmit={create}>
            <label className="field">Business name<input value={f.name} onChange={set('name')} required /></label>
            <label className="field">What it sells <span className="hint">e.g. Fashion, Food</span><input value={f.sector} onChange={set('sector')} /></label>
            <label className="field">Pickup address<input value={f.pickup_address} onChange={set('pickup_address')} /></label>
            <div className="grid-2">
              <label className="field">Landmark<input value={f.pickup_landmark} onChange={set('pickup_landmark')} /></label>
              <label className="field">Zone<input value={f.zone} onChange={set('zone')} placeholder="Lekki" /></label>
            </div>
            <label className="field">Business phone<input value={f.phone} onChange={set('phone')} /></label>
            <hr />
            <label className="field">Owner's name<input value={f.owner_name} onChange={set('owner_name')} required /></label>
            <label className="field">Owner's e-mail <span className="hint">Their login</span><input type="email" value={f.owner_email} onChange={set('owner_email')} required /></label>
            <button className="btn primary" disabled={busy}>{busy ? 'Adding…' : 'Add business and create owner account'}</button>
          </form>
        </Card>
      </div>
      {shown && <TempPassword {...shown} onClose={() => setShown(null)} />}
      {toggle && (
        <ReasonModal title={`${toggle.active ? 'Deactivate' : 'Reactivate'} ${toggle.name}?`} minLength={5} danger={toggle.active}
          confirm={toggle.active ? 'Deactivate' : 'Reactivate'} onClose={() => setToggle(null)}
          onSubmit={async (reason) => { await rpc('set_business_active', { p_id: toggle.id, p_active: !toggle.active, p_reason: reason }); list.reload() }}>
          {toggle.active && <p>The business can no longer send orders. Its history is kept.</p>}
        </ReasonModal>
      )}
    </>
  )
}
