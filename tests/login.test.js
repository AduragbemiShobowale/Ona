import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginAddress, phoneFromLogin } from '../src/lib/login.js'

test('phone numbers become the rider login address', () => {
  assert.equal(loginAddress('0803 555 0142'), '2348035550142@rider.ona.invalid')
  assert.equal(loginAddress('+234 803 555 0142'), '2348035550142@rider.ona.invalid')
})
test('e-mails pass through, lower-cased', () => {
  assert.equal(loginAddress('  Ngozi@Example.com '), 'ngozi@example.com')
})
test('the phone can be shown back from the login address', () => {
  assert.equal(phoneFromLogin('2348035550142@rider.ona.invalid'), '08035550142')
  assert.equal(phoneFromLogin('a@b.com'), null)
})
