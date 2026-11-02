// A small 3D delivery yard in pure CSS: an isometric floor, parcels that
// float and turn, and a truck that follows a route to a verified drop-off.
// No 3D library is loaded, and everything stops for reduced-motion users.

function Parcel({ size, x, y, z = 0, delay = 0, tone = 'gold', spin }) {
  return (
    <div
      className={`parcel tone-${tone} ${spin ? 'spin' : ''}`}
      style={{ '--s': `${size}px`, '--x': `${x}px`, '--y': `${y}px`, '--z': `${z}px`, '--d': `${delay}s` }}
    >
      <div className="cube">
        <span className="f front" /><span className="f back" /><span className="f right" />
        <span className="f left" /><span className="f top" /><span className="f bottom" />
      </div>
    </div>
  )
}

export default function AuthScene({ compact }) {
  return (
    <div className={`scene ${compact ? 'compact' : ''}`} aria-hidden="true">
      <div className="world">
        <div className="floor">
          <svg className="route" viewBox="0 0 400 400">
            <path id="ona-route" d="M40 340 C 120 330, 110 230, 190 220 S 300 120, 360 60" />
          </svg>
          <div className="truck"><span /></div>
          <div className="pin start" />
          <div className="pin end"><i>✓</i></div>
        </div>
        <Parcel size={70} x={70} y={70} delay={0} tone="gold" />
        <Parcel size={46} x={150} y={40} z={0} delay={0.8} tone="mint" />
        <Parcel size={38} x={60} y={160} delay={1.6} tone="coral" spin />
        <Parcel size={56} x={250} y={230} delay={0.4} tone="sky" />
        <Parcel size={30} x={300} y={150} delay={1.2} tone="gold" spin />
      </div>
      <div className="glow g1" />
      <div className="glow g2" />
    </div>
  )
}
