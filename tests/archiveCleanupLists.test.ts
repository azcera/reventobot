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
	t.mock.method(unanswered, 'getUnansweredList', async () => container('unanswered'))
	const message = (id: string, authorId: string, content: string, createdTimestamp: number) => ({ id, author: { id: authorId }, createdTimestamp,
		components: [{ toJSON: () => ({ type: 10, content }) }],
		edit: async (payload: any) => { edited.push(payload) }, delete: async () => { deleted.push(id) } })
	const messages = new Collection([
		['human', message('human', 'human', 'hello', 4)],
		['membership', message('membership', 'bot', '## В семье, но нет в Discord и привязках', 3)],
		['old', message('old', 'bot', 'previous archive list', 1)]
	])
	const channel = { type: ChannelType.GuildText, messages: { fetch: async () => messages }, send: async (payload: any) => { sent.push(payload) } }
	const guild = { client: { user: { id: 'bot' } }, channels: { cache: new Collection([['configured', channel]]) } } as unknown as Guild
	const first = updateLists(guild)
	const second = updateLists(guild)
	release()
	await Promise.all([first, second])
	assert.equal(runs, 2)
	assert.equal(maximum, 1)
	assert.equal(edited.length, 2)
	assert.ok(edited.every(payload => payload.components[0].toJSON().components[0].content === 'unused'))
	assert.deepEqual(sent.slice(0, 2).map(payload => payload.components[0].toJSON().components[0].content), ['archives', 'unanswered'])
	assert.deepEqual(deleted, [])
})
