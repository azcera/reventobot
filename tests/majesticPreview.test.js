const { test } = require('node:test')
const assert = require('node:assert/strict')
const { rankRoles, buildPreview } = require('../src/features/majestic/syncPreview')
const { readConfig, fetchMembers } = require('../scripts/check-majestic')

const character = (rankName = 'Main') => ({ id: 231542, login: 'Maya Well', rankName, rankId: 1 })
const member = (roleIds = [], nickname = 'Old | 231542') => ({ id: 'discord-user', nickname, roleIds })
const preview = (rank, roles, nickname) => buildPreview([character(rank)], [member(roles, nickname)])[0]

test('nickname preserves admin prefix, static and optional text without surname', () => {
	const row = preview('Main', [rankRoles.Main], '[𝐃𝐞𝐩] Old | 231542 / afk')
	assert.equal(row.nickname, '[𝐃𝐞𝐩] Maya | 231542 / afk')
	assert.deepEqual(row.addRoles, [])
	assert.deepEqual(row.removeRoles, [])
})

test('rank changes replace only managed roles in both directions', () => {
	for (const [from, to] of [['Farm', 'Dep'], ['High', 'Test']]) {
		const row = preview(to, [rankRoles[from], 'unrelated-role'])
		assert.deepEqual(row.addRoles, [rankRoles[to]])
		assert.deepEqual(row.removeRoles, [rankRoles[from]])
	}
})

test('each existing Tier replaces ordinary and other Tier game ranks', () => {
	for (const tier of ['Tier 1', 'Tier 2', 'Tier 3']) {
		for (const gameRank of ['Test', 'Tier 1', 'Tier 2', 'Tier 3', 'Leader', 'Own.dep']) {
			const row = preview(gameRank, [rankRoles[tier], rankRoles.Main, 'unrelated-role'])
			assert.equal(row.preservedTier, true)
			assert.deepEqual(row.addRoles, [])
			assert.deepEqual(row.removeRoles, [rankRoles.Main])
		}
	}
})

test('Dep, High and Recruit coexist with each Tier and replace other rank roles', () => {
	for (const rank of ['Dep', 'High', 'Recruit']) {
		for (const tier of ['Tier 1', 'Tier 2', 'Tier 3']) {
			const retained = preview(rank, [rankRoles[rank], rankRoles[tier], 'unrelated-role'], 'Maya | 231542')
			assert.equal(retained.status, 'unchanged')
			assert.deepEqual(retained.addRoles, [])
			assert.deepEqual(retained.removeRoles, [])
			const otherAdmin = rank === 'Dep' ? 'High' : 'Dep'
			const changed = preview(rank, [rankRoles[tier], rankRoles[otherAdmin], rankRoles.Main, 'unrelated-role'])
			assert.deepEqual(changed.addRoles, [rankRoles[rank]])
			assert.deepEqual(changed.removeRoles, [rankRoles[otherAdmin], rankRoles.Main])
			assert.equal(changed.preservedTier, true)
			assert.equal(preview(rank, [rankRoles['Tier 1'], rankRoles['Tier 2']]).status, 'conflict')
		}
	}
})

test('changing admin rank with a retained Tier updates the prefix and keeps optional text', () => {
	const row = buildPreview([character('Dep')], [member([rankRoles.High, rankRoles['Tier 2']], '[𝐇𝐢𝐠𝐡] Maya | 231542 / afk')], {
		adminRoleIds: [rankRoles.Dep, rankRoles.High, rankRoles.Recruit]
	})[0]
	assert.equal(row.nickname, '[𝐃𝐞𝐩] Maya | 231542 / afk')
	assert.deepEqual(row.addRoles, [rankRoles.Dep])
	assert.deepEqual(row.removeRoles, [rankRoles.High])
})

test('game Tier is assigned when no Discord Tier exists', () => {
	const row = preview('Tier 2', [rankRoles.Main])
	assert.deepEqual(row.addRoles, [rankRoles['Tier 2']])
	assert.deepEqual(row.removeRoles, [rankRoles.Main])
})

test('multiple Tier roles and duplicate Discord statics require manual resolution', () => {
	assert.equal(preview('Main', [rankRoles['Tier 1'], rankRoles['Tier 3']]).status, 'conflict')
	const rows = buildPreview([character()], [member(), { ...member(), id: 'second-user' }])
	assert.ok(rows.every(row => row.status === 'conflict'))
})

test('ignored and unknown ranks do not replace roles', () => {
	for (const rank of ['Leader', 'Own.dep']) {
		assert.deepEqual(preview(rank, [rankRoles.Dep]).removeRoles, [])
		assert.deepEqual(preview(rank, [rankRoles.Dep]).addRoles, [])
		assert.equal(preview(rank, [rankRoles.Dep, rankRoles.Main]).status, 'conflict')
	}
	assert.equal(preview('Unknown', [rankRoles.Main]).status, 'conflict')
	assert.deepEqual(preview('Test ', []).addRoles, [rankRoles.Test])
})

test('absent characters, invalid nicknames and bots do not cause changes', () => {
	assert.equal(buildPreview([], [member()])[0].status, 'skipped')
	assert.equal(preview('Main', [], 'Missing static').status, 'skipped')
	assert.deepEqual(buildPreview([character()], [{ ...member(), bot: true }]), [])
})

test('long nicknames are reported without truncating static or suffix', () => {
	assert.equal(preview('Main', [], `X | 231542 / ${'a'.repeat(25)}`).status, 'conflict')
})

test('second preview after applying a normal plan has no remaining changes', () => {
	const row = preview('Main', [rankRoles.Test])
	const next = preview('Main', [rankRoles.Main], row.nickname)
	assert.equal(next.status, 'unchanged')
	assert.equal(next.nickname, null)
	assert.deepEqual(next.addRoles, [])
	assert.deepEqual(next.removeRoles, [])
})

test('Majestic reader retains full items and rejects partial or duplicate snapshots', async () => {
	const config = { server: 'RU8', characterId: '289229', sessionId: 'fake' }
	const response = (total, items) => async () => ({ ok: true, status: 200,
		json: async () => ({ code: 200, status: true, result: { total, items } }) })
	assert.deepEqual(await fetchMembers(config, response(1, [character()])), { total: 1, items: [character()] })
	await assert.rejects(fetchMembers(config, response(2, [character()])), /Неполный состав/)
	await assert.rejects(fetchMembers(config, response(2, [character(), character()])), /повторяющиеся static/)
})

test('one session variable supplies both Cookie and x-session', async () => {
	const config = readConfig({ MAJESTIC_SESSION_ID: 'one-session', MAJESTIC_SERVER: 'RU8', MAJESTIC_CHARACTER_ID: '289229' })
	await fetchMembers(config, async (url, options) => {
		assert.equal(options.headers.Cookie, 'sessionId=one-session')
		assert.equal(options.headers['x-session'], 'one-session')
		return { ok: true, status: 200, json: async () => ({ code: 200, status: true, result: { total: 1, items: [character()] } }) }
	})
	assert.throws(() => readConfig({}), /MAJESTIC_SESSION_ID/)
})
