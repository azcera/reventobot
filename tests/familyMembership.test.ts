import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, type Guild, type GuildMember, type Client } from 'discord.js'
import type { Pool } from 'pg'
import type { MembershipSnapshot, Store, FamilyDismissal, FamilyMembers } from '../src/types'
import type { SyncState } from '../src/services/majesticTypes'
import { classify, createFamilyMembership, FRIEND_ROLE_ID } from '../src/services/familyMembership'
import { createMajesticSync } from '../src/services/majesticSync'
import { fetchDismissals, fetchMembers } from '../src/services/majesticClient'
import { createStore } from '../src/dashboard/store'
import type { DashboardState } from '../src/types'

const seenAt = Date.parse('2026-11-12T10:00:00.000Z')
const checkedAt = seenAt + 600000
const dismissal: FamilyDismissal = { id: 21344181, type: 'logs.family_log.uninviteFrom',
	date: new Date(seenAt + 1000).toISOString(), account: { id: 233366 } }

function member(id = 'discord'): GuildMember {
	return { id, nickname: 'Slavik | 233366', joinedTimestamp: seenAt - 10000,
		guild: { id: 'guild', ownerId: 'owner' }, user: { bot: false }, kickable: true,
		roles: { cache: new Collection([['role', { id: 'role' }]]) } } as unknown as GuildMember
}

function snapshot(): MembershipSnapshot {
	return { members: new Collection([['discord', member()]]), statics: new Set(['999']),
		linked: new Map([['discord', '233366']]), bindings: { discord: '233366' }, source: 'RU8/289229',
		confirmed: { discord: { static: '233366', seenAt, joinedAt: seenAt - 10000 } },
		dismissals: [structuredClone(dismissal)], autoKickSince: seenAt - 1000 }
}

test('only a new dismissal of account.id with prior confirmed membership permits automatic kick', () => {
	const report = classify(snapshot(), new Set(), true, checkedAt)
	assert.deepEqual(report.automatic.map(member => member.id), ['discord'])
	assert.equal(report.evidence.get('discord')?.eventId, dismissal.id)
})

const blocked: Record<string, (s: MembershipSnapshot) => void> = {
	'absence alone': s => { s.dismissals = [] },
	'legacy binding without observed membership': s => { delete s.confirmed },
	'old event before last confirmed presence': s => { s.confirmed!.discord.seenAt = checkedAt },
	'old event before tracking started': s => { s.autoKickSince = checkedAt },
	'no tracking baseline': s => { delete s.autoKickSince },
	'future event': s => { s.dismissals![0].date = new Date(checkedAt + 1).toISOString() },
	'actor is not the dismissed account': s => { s.dismissals![0].account.id = 132950 },
	'rejoined family': s => { s.statics.add('233366') },
	'new nickname points to current family member': s => { s.members.get('discord')!.nickname = 'Other | 999' },
	'conflicting nickname outside family': s => { s.members.get('discord')!.nickname = 'Other | 777' },
	'changed binding': s => { s.linked.set('discord', '777') },
	'rejoined Discord': s => { Object.assign(s.members.get('discord')!, { joinedTimestamp: seenAt + 500 }) },
	'duplicate static': s => { s.members.set('other', member('other')); s.linked.set('other', '233366') },
	'friend role': s => { s.members.get('discord')!.roles.cache.set(FRIEND_ROLE_ID, { id: FRIEND_ROLE_ID } as any) },
	'bot': s => { s.members.get('discord')!.user.bot = true },
	'guild owner': s => { Object.assign(s.members.get('discord')!.guild, { ownerId: 'discord' }) }
}
for (const [name, mutate] of Object.entries(blocked)) test(`automatic kick blocked: ${name}`, () => {
	const s = snapshot()
	mutate(s)
	assert.equal(classify(s, new Set(), true, checkedAt).automatic.length, 0)
})

test('disabled auto kick and active applications block automatic actions; absence stays manual', () => {
	assert.equal(classify(snapshot(), new Set(['discord']), true, checkedAt).automatic.length, 0)
	const report = classify(snapshot(), new Set(), false, checkedAt)
	assert.equal(report.automatic.length, 0)
	assert.deepEqual(report.manual.map(member => member.id), ['discord'])
})

function syncFixture(initial?: SyncState) {
	let state = initial
	let clock = seenAt
	let enabled = true
	let settingChangedAt = 0
	let events = [structuredClone(dismissal)]
	let roster: FamilyMembers = { total: 2, items: [233366, 999].map(id => ({ id, login: 'Test Name', rankId: 1, rankName: 'Main' })) }
	const calls: string[] = []
	const pool = { async query(sql: string, params?: unknown[]) {
		if (sql.startsWith('SELECT value')) return { rows: state ? [{ value: structuredClone(state) }] : [] }
		if (sql.startsWith('INSERT INTO majestic_sync_state')) state = JSON.parse(params![1] as string)
		return { rows: [] }
	} } as unknown as Pool
	const members = new Collection([['discord', member()]])
	const guild = { id: 'guild', members: { cache: members, fetch: async () => members } } as unknown as Guild
	const sync = createMajesticSync({ pool, store: { getSetting: () => enabled,
		get majesticAutoKickChangedAt() { return settingChangedAt } } as unknown as Store,
		env: { MAJESTIC_SERVER: 'RU8', MAJESTIC_CHARACTER_ID: '289229' }, now: () => clock,
		readFamily: async () => { calls.push('members'); return structuredClone(roster) },
		readDismissals: async () => { calls.push('logs'); return structuredClone(events) } })
	return { sync, guild, calls, members, get state() { return state! },
		setClock: (value: number) => { clock = value }, setEnabled: (value: boolean) => { enabled = value },
		setSettingChangedAt: (value: number) => { settingChangedAt = value },
		setEvents: (value: FamilyDismissal[]) => { events = value },
		leave: () => { roster = { total: 1, items: roster.items.filter(item => item.id !== 233366) } } }
}

test('persisted observations permit future dismissals across restarts, never bootstrap absent legacy bindings', async () => {
	const f = syncFixture()
	await f.sync.membershipSnapshot(f.guild)
	assert.equal(f.state.familyMembership?.confirmed?.discord.static, '233366')
	const restarted = syncFixture(f.state)
	restarted.leave()
	restarted.setClock(checkedAt)
	const current = await restarted.sync.membershipSnapshot(restarted.guild, { includeDismissals: true })
	assert.deepEqual(restarted.calls, ['logs', 'members'])
	assert.equal(classify(current, new Set(), true, checkedAt).automatic.length, 1)
	const legacy = syncFixture({ decisions: { discord: { static: '233366' } }, preview: null, run: null,
		familyMembership: { source: 'RU8/289229', bindings: { discord: '233366' } } })
	legacy.leave()
	legacy.setClock(checkedAt)
	const old = await legacy.sync.membershipSnapshot(legacy.guild, { includeDismissals: true })
	assert.equal(classify(old, new Set(), true, checkedAt).automatic.length, 0)
})

test('excluded decisions and duplicate nickname identities never establish kick evidence', async () => {
	for (const excluded of [true, false]) {
		const f = syncFixture({ decisions: { discord: { static: '233366', excluded } }, preview: null, run: null })
		if (!excluded) f.members.set('other', member('other'))
		await f.sync.membershipSnapshot(f.guild)
		assert.equal(f.state.familyMembership?.confirmed?.discord, undefined)
	}
})

test('disabled tracking uses no logs, and enabling starts a fresh baseline', async () => {
	const f = syncFixture()
	f.setEnabled(false)
	await f.sync.membershipSnapshot(f.guild, { includeDismissals: true })
	assert.deepEqual(f.calls, ['members'])
	f.leave()
	f.setClock(checkedAt)
	f.setEnabled(true)
	const current = await f.sync.membershipSnapshot(f.guild, { includeDismissals: true })
	assert.equal(current.autoKickSince, checkedAt)
	assert.equal(classify(current, new Set(), true, checkedAt).automatic.length, 0)
})

test('returning to the family makes a previous dismissal ineligible even after another absence', async () => {
	const f = syncFixture()
	await f.sync.membershipSnapshot(f.guild)
	f.setClock(checkedAt)
	await f.sync.membershipSnapshot(f.guild)
	f.leave()
	const current = await f.sync.membershipSnapshot(f.guild, { includeDismissals: true })
	assert.equal(classify(current, new Set(), true, checkedAt).automatic.length, 0)
})

test('off/on between polls invalidates events from the disabled period', async () => {
	const f = syncFixture()
	await f.sync.membershipSnapshot(f.guild)
	f.leave()
	f.setClock(checkedAt)
	f.setSettingChangedAt(checkedAt - 1000)
	const current = await f.sync.membershipSnapshot(f.guild, { includeDismissals: true })
	assert.equal(current.autoKickSince, checkedAt - 1000)
	assert.equal(classify(current, new Set(), true, checkedAt).automatic.length, 0)
})

test('auto kick switch timestamp persists, advances on toggles, and ignores unrelated settings', async () => {
	let row = { revision: 1, value: { templates: {}, settings: {}, settingsEnvMigrated: true } as DashboardState }
	const query = async (sql: string, params?: unknown[]) => {
		if (sql.startsWith('SELECT revision')) return { rows: [structuredClone(row)] }
		if (sql.startsWith('UPDATE dashboard_state')) row = { revision: row.revision + 1, value: JSON.parse(params![0] as string) }
		return { rows: [] }
	}
	const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool
	const store = createStore({})
	await store.init(pool)
	await store.save('settings', { MAJESTIC_AUTO_KICK: false }, store.revision)
	const disabledAt = store.majesticAutoKickChangedAt
	assert.ok(disabledAt > 0)
	await store.save('settings', { MAJESTIC_AUTO_KICK: true }, store.revision)
	const enabledAt = store.majesticAutoKickChangedAt
	assert.ok(enabledAt > disabledAt)
	await store.save('settings', { PING_CHANNEL_ID: 'channel' }, store.revision)
	assert.equal(store.majesticAutoKickChangedAt, enabledAt)
	const restarted = createStore({})
	await restarted.init(pool)
	assert.equal(restarted.majesticAutoKickChangedAt, enabledAt)
})

test('each automatic kick rechecks logs and roster; failures and rejoining cancel the action', async () => {
	for (const mode of ['kick', 'rejoin', 'error', 'fresh-discord', 'application', 'disabled', 'disabled-during-audit'] as const) {
		const s = snapshot()
		let reads = 0, kicks = 0, enabled = true
		const audits: unknown[][] = []
		const target = s.members.get('discord')!
		Object.assign(target, { kick: async () => { kicks++ } })
		const guild = { id: 'guild', ownerId: 'owner', members: {
			me: { permissions: { has: () => true } }, fetch: async () => {
				if (mode === 'fresh-discord') Object.assign(target, { joinedTimestamp: checkedAt })
				return target
			}
		}, channels: { fetch: async () => ({ isTextBased: () => true,
			messages: { fetch: async () => new Collection() }, send: async () => {} }) } } as unknown as Guild
		const service = createFamilyMembership({ client: { user: { id: 'bot' } } as Client,
			pool: { query: async () => ({ rows: mode === 'application' && reads > 1 ? [{ user_id: 'discord' }] : [] }) } as unknown as Pool,
			store: { getSetting: () => enabled, audit: async (...args: unknown[]) => {
				audits.push(args)
				if (mode === 'disabled-during-audit') enabled = false
			} } as unknown as Store,
			sync: { async membershipSnapshot(_guild, options) {
				assert.equal(options?.includeDismissals, true)
				reads++
				if (reads === 2) {
					if (mode === 'error') throw new Error('API unavailable')
					if (mode === 'rejoin') s.statics.add('233366')
					if (mode === 'disabled') enabled = false
				}
				return s
			} }, logger: { info() {}, error() {} }, now: () => checkedAt })
		await service.refresh(guild)
		assert.equal(reads, 2, mode)
		assert.equal(kicks, mode === 'kick' ? 1 : 0, mode)
		if (mode === 'kick') assert.equal((audits[0][3] as { eventId: number }).eventId, dismissal.id)
	}
})

const config = { sessionId: 'fixture-session', server: 'RU8', characterId: '289229' }
test('dismissal API uses the same session and reads account, never actionBy', async () => {
	const mock = (async (url, options) => {
		assert.match(String(url), /family\/logs\?limit=50&type=logs.family_log.uninviteFrom$/)
		assert.equal((options!.headers as Record<string, string>)['x-session'], config.sessionId)
		assert.equal((options!.headers as Record<string, string>).Cookie, 'sessionId=fixture-session')
		assert.equal(options!.redirect, 'error')
		return Response.json({ code: 200, status: true, result: { items: [{ ...dismissal, actionBy: { id: 132950 } }], hasMore: true, nextCursor: dismissal.id } })
	}) as typeof fetch
	assert.equal((await fetchDismissals(config, mock))[0].account.id, 233366)
})

test('invalid dismissal data and incomplete roster fail closed', async () => {
	const valid = { items: [dismissal], hasMore: false, nextCursor: null }
	for (const result of [null, { ...valid, hasMore: 'false' }, { ...valid, items: [dismissal, dismissal] },
		{ ...valid, items: [{ ...dismissal, type: 'other' }] }, { ...valid, items: [{ ...dismissal, account: null }] },
		{ ...valid, items: [{ ...dismissal, date: 'invalid' }] }]) {
		await assert.rejects(fetchDismissals(config, (async () => Response.json({ code: 200, status: true, result })) as typeof fetch))
	}
	await assert.rejects(fetchDismissals(config, (async () => new Response('', { status: 401 })) as typeof fetch))
	await assert.rejects(fetchMembers(config, (async () => Response.json({ code: 200, status: true, result: { total: 2, items: [] } })) as typeof fetch), /Неполный состав/)
})
