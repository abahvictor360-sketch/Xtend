import assert from 'node:assert/strict'
import { loginDestination } from '@/lib/login-destination'
for (const value of [null, '', '//outside.example', 'https://outside.example', 'javascript:alert(1)', '/\\outside.example', '/\noutside.example', '/%2foutside.example', '/%5coutside.example', '/bad%escape', '/a/..//outside.example']) {
  assert.equal(loginDestination(value), '/', String(value))
}
for (const value of ['/', '/admin', '/field/history?d=2026-10-21#day', '/admin/users?q=Mary%20Jane']) {
  assert.equal(loginDestination(value), value)
}
console.log('ALL LOGIN DESTINATION CHECKS PASSED')
