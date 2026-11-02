import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rowsToOrder, parseCsv, textToRows, parseQty, matchProduct, detectColumns } from '../src/lib/upload.js'

const catalogue = [
  { id: 'c', sku: 'CEM-50', name: 'Cement, 50 kg bag' },
  { id: 'r12', sku: 'ROD-12', name: 'Iron rod, 12 mm' },
  { id: 'r16', sku: 'ROD-16', name: 'Iron rod, 16 mm' },
  { id: 'pw', sku: 'PNT-20W', name: 'Emulsion paint, white, 20 L' },
]

test('finds a header row below a title', () => {
  const rows = [['Order from Adebayo Builders'], [], ['Item code', 'Description', 'Qty'], ['CEM-50', 'Cement', 20]]
  assert.deepEqual(detectColumns(rows), { headerRow: 2, sku: 0, name: 1, qty: 2 })
})

test('matches by SKU ignoring case and punctuation', () => {
  assert.equal(matchProduct('cem50', '', catalogue).product.id, 'c')
  assert.equal(matchProduct(' rod-12 ', '', catalogue).product.id, 'r12')
})

test('does not guess between two similar products', () => {
  const m = matchProduct('', 'iron rod', catalogue)
  assert.equal(m.product, null)
  assert.ok(m.suggestion)
})

test('accepts a clear name match', () => {
  assert.equal(matchProduct('', 'emulsion paint white 20 L', catalogue).product.id, 'pw')
})

test('builds items, merges repeats and reports every bad line', () => {
  const rows = [
    ['SKU', 'Description', 'Quantity'],
    ['CEM-50', '', '20 bags'],
    ['ROD-12', '', '10'],
    ['ROD-12', '', '5'],
    ['XYZ-9', 'Mystery item', '3'],
    ['ROD-16', '', 'ten'],
    ['', '', ''],
    ['Total', '', '38'],
  ]
  const out = rowsToOrder(rows, catalogue)
  assert.deepEqual(out.items, [{ product_id: 'c', qty: 20 }, { product_id: 'r12', qty: 15 }])
  assert.equal(out.unmatched.length, 2)
  assert.equal(out.unmatched[0].row, 5)
  assert.match(out.unmatched[0].problem, /not in the catalogue/)
  assert.match(out.unmatched[1].problem, /Quantity/)
  assert.equal(out.notes.length, 1)
})

test('keeps fractional quantities so the server can reject them', () => {
  const out = rowsToOrder([['sku', 'qty'], ['CEM-50', '2.5']], catalogue)
  assert.deepEqual(out.items, [{ product_id: 'c', qty: 2.5 }])
})

test('explains a sheet without the needed columns', () => {
  assert.ok(rowsToOrder([['a', 'b'], ['1', '2']], catalogue).error)
})

test('reads CSV with quotes and semicolons', () => {
  assert.deepEqual(parseCsv('sku;qty\n"CEM-50";"1,200"\r\n'), [['sku', 'qty'], ['CEM-50', '1,200']])
  assert.equal(parseQty('1,200'), 1200)
})

test('reads a pasted WhatsApp message', () => {
  const rows = textToRows('Good morning, please send:\n- 20 bags Cement, 50 kg bag\n2. ROD-12 x 10\nEmulsion paint, white, 20 L - 4')
  const out = rowsToOrder(rows, catalogue)
  assert.deepEqual(out.items.map((i) => [i.product_id, i.qty]), [['c', 20], ['r12', 10], ['pw', 4]])
  assert.equal(out.unmatched.length, 1) // the greeting line
})
