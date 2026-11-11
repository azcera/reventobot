export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
const { createFixture } = require('./helpers/dashboardFixture')

test('Majestic endpoints require administrator session and CSRF, and do not expose credentials', async t => {
	const f = await createFixture(); t.after(() => f.close())
	assert.equal((await f.request('/api/majestic')).status, 401)
	await f.login()
	for (const operation of ['preview', 'apply', 'resolve', 'stop']) {
		assert.equal((await f.request('/api/majestic/' + operation, { body: {}, headers: { 'X-CSRF-Token': '' } })).status, 403)
	}
	const response = await f.request('/api/majestic')
	assert.equal(response.status, 200)
	const state = await response.json()
	assert.equal(state.busy, false)
	assert.ok(state.rankRoles.Dep)
	assert.ok(!JSON.stringify(state).includes('MAJESTIC_SESSION_ID'))
	assert.equal((await f.request('/api/majestic/resolve', { body: { discordId: 'invalid' } })).status, 400)
	f.setAdmin(false)
	assert.equal((await f.request('/api/majestic')).status, 403)
})
