import pool = require('../src/services/database')
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ChannelType, Collection, ContainerBuilder, TextDisplayBuilder, type Guild } from 'discord.js'
import { store } from '../src/dashboard/store'
import * as unused from '../src/features/archive/archiveCleanupInteractions'
import * as archives from '../src/features/archive/archivesList'
import * as unanswered from '../src/features/archive/archiveUnansweredList'
import { updateLists } from '../src/features/archive/updateLists'

test('archive cleanup list is first; list updates preserve human and membership messages and serialize refreshes', async t => {
	const container = (text: string) => new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
	const sent: any[] = [], edited: any[] = [], deleted: string[] = []
	let runs = 0, concurrent = 0, maximum = 0
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
	const message = (id: string, authorId: string, content: string, createdTimestamp: number) => ({ id, author: { id: authorId }, createdTimestamp,
		components: [{ toJSON: () => ({ type: 10, content }) }],
		edit: async (payload: any) => { edited.push(payload) }, delete: async () => { deleted.push(id) } })
	const messages = new Collection([
		['human', message('human', 'human', 'hello', 4)],
		['membership', message('membership', 'bot', '## В семье, но нет в Discord и привязках', 3)],
		['old', message('old', 'bot', 'previous archive list', 1)],
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
	const channel = { id: 'configured', type: ChannelType.GuildText, messages: { fetch: async ({ message: id }: { message: string }) => {
		assert.ok(id, 'refresh must fetch only registered IDs')
		return messages.get(id)
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
	assert.equal(edited.length, 4)
	assert.equal(edited.filter(payload => payload.components[0].toJSON().components[0].content === 'unused').length, 2)
	assert.deepEqual(sent.map(payload => payload.components[0].toJSON().components[0].content), ['archives', 'unanswered'])
	assert.deepEqual(deleted, ['expired'])
})
