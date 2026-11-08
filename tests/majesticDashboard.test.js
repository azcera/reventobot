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
		preview: { id: 'preview', generatedAt: Date.now(), familyTotal: 1, summary: { change: 1, conflict: 1 }, rows: [
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

test('participant search matches nicknames, Discord ID and static together with the status filter', async () => {
	const b = browser()
	b.state.decisions.conflict = { static: '987654' }
	await b.context.loadMajestic()
	for (const query of [' SCRIPT ', 'mAyA', 'user', '1', '987654']) {
		b.$('majesticSearch').value = query
		b.$('majesticSearch').handlers.input()
		assert.equal(b.$('majesticRows').children.length, 1)
		assert.equal(b.$('majesticRows').children[0].tagName, 'ARTICLE')
	}
	b.$('majesticSearch').value = 'Maya'
	b.$('majesticFilter').value = 'conflict'
	b.$('majesticFilter').handlers.change()
	assert.match(b.$('majesticRows').children[0].textContent, /Нет участников/)
	b.$('majesticSearch').value = ''
	b.$('majesticSearch').handlers.input()
	assert.equal(b.$('majesticRows').children[0].tagName, 'ARTICLE')
	b.$('majesticFilter').value = 'all'
	b.$('majesticFilter').handlers.change()
	assert.equal(b.$('majesticRows').children.length, 2)
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

test('stale preview keeps its checkboxes visible and explains how to renew selection', async () => {
	const b = browser(); await b.context.loadMajestic()
	const checkbox = b.$('majesticRows').querySelectorAll('input').find(input => input.type === 'checkbox')
	checkbox.checked = true; checkbox.handlers.change()
	b.state.preview.invalidated = true
	await b.context.loadMajestic()
	const stale = b.$('majesticRows').querySelectorAll('input').find(input => input.type === 'checkbox')
	assert.ok(stale)
	assert.equal(stale.disabled, true)
	assert.match(b.$('majesticSelectionHint').textContent, /Обновить данные/)
	assert.equal(b.$('majesticApply').disabled, true)
})

test('refresh fetches a new preview when idle and only reads progress while a run is active', async () => {
	const b = browser(); await b.context.loadMajestic()
	await b.$('majesticRefresh').handlers.click()
	assert.ok(b.calls.some(call => call.operation === 'majestic/preview'))
	b.calls.length = 0
	b.state.busy = true; b.state.run = { kind: 'preview', status: 'running', completed: 0, total: 0 }
	vm.runInContext("location.hash = '#overview'", b.context)
	await b.context.loadMajestic()
	await b.$('majesticRefresh').handlers.click()
	assert.ok(b.calls.every(call => call.operation === 'majestic'))
})

test('status refresh preserves a valid selection and expiration blocks it without hiding it', async () => {
	const b = browser(); await b.context.loadMajestic()
	const checkbox = b.$('majesticRows').querySelectorAll('input').find(input => input.type === 'checkbox')
	checkbox.checked = true; checkbox.handlers.change()
	await b.context.loadMajestic()
	assert.equal(b.$('majesticApply').disabled, false)
	b.state.preview.generatedAt = Date.now() - 16 * 60 * 1000
	await b.context.loadMajestic()
	assert.equal(b.$('majesticSelect').disabled, true)
	assert.equal(b.$('majesticApply').disabled, true)
	assert.equal(b.$('majesticRows').querySelectorAll('input').find(input => input.type === 'checkbox').disabled, true)
})
