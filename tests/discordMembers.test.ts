import { asMock } from './helpers/moduleStub'
export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
const { loadDiscordMembers }: typeof import("../src/services/discordMembers") = require('../src/services/discordMembers')

test('independent callers share pending loads, reuse the live cache and reload after thirty seconds', async () => {
	let clock = 0, requests = 0, release!: () => void
	const cache = new Map([['first', {}]])
	const guild = { members: { cache, fetch: async (options: { time: number }) => {
		assert.deepEqual(options, { time: 30000 })
		requests++
		await new Promise<void>(resolve => { release = resolve })
		return cache
	} } }
	const first = loadDiscordMembers(asMock(guild), { now: () => clock })
	const second = loadDiscordMembers(asMock(guild), { now: () => clock })
	assert.equal(requests, 1)
	release()
	assert.equal(await first, cache)
	assert.equal(await second, cache)
	cache.set('joined', {})
	clock = 29999
	assert.equal((await loadDiscordMembers(asMock(guild), { now: () => clock })).has('joined'), true)
	assert.equal(requests, 1)
	clock = 30000
	const next = loadDiscordMembers(asMock(guild), { now: () => clock })
	assert.equal(requests, 2)
	release()
	await next
})

test('failed loads reject all callers, allow recovery and do not share data between guilds', async () => {
	const failure = new Error('Discord unavailable')
	let requests = 0
	const guild = { members: { fetch: async (): Promise<Map<string, unknown>> => { requests++; throw failure } } }
	const outcomes = await Promise.allSettled([loadDiscordMembers(asMock(guild)), loadDiscordMembers(asMock(guild))])
	assert.equal(requests, 1)
	assert.ok(outcomes.every(result => result.status === 'rejected' && result.reason === failure))
	const members = new Map<string, unknown>()
	guild.members.fetch = async () => { requests++; return members }
	assert.equal(await loadDiscordMembers(asMock(guild)), members)
	assert.equal(requests, 2)
	const other = new Map([['other', {}]])
	assert.equal(await loadDiscordMembers(asMock({ members: { fetch: async () => other } })), other)
})
