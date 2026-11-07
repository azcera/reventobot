const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { readFileSync } = require('node:fs')
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

function browser() {
	const elements = new Map(), calls = []
	function element(tag, text = '') {
		return {
			tagName: tag.toUpperCase(), textContent: text, children: [], handlers: {}, value: '', disabled: false,
			append(...children) { this.children.push(...children) },
			replaceChildren(...children) { this.children = children },
			add(child) { this.children.push(child); if (!this.value) this.value = child.value },
			addEventListener(event, fn) { this.handlers[event] = fn },
			querySelectorAll(selector) {
				const tags = selector.toUpperCase().split(/,\s*/)
				return this.children.flatMap(child => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)])
			}
		}
	}
	const $ = id => {
		if (!elements.has(id)) elements.set(id, element('div'))
		return elements.get(id)
	}
	$('majesticFilter').value = 'issues'
	const state = { busy: false, configured: true, decisions: {}, rankRoles: {}, run: null,
		preview: { id: 'preview', generatedAt: 1, familyTotal: 1, summary: { change: 1, conflict: 1 }, rows: [
			{ discordId: 'user', currentNickname: '<script> | 1', status: 'change', static: '1', nickname: 'Maya | 1', addRoles: ['main'], removeRoles: [], currentRoleIds: [] },
			{ discordId: 'conflict', currentNickname: 'Other | 2', status: 'conflict', reason: 'Конфликт', currentRoleIds: [] }
		] } }
	const context = vm.createContext({ $, node: element, resources: { roles: [{ id: 'main', name: 'Main' }] }, location: { hash: '#majestic' },
		setTimeout, clearTimeout, notice() {}, Option: function (text, value) { return Object.assign(element('option', text), { value }) },
		api: async (operation, body) => { calls.push({ operation, body }); return structuredClone(state) } })
	vm.runInContext(readFileSync(require.resolve('../public/majestic.js'), 'utf8'), context)
	context.initMajestic()
	return { context, $, state, calls }
}

test('dashboard shows proposals and conflicts and applies only explicit selection with preview token', async () => {
	const b = browser(); await b.context.loadMajestic()
	assert.equal(b.$('majesticRows').children.length, 2)
	assert.equal(b.$('majesticApply').disabled, true)
	const checkbox = b.$('majesticRows').querySelectorAll('input').find(input => input.type === 'checkbox')
	assert.ok(checkbox)
	checkbox.checked = true; checkbox.handlers.change()
	assert.equal(b.$('majesticApply').disabled, false)
	await b.$('majesticApply').handlers.click()
	const apply = b.calls.find(call => call.operation === 'majestic/apply')
	assert.deepEqual(JSON.parse(JSON.stringify(apply.body)), { previewId: 'preview', discordIds: ['user'] })
	assert.ok(b.$('majesticRows').children[0].children[0].children.some(child => child.textContent === '<script> | 1'))
})

test('dashboard blocks applying invalidated previews and enables stopping active runs', async () => {
	const b = browser(); b.state.preview.invalidated = true
	await b.context.loadMajestic()
	assert.equal(b.$('majesticApply').disabled, true)
	assert.equal(b.$('majesticSelect').disabled, true)
	b.state.busy = true; b.state.run = { kind: 'apply', status: 'running', completed: 1, total: 2, results: [] }
	// Avoid scheduling a real poll in this DOM fixture.
	vm.runInContext("location.hash = '#overview'", b.context)
	await b.context.loadMajestic()
	assert.equal(b.$('majesticStop').disabled, false)
	assert.equal(b.$('majesticPreview').disabled, true)
	assert.equal(b.$('majesticApply').disabled, true)
})
