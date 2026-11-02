import toast from 'react-hot-toast'
import { Modal } from './ui'

// Shown once, right after an account is created or a password is reset.
export default function TempPassword({ who, login, password, onClose }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Sign in at ${window.location.origin}\nLogin: ${login}\nTemporary password: ${password}`)
      toast.success('Copied')
    } catch { toast.error('Copy blocked. Select the text instead.') }
  }
  return (
    <Modal title={`Sign-in details for ${who}`} onClose={onClose} footer={<>
      <button className="btn" onClick={copy}>Copy</button>
      <button className="btn primary" onClick={onClose}>Done</button>
    </>}>
      <div className="notice warn">This password is shown only once. Give it to {who} in person or by phone. They must change it when they first sign in.</div>
      <div className="stack">
        <div><div className="muted small">Login</div><div className="mono" style={{ fontSize: 16 }}>{login}</div></div>
        <div><div className="muted small">Temporary password</div><div className="mono" style={{ fontSize: 20, fontWeight: 600, userSelect: 'all' }}>{password}</div></div>
      </div>
    </Modal>
  )
}
