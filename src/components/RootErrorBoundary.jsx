import { Component } from 'react'

// Last line of defence: if anything outside a page crashes, show what happened instead of a blank screen.
export default class RootErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) { console.error('Ọ̀nà crashed', error, info?.componentStack) }
  reset = () => {
    // clear this browser's saved sign-in and Ọ̀nà settings, then start again
    try { Object.keys(localStorage).filter((k) => k.startsWith('sb-') || k.startsWith('ona:')).forEach((k) => localStorage.removeItem(k)) } catch { /* ignore */ }
    window.location.assign('/login')
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="v-splash" role="alert">
        <div className="v-word">ọ̀nà</div>
        <div className="v-tag" style={{ maxWidth: 360, textAlign: 'center' }}>
          Something went wrong and this screen could not be shown.
          <div style={{ marginTop: 12, opacity: 0.7, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error)}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn sun" onClick={() => window.location.reload()}>Reload</button>
          <button className="btn" onClick={this.reset}>Sign out and start again</button>
        </div>
      </div>
    )
  }
}
