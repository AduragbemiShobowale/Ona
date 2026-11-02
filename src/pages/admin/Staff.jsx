import { useState } from 'react'
import { supabase, adminUsers } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { PageHead, Card, Loading, Empty, Badge, ReasonModal, useLoad, q, useAction } from '../../components/ui'
import TempPassword from '../../components/TempPassword'
import { dateTime } from '../../lib/format'

// Super admin: Operations leads. Operations lead: dispatch staff (shown on Riders & vehicles).
export function StaffTable({ rows, canManage, onReset, onToggle, busy }) {
  if (!rows.length) return <Empty>No staff yet.</Empty>
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((p) => (
        <tr key={p.id}>
          <td><strong>{p.full_name}</strong><div className="muted small">{p.email}</div></td>
          <td>{p.ops_lead ? 'Operations lead' : 'Dispatch staff'}</td>
          <td>{p.last_login ? dateTime(p.last_login) : 'Never'}</td>
          <td>{p.status === 'active' ? <Badge tone="good">Active</Badge> : <Badge tone="muted">Inactive</Badge>}</td>
          <td><div className="row nowrap">{canManage(p) && <>
            <button className="btn sm" disabled={busy} onClick={() => onReset(p)}>Reset password</button>
            <button className="btn sm" onClick={() => onToggle(p)}>{p.status === 'active' ? 'Deactivate' : 'Reactivate'}</button>
          </>}</div></td>
        </tr>
      ))}</tbody>
    </table></div>
  )
}

export function useStaffActions(reload) {
  const [run, busy] = useAction()
  const [shown, setShown] = useState(null)
  const [toggle, setToggle] = useState(null)
  const reset = async (p) => {
    const r = await run(() => adminUsers({ action: 'reset_password', user_id: p.id }), 'Password reset')
    if (r) setShown({ who: p.full_name, login: p.login || p.email, password: r.temp_password })
  }
  const modals = <>
    {shown && <TempPassword {...shown} onClose={() => setShown(null)} />}
    {toggle && (
      <ReasonModal title={`${toggle.status === 'active' ? 'Deactivate' : 'Reactivate'} ${toggle.full_name}?`} minLength={5}
        danger={toggle.status === 'active'} confirm={toggle.status === 'active' ? 'Deactivate' : 'Reactivate'} onClose={() => setToggle(null)}
        onSubmit={async (reason) => { await adminUsers({ action: 'set_status', user_id: toggle.id, status: toggle.status === 'active' ? 'inactive' : 'active', reason }); reload() }}>
        {toggle.status === 'active' && <p>They are signed out at once and cannot sign in until reactivated.</p>}
      </ReasonModal>
    )}
  </>
  return { run, busy, reset, setToggle, setShown, modals }
}

export default function Staff() {
  const { user } = useAuth()
  const list = useLoad(() => q(supabase.from('profiles').select('*').eq('role', 'operations').order('created_at')))
  const a = useStaffActions(() => list.reload())
  const [f, setF] = useState({ full_name: '', email: '' })
  const create = async (e) => {
    e.preventDefault()
    const r = await a.run(() => adminUsers({ action: 'create_staff', ...f }), 'Operations account created')
    if (r) { a.setShown({ who: f.full_name, login: r.login, password: r.temp_password }); setF({ full_name: '', email: '' }); list.reload() }
  }
  return (
    <>
      <PageHead title="Staff" sub="You create Operations leads. Leads then add dispatch staff and riders." />
      <div className="grid-main">
        <Card title="Operations staff" pad={false}>
          {list.loading || list.error ? <Loading error={list.error} /> :
            <StaffTable rows={list.data} busy={a.busy} canManage={(p) => p.id !== user.id && p.ops_lead} onReset={a.reset} onToggle={a.setToggle} />}
        </Card>
        <Card title="Add an Operations lead">
          <form className="stack" onSubmit={create}>
            <label className="field">Name<input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} required /></label>
            <label className="field">E-mail<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
            <button className="btn primary" disabled={a.busy}>Create Operations account</button>
          </form>
        </Card>
      </div>
      {a.modals}
    </>
  )
}
