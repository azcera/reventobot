import { test } from 'node:test'
import assert = require('node:assert/strict')
import { createApi, readAuthStatus } from '../frontend/src/lib/api'
import { createStore } from '../src/dashboard/store'

async function withResponse(value: unknown, work: (api: ReturnType<typeof createApi>) => Promise<void>, status = 200) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  try { await work(createApi(() => 'csrf', () => {})) } finally { globalThis.fetch = originalFetch }
}

test('frontend accepts the actual config snapshot without optional publication results', async () => {
  const snapshot = createStore().snapshot()
  await withResponse(snapshot, async api => {
    const config = await api('config')
    assert.equal(config.revision, snapshot.revision)
    assert.ok(config.templates.length > 0)
    assert.equal(config.syncResults, undefined)
  })
})

test('frontend accepts an MCL list without an optional access role and send success without source', async () => {
  const list = { id: 'list', title: 'Список', channelId: 'channel', roleId: 'role', addName: 'Добавить', removeName: 'Удалить' }
  await withResponse({ lists: [list], revision: 1 }, async api => assert.equal((await api('mcl-lists')).lists[0].accessRoleId, undefined))
  await withResponse({ success: true }, async api => assert.equal((await api('send-container', {})).success, true))
})

test('frontend rejects malformed successful API payloads before the editor consumes them', async () => {
  await withResponse({ templates: 'unexpected' }, async api => assert.rejects(api('config'), /неожиданный ответ/))
  await withResponse({ success: true }, async api => assert.rejects(api('majestic/preview', {}), /неожиданный ответ/))
  await assert.rejects(readAuthStatus(new Response('{"configured":"false"}')), /неожиданный ответ/)
})

test('frontend preserves server errors, invalidates unauthorized sessions and sends CSRF', async () => {
  const originalFetch = globalThis.fetch
  let unauthorized = 0
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.credentials, 'same-origin')
    assert.equal(new Headers(init?.headers).get('X-CSRF-Token'), 'csrf-token')
    return new Response('{"error":"Войдите через Discord."}', { status: 401 })
  }
  try {
    const api = createApi(() => 'csrf-token', () => { unauthorized++ })
    await assert.rejects(api('logout', {}), { message: 'Войдите через Discord.', status: 401 })
    assert.equal(unauthorized, 1)
  } finally { globalThis.fetch = originalFetch }
})
