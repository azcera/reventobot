import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, type Guild } from 'discord.js'
import type { Pool } from 'pg'
import type { Store } from '../src/types'
import { createMajesticSync } from '../src/services/majesticSync'

test('automatic Majestic sync writes one final audit entry on success and failure', async () => {
	for (const failed of [false, true]) {
		const audits: { action: string; details: Record<string, unknown> }[] = []
		const pool = { query: async () => ({ rows: [] }) } as unknown as Pool
		const store = {
			getSetting: (key: string) => key === 'MAJESTIC_AUTO_NICKNAMES' ? true : [],
			roleIds: () => [],
			audit: async (_actor: unknown, action: string, _target: string, details: Record<string, unknown>) => { audits.push({ action, details }) }
		} as unknown as Store
		const guild = { id: 'guild', roles: { fetch: async () => new Collection() }, members: { fetch: async () => new Collection() } } as unknown as Guild
		const sync = createMajesticSync({ pool, store, env: {}, logger: { error: () => {} }, readFamily: async () => {
			if (failed) throw new Error('Family unavailable')
			return { total: 1, items: [{ id: 1, login: 'Test Name', rankId: 1, rankName: 'Main' }] }
		} })
		await sync.autoNicknames(guild)
		await sync.wait(guild)
		assert.deepEqual(audits.map(entry => entry.action), ['majestic.sync'])
		assert.equal(audits[0].details.status, failed ? 'failed' : 'completed')
		assert.equal(typeof audits[0].details.runId, 'string')
	}
})
