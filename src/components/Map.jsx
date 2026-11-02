import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// OpenStreetMap through Leaflet. Points: [{ lat, lng, kind: 'pickup'|'drop'|'rider', label }]
const COLORS = { pickup: '#f2b705', drop: '#232c7a', rider: '#13734a' }
const LAGOS = [6.5244, 3.3792]

function icon(kind) {
  const c = COLORS[kind] || '#232c7a'
  const html = kind === 'rider'
    ? `<span style="display:block;width:18px;height:18px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 0 0 6px rgba(19,115,74,.25)"></span>`
    : `<svg width="26" height="34" viewBox="0 0 24 30"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 18 12 18s12-9 12-18C24 5.4 18.6 0 12 0z" fill="${c}" stroke="#fff" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="#fff"/></svg>`
  return L.divIcon({ html, className: '', iconSize: kind === 'rider' ? [18, 18] : [26, 34], iconAnchor: kind === 'rider' ? [9, 9] : [13, 34] })
}

export default function MapView({ points = [], tall, route = true }) {
  const el = useRef(null)
  const map = useRef(null)
  const layer = useRef(null)
  useEffect(() => {
    map.current = L.map(el.current, { zoomControl: true, attributionControl: true }).setView(LAGOS, 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current)
    layer.current = L.layerGroup().addTo(map.current)
    return () => map.current.remove()
  }, [])
  const key = JSON.stringify(points)
  useEffect(() => {
    const pts = points.filter((p) => p && p.lat != null && p.lng != null).map((p) => ({ ...p, lat: Number(p.lat), lng: Number(p.lng) }))
    layer.current.clearLayers()
    pts.forEach((p) => L.marker([p.lat, p.lng], { icon: icon(p.kind) }).bindTooltip(p.label || p.kind).addTo(layer.current))
    const stops = pts.filter((p) => p.kind !== 'rider')
    if (route && stops.length > 1) L.polyline(stops.map((p) => [p.lat, p.lng]), { color: '#232c7a', weight: 3, dashArray: '6 8', opacity: .7 }).addTo(layer.current)
    if (pts.length === 1) map.current.setView([pts[0].lat, pts[0].lng], 14)
    else if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { padding: [40, 40] })
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={el} className={`map ${tall ? 'tall' : ''}`} />
}
