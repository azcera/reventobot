const { test } = require('node:test')
const assert = require('node:assert/strict')
const { loadDiscordMembers } = require('../src/services/discordMembers')

test('independent callers share pending loads, reuse the live cache and reload after thirty seconds', async () => {
	let clock = 0, requests = 0, release
	const cache = new Map([['first', {}]])
	const guild = { members: { cache, fetch: async options => {
		assert.deepEqual(options, { time: 30000 })
		requests++
		await new Promise(resolve => { release = resolve })
		return cache
	} } }
	const first = loadDiscordMembers(guild, { now: () => clock })
	const second = loadDiscordMembers(guild, { now: () => clock })
	assert.equal(requests, 1)
	release()
	assert.equal(await first, cache)
	assert.equal(await second, cache)
	cache.set('joined', {})
	clock = 29999
	assert.equal((await loadDiscordMembers(guild, { now: () => clock })).has('joined'), true)
	assert.equal(requests, 1)
	clock = 30000
	const next = loadDiscordMembers(guild, { now: () => clock })
	assert.equal(requests, 2)
	release()
	await next
})

test('failed loads reject all callers, allow recovery and do not share data between guilds', async () => {
	const failure = new Error('Discord unavailable')
	let requests = 0
	const guild = { members: { fetch: async () => { requests++; throw failure } } }
	const outcomes = await Promise.allSettled([loadDiscordMembers(guild), loadDiscordMembers(guild)])
	assert.equal(requests, 1)
	assert.ok(outcomes.every(result => result.status === 'rejected' && result.reason === failure))
	const members = new Map()
	guild.members.fetch = async () => { requests++; return members }
	assert.equal(await loadDiscordMembers(guild), members)
	assert.equal(requests, 2)
	const other = new Map([['other', {}]])
	assert.equal(await loadDiscordMembers({ members: { fetch: async () => other } }), other)
})
