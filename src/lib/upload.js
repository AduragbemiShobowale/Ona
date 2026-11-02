// Turns a customer's own spreadsheet (the Excel sheet they used to send by
// e-mail or WhatsApp) into order lines. Pure functions so they can be tested
// without a browser. Every line either matches one catalogue product or comes
// back with the exact problem, which the validation engine then reports.

const HEADERS = {
  sku: ['sku', 'code', 'item code', 'product code', 'item no', 'item number', 'part no', 'stock code', 'ref'],
  name: ['name', 'product', 'item', 'description', 'product name', 'item name', 'item description', 'goods'],
  qty: ['qty', 'quantity', 'qnty', 'quantities', 'units', 'no of units', 'amount', 'order qty', 'count', 'pcs'],
}

export const normalise = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

const words = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

function cell(v) {
  if (v == null) return ''
  if (typeof v === 'object' && 'toString' in v) return String(v).trim()
  return String(v).trim()
}

// Finds the header row (within the first 10 rows) and which column holds what.
export function detectColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r].map((c) => cell(c).toLowerCase())
    const find = (keys) => row.findIndex((h) => keys.includes(h) || keys.some((k) => h.replace(/[^a-z ]/g, '').trim() === k))
    const cols = { sku: find(HEADERS.sku), name: find(HEADERS.name), qty: find(HEADERS.qty) }
    if (cols.qty >= 0 && (cols.sku >= 0 || cols.name >= 0)) return { headerRow: r, ...cols }
  }
  return null
}

// Similarity of two product descriptions, 0..1 (token overlap, Dice).
export function similarity(a, b) {
  const A = new Set(words(a))
  const B = new Set(words(b))
  if (!A.size || !B.size) return 0
  let common = 0
  for (const w of A) if (B.has(w)) common++
  return (2 * common) / (A.size + B.size)
}

// Parses a quantity the way people type it: "20", "20 bags", "1,200".
export function parseQty(v) {
  if (typeof v === 'number') return v
  const s = cell(v).replace(/,/g, '')
  const m = s.match(/^-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : NaN
}

export function matchProduct(skuText, nameText, catalogue) {
  const sku = normalise(skuText)
  if (sku) {
    const exact = catalogue.find((p) => normalise(p.sku) === sku)
    if (exact) return { product: exact, how: 'sku' }
  }
  if (nameText) {
    const byName = catalogue.find((p) => normalise(p.name) === normalise(nameText))
    if (byName) return { product: byName, how: 'name' }
    const scored = catalogue
      .map((p) => ({ p, s: similarity(nameText, p.name) }))
      .sort((x, y) => y.s - x.s)
    const best = scored[0]
    const second = scored[1]
    // only accept a fuzzy match when it is clearly better than the runner-up
    if (best && best.s >= 0.75 && (!second || best.s - second.s >= 0.15)) return { product: best.p, how: 'similar' }
    if (best && best.s >= 0.4) return { product: null, suggestion: best.p }
  }
  return { product: null }
}

// rows: array of arrays (first sheet). Returns { items, unmatched, info }.
export function rowsToOrder(rows, catalogue) {
  const cols = detectColumns(rows)
  if (!cols) {
    return {
      items: [],
      unmatched: [],
      error: 'Could not find the columns. The sheet needs a quantity column and a SKU or product column (e.g. "SKU", "Description", "Qty").',
    }
  }
  const items = new Map()
  const unmatched = []
  const notes = []
  for (let r = cols.headerRow + 1; r < rows.length; r++) {
    const row = rows[r]
    const skuText = cols.sku >= 0 ? cell(row[cols.sku]) : ''
    const nameText = cols.name >= 0 ? cell(row[cols.name]) : ''
    const qtyRaw = row[cols.qty]
    if (!skuText && !nameText && (qtyRaw == null || cell(qtyRaw) === '')) continue // blank line
    const rowNo = r + 1
    if (/^(sub)?total/i.test(skuText) || /^(sub)?total/i.test(nameText)) continue

    const qty = parseQty(qtyRaw)
    const m = matchProduct(skuText, nameText, catalogue)
    if (!m.product) {
      unmatched.push({
        row: rowNo, sku: skuText, name: nameText, qty: cell(qtyRaw),
        problem: m.suggestion ? `not in the catalogue. Did you mean ${m.suggestion.sku} (${m.suggestion.name})?` : 'not in the catalogue',
      })
      continue
    }
    if (!Number.isFinite(qty)) {
      unmatched.push({ row: rowNo, sku: m.product.sku, name: nameText, qty: cell(qtyRaw), problem: 'Quantity is missing or not a number' })
      continue
    }
    if (m.how === 'similar') notes.push(`Row ${rowNo}: "${nameText}" read as ${m.product.sku} (${m.product.name}). Check it.`)
    const prev = items.get(m.product.id)
    if (prev) notes.push(`Row ${rowNo}: ${m.product.sku} appears more than once; quantities were added together.`)
    items.set(m.product.id, { product_id: m.product.id, qty: (prev?.qty || 0) + qty })
  }
  return { items: [...items.values()], unmatched, notes }
}

// Minimal CSV reader (quoted fields, commas or semicolons).
export function parseCsv(text) {
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === delim) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

// Pasted text from WhatsApp/e-mail: "20 bags cement 50kg", "ROD-12 x 10".
export function textToRows(text) {
  const rows = [['sku', 'name', 'qty']]
  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()
    if (!line) continue
    let m = line.match(/^([A-Za-z]{2,}-[A-Za-z0-9-]+)\s*[x×:\-–]?\s*(\d[\d,.]*)/)
    if (m) { rows.push([m[1], '', m[2]]); continue }
    m = line.match(/^(\d[\d,.]*)\s*(?:x|×|pcs|bags?|cartons?|lengths?|sheets?|rolls?|buckets?|units?|trips?)?\s+(?:of\s+)?(.+)$/i)
    if (m) { rows.push(['', m[2], m[1]]); continue }
    m = line.match(/^(.+?)\s*[x×:\-–]\s*(\d[\d,.]*)\s*\w*$/i)
    if (m) { rows.push(['', m[1], m[2]]); continue }
    rows.push(['', line, ''])
  }
  return rows
}
