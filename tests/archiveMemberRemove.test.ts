import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Events, type Client } from 'discord.js'
import { store } from '../src/dashboard/store'
import * as cleanup from '../src/features/archive/unusedArchives'
import * as search from '../src/features/archive/archiveSearch'
import * as lists from '../src/features/archive/updateLists'
import register = require('../src/events/guildMemberRemove')

test('member departure respects the dashboard switch and deletes only the departing owners empty archives', async t => {
	t.mock.getter(store, 'ready', () => true)
	let enabled = false, refreshed = 0, scanned = 0
	const deleted: string[][] = []
	t.mock.method(store, 'getSetting', (key: string) => key === 'PARENT_CHANNEL_ID' ? 'parent' : enabled)
	t.mock.method(search, 'findArchiveByOwner', async () => {
		scanned++
		return { id: 'thread', isThread: () => true }
	})
	t.mock.method(cleanup, 'deleteEmptyArchive', async (thread: { id: string }, owner: string) => { deleted.push([thread.id, owner]); return true })
	t.mock.method(lists, 'updateLists', async () => { refreshed++ })
	let listener: (member: any) => Promise<void> = async () => {}
	register({ on: (event: string, handler: typeof listener) => { assert.equal(event, Events.GuildMemberRemove); listener = handler } } as unknown as Client)
	await listener({ id: 'departed', guild: {} })
	assert.equal(scanned, 0)
	assert.deepEqual(deleted, [])
	enabled = true
	await listener({ id: 'departed', guild: {} })
	assert.equal(scanned, 1)
	assert.deepEqual(deleted, [['thread', 'departed']])
	assert.equal(refreshed, 2)
})
