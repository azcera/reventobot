import pool = require('../src/services/database')
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChannelType, Collection, ContainerBuilder, MessageFlags, SeparatorBuilder, TextDisplayBuilder, type Guild } from 'discord.js'
import { store } from '../src/dashboard/store'
import * as unused from '../src/features/archive/archiveCleanupInteractions'
import * as archives from '../src/features/archive/archivesList'
import * as unanswered from '../src/features/archive/archiveUnansweredList'
import { updateLists } from '../src/features/archive/updateLists'

test('the unanswered list skips a missing author without logging or retrying in the same cache window', async t => {
	t.mock.method(store, 'getSetting', () => 'parent')
	const log = t.mock.method(console, 'error', () => {})
	const fetchMember = t.mock.fn(async () => { throw Object.assign(new Error('Unknown Member'), { code: 10007 }) })
	const message = { createdTimestamp: Date.now(), author: { id: 'departed' } }
	const thread = { id: '1572939345772544064', lastMessageId: 'message',
		messages: { fetch: async () => new Collection([['message', message]]) } }
	const parent = { type: ChannelType.GuildText, threads: {
		fetchActive: async () => ({ threads: new Collection([[thread.id, thread]]) }) } }
	const guild = { members: { fetch: fetchMember }, channels: { cache: new Collection([['parent', parent]]) } } as unknown as Guild
	Object.assign(thread, { guild })

	for (let i = 0; i < 2; i++) {
		const list = await unanswered.getUnansweredList(guild)
		assert.ok(list?.length)
		assert.ok(!JSON.stringify(list.map(part => part.toJSON())).includes(thread.id))
	}
	assert.equal(fetchMember.mock.callCount(), 1)
	assert.equal(log.mock.callCount(), 0)
})

test('archive updates reuse old pages, remove duplicates, and publish new pages silently', async t => {
	const container = (text: string) => new ContainerBuilder()
		.addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
		.addSeparatorComponents(new SeparatorBuilder())
	const sent: any[] = [], edited: any[] = [], deleted: string[] = []
	let runs = 0, concurrent = 0, maximum = 0, historyReads = 0
	let release: () => void = () => {}
	const barrier = new Promise<void>(resolve => { release = resolve })
	t.mock.method(store, 'getSetting', () => 'configured')
	t.mock.method(unused, 'getUnusedArchiveLists', async () => {
		runs++; concurrent++; maximum = Math.max(maximum, concurrent)
		if (runs === 1) await barrier
		concurrent--
		return [container('unused')]
	})
	t.mock.method(archives, 'getArchivesLists', async () => ({ parts: [container('archives')], count: 1 }))
	t.mock.method(unanswered, 'getUnansweredList', async () => [container('unanswered')])
	const message = (id: string, authorId: string, content: string, createdTimestamp: number, webhookId?: string) => {
		const data = container(content).toJSON()
		return { id, author: { id: authorId }, createdTimestamp, webhookId,
			components: [{ type: data.type, toJSON: () => ({ id: 1, spoiler: false, accent_color: null, ...data,
				components: data.components.map((component, index) => component.type === 14
					? { divider: true, spacing: 1, ...component, id: index + 2 }
					: { ...component, id: index + 2 }) }) }],
			edit: async (payload: any) => { edited.push(payload) }, delete: async () => { deleted.push(id) } }
	}
	const messages = new Collection([
		['human', message('human', 'human', 'archives', 4)],
		['membership', message('membership', 'bot', '## В семье, но нет в Discord и привязках', 3)],
		['old', message('old', 'bot', 'previous archive list', 1)],
		['old-copy', message('old-copy', 'bot', 'previous archive list', 6)],
		['legacy', message('legacy', 'bot', 'archives', 5)],
		['webhook', message('webhook', 'bot', 'archives', 7, 'hook')],
		['unrelated', message('unrelated', 'bot', 'another bot publication', 2)],
		['expired', message('expired', 'bot', 'surplus archive page', 0)]
	])
	const registry = [
		{ message_id: 'old', type: 'unused', part: 1, channel_id: 'configured' },
		{ message_id: 'expired', type: 'unused', part: 2, channel_id: 'configured' }
	]
	t.mock.method(pool, 'query', async (sql: string, values: any[]) => {
		if (sql.trimStart().startsWith('SELECT')) return { rows: [...registry] }
		if (sql.startsWith('INSERT')) registry.push({ message_id: values[0], type: values[2], part: values[3], channel_id: values[5] })
		if (sql.startsWith('DELETE')) registry.splice(registry.findIndex(row => row.message_id === values[0]), 1)
		return { rows: [] }
	})
	const channel = { id: 'configured', type: ChannelType.GuildText, messages: { fetch: async ({ message: id }: { message?: string }) => {
		if (id) return messages.get(id)
		historyReads++
		return messages.filter(message => !deleted.includes(message.id))
	} }, send: async (payload: any) => {
		sent.push(payload)
		const sentMessage = message('new' + sent.length, 'bot', 'managed', 10 + sent.length)
		messages.set(sentMessage.id, sentMessage)
		return sentMessage
	} }
	const guild = { id: 'guild', client: { user: { id: 'bot' } }, channels: { cache: new Collection([['configured', channel]]) } } as unknown as Guild
	const first = updateLists(guild)
	const second = updateLists(guild)
	release()
	await Promise.all([first, second])
	assert.equal(runs, 2)
	assert.equal(maximum, 1)
	assert.equal(historyReads, 1)
	assert.equal(edited.length, 4)
	assert.equal(edited.filter(payload => payload.components[0].toJSON().components[0].content === 'unused').length, 2)
	assert.deepEqual(sent.map(payload => payload.components[0].toJSON().components[0].content), ['unanswered'])
	assert.equal(sent[0].flags, MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications)
	assert.ok(registry.some(row => row.message_id === 'legacy' && row.type === 'all' && row.part === 1))
	assert.deepEqual(deleted, ['expired', 'old-copy'])
})
