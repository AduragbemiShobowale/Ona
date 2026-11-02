import { useState } from 'react'
import { supabase, rpc, adminUsers } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { PageHead, Card, Loading, Empty, Badge, useLoad, q } from '../../components/ui'
import { StaffTable, useStaffActions } from '../admin/Staff'
import { phoneFromLogin } from '../../lib/login'
import { date } from '../../lib/format'

const VT = { bike: 'Bike', car: 'Car', van: 'Van', truck: 'Truck' }
const VSTATUS = { available: ['Available', 'good'], assigned: ['Has a rider', 'info'], in_use: ['On a trip', 'accent'], under_repair: ['Under repair', 'warn'], retired: ['Retired', 'muted'] }
const AVAIL = { available: ['Available', 'good'], off: ['Off today', 'muted'], on_trip: ['On a trip', 'accent'], paused: ['Paused', 'bad'] }
const soon = (d) => d && (new Date(d) - Date.now()) / 86400000 < 30

// Operations manages; the super admin sees the same page read-only.
export default function Fleet({ readOnly }) {
  const { profile } = useAuth()
  const data = useLoad(async () => {
    const [vehicles, riders, people, staff] = await Promise.all([
      q(supabase.from('vehicles').select('*').order('created_at')),
      q(supabase.from('riders').select('*')),
      q(supabase.from('profiles').select('id,full_name,email,phone,status,last_login').eq('role', 'rider')),
      readOnly ? [] : q(supabase.from('profiles').select('*').eq('role', 'operations').eq('ops_lead', false)),
    ])
    return { vehicles, staff, riders: riders.map((r) => ({ ...r, ...people.find((p) => p.id === r.profile_id), id: r.profile_id })) }
  })
  const a = useStaffActions(() => data.reload())
  const [v, setV] = useState({ type: 'bike', plate: '', capacity: 3 })
  const [r, setR] = useState({ full_name: '', phone: '', email: '', zone: '', licence_expiry: '', vehicle_id: '' })
  const [d, setD] = useState({ full_name: '', email: '' })

  if (data.loading || data.error) return <><PageHead title="Riders & vehicles" /><Loading error={data.error} /></>
  const { vehicles, riders, staff } = data.data
  const freeVehicles = vehicles.filter((x) => x.status === 'available')
  const plateOf = (id) => vehicles.find((x) => x.id === id)

  const addVehicle = async (e) => {
    e.preventDefault()
    if (await a.run(() => rpc('create_vehicle', { p_type: v.type, p_plate: v.plate, p_capacity: Number(v.capacity) }), 'Vehicle added') !== undefined) { setV({ ...v, plate: '' }); data.reload() }
  }
  const addRider = async (e) => {
    e.preventDefault()
    const res = await a.run(() => adminUsers({ action: 'create_rider', ...r, vehicle_id: r.vehicle_id || null }), 'Rider created')
    if (res) { a.setShown({ who: r.full_name, login: res.login, password: res.temp_password }); setR({ full_name: '', phone: '', email: '', zone: '', licence_expiry: '', vehicle_id: '' }); data.reload() }
  }
  const addDispatch = async (e) => {
    e.preventDefault()
    const res = await a.run(() => adminUsers({ action: 'create_staff', ...d }), 'Dispatch account created')
    if (res) { a.setShown({ who: d.full_name, login: res.login, password: res.temp_password }); setD({ full_name: '', email: '' }); data.reload() }
  }
  const attach = (rider, vehicleId) => a.run(() => rpc('attach_vehicle', { p_rider: rider, p_vehicle: vehicleId || null }), 'Vehicle updated').then(() => data.reload())
  const setAvail = (rider, availability) => a.run(() => rpc('set_rider', { p_rider: rider, p_zone: null, p_licence_expiry: null, p_availability: availability }), availability === 'paused' ? 'Rider paused' : 'Rider updated').then(() => data.reload())
  const setVStatus = (id, status) => a.run(() => rpc('set_vehicle_status', { p_vehicle: id, p_status: status }), 'Vehicle updated').then(() => data.reload())

  return (
    <>
      <PageHead title="Riders & vehicles" sub={readOnly ? 'Read-only. Operations manages riders and vehicles.' : 'Every rider is attached to one vehicle. Paused riders and riders with expired papers get no offers.'} />
      <div className="stack-lg">
        <Card title={`Riders · ${riders.length}`} pad={false}>
          {riders.length === 0 ? <Empty>No riders yet.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Rider</th><th>Vehicle</th><th>Zone</th><th>Licence</th><th>Status</th>{!readOnly && <th />}</tr></thead>
              <tbody>{riders.map((x) => {
                const veh = plateOf(x.vehicle_id)
                return (
                  <tr key={x.id}>
                    <td><strong>{x.full_name}</strong><div className="muted small mono">{phoneFromLogin(x.email) || x.phone || x.email}</div>{x.status !== 'active' && <Badge tone="muted">Account inactive</Badge>}</td>
                    <td>{readOnly ? (veh ? `${VT[veh.type]} · ${veh.plate}` : '—') : (
                      <select value={x.vehicle_id || ''} onChange={(e) => attach(x.id, e.target.value)} aria-label={`Vehicle for ${x.full_name}`}>
                        <option value="">No vehicle</option>
                        {veh && <option value={veh.id}>{VT[veh.type]} · {veh.plate}</option>}
                        {freeVehicles.map((fv) => <option key={fv.id} value={fv.id}>{VT[fv.type]} · {fv.plate}</option>)}
                      </select>)}</td>
                    <td>{x.zone || '—'}</td>
                    <td className={soon(x.licence_expiry) ? 'warn-text' : ''}>{x.licence_expiry ? date(x.licence_expiry) : '—'}{soon(x.licence_expiry) && <div className="small">Expires soon</div>}</td>
                    <td><Badge tone={AVAIL[x.availability][1]}>{AVAIL[x.availability][0]}</Badge></td>
                    {!readOnly && <td className="row">
                      {x.availability === 'paused'
                        ? <button className="btn sm" onClick={() => setAvail(x.id, 'available')}>Unpause</button>
                        : <button className="btn sm" onClick={() => setAvail(x.id, 'paused')}>Pause</button>}
                      <button className="btn sm" disabled={a.busy} onClick={() => a.reset({ ...x, login: phoneFromLogin(x.email) || x.email })}>Reset password</button>
                      <button className="btn sm" onClick={() => a.setToggle(x)}>{x.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>
                    </td>}
                  </tr>
                )
              })}</tbody>
            </table></div>
          )}
        </Card>

        <Card title={`Vehicles · ${vehicles.length}`} pad={false}>
          {vehicles.length === 0 ? <Empty>No vehicles yet.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Type</th><th>Plate</th><th>Carries</th><th>Rider</th><th>Status</th>{!readOnly && <th />}</tr></thead>
              <tbody>{vehicles.map((x) => (
                <tr key={x.id}>
                  <td>{VT[x.type]}</td><td className="mono">{x.plate}</td><td>{x.capacity_bags} bags</td>
                  <td>{riders.find((rr) => rr.vehicle_id === x.id)?.full_name || '—'}</td>
                  <td><Badge tone={VSTATUS[x.status][1]}>{VSTATUS[x.status][0]}</Badge></td>
                  {!readOnly && <td className="row">
                    {x.status !== 'under_repair' && x.status !== 'retired' && <button className="btn sm" onClick={() => setVStatus(x.id, 'under_repair')}>Under repair</button>}
                    {x.status === 'under_repair' && <button className="btn sm" onClick={() => setVStatus(x.id, 'available')}>Back in service</button>}
                  </td>}
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>

        {!readOnly && (
          <div className="grid-2">
            <Card title="Add a rider">
              <form className="stack" onSubmit={addRider}>
                <label className="field">Name<input value={r.full_name} onChange={(e) => setR({ ...r, full_name: e.target.value })} required /></label>
                <label className="field">Phone number <span className="hint">Their login if they have no e-mail</span><input value={r.phone} onChange={(e) => setR({ ...r, phone: e.target.value })} placeholder="0803 555 0142" required /></label>
                <label className="field">E-mail (optional)<input type="email" value={r.email} onChange={(e) => setR({ ...r, email: e.target.value })} /></label>
                <div className="grid-2">
                  <label className="field">Zone<input value={r.zone} onChange={(e) => setR({ ...r, zone: e.target.value })} placeholder="Lekki" /></label>
                  <label className="field">Licence expires<input type="date" value={r.licence_expiry} onChange={(e) => setR({ ...r, licence_expiry: e.target.value })} /></label>
                </div>
                <label className="field">Vehicle<select value={r.vehicle_id} onChange={(e) => setR({ ...r, vehicle_id: e.target.value })}>
                  <option value="">Attach later</option>
                  {freeVehicles.map((fv) => <option key={fv.id} value={fv.id}>{VT[fv.type]} · {fv.plate}</option>)}
                </select></label>
                <button className="btn primary" disabled={a.busy}>Create rider account</button>
              </form>
            </Card>
            <Card title="Add a vehicle">
              <form className="stack" onSubmit={addVehicle}>
                <label className="field">Type<select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value, capacity: { bike: 3, car: 8, van: 40, truck: 200 }[e.target.value] })}>
                  {Object.entries(VT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="field">Plate number<input value={v.plate} onChange={(e) => setV({ ...v, plate: e.target.value })} placeholder="LAG 123 XY" required /></label>
                <label className="field">Carries up to (bags)<input type="number" min="1" value={v.capacity} onChange={(e) => setV({ ...v, capacity: e.target.value })} required /></label>
                <button className="btn primary" disabled={a.busy}>Add vehicle</button>
              </form>
            </Card>
          </div>
        )}

        {!readOnly && profile.ops_lead && (
          <div className="grid-main">
            <Card title="Dispatch staff" pad={false}>
              <StaffTable rows={staff} busy={a.busy} canManage={() => true} onReset={a.reset} onToggle={a.setToggle} />
            </Card>
            <Card title="Add dispatch staff">
              <form className="stack" onSubmit={addDispatch}>
                <label className="field">Name<input value={d.full_name} onChange={(e) => setD({ ...d, full_name: e.target.value })} required /></label>
                <label className="field">E-mail<input type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} required /></label>
                <button className="btn primary" disabled={a.busy}>Create dispatch account</button>
              </form>
            </Card>
          </div>
        )}
      </div>
      {a.modals}
    </>
  )
}
