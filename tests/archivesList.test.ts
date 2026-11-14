import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, type Guild, type GuildMember, type Role, type ThreadChannel } from 'discord.js'
import { store } from '../src/dashboard/store'
import { getArchivesLists } from '../src/features/archive/archivesList'

function fixture(count: number, roleCount = 1) {
	const roles = new Collection<string, Role>(Array.from({ length: roleCount }, (_, i) => {
		const id = String(200000000000000000n + BigInt(i))
		return [id, { id, position: i } as Role]
	}))
	const members = new Collection<string, GuildMember>()
	const threads = new Collection<string, ThreadChannel>()
	for (let i = 0; i < count; i++) {
		const id = String(100000000000000000n + BigInt(i))
		const role = [...roles.values()][i % roleCount]
		members.set(id, { id, user: { bot: false }, displayName: i % 3 === 2 ? 'Daler' : `Siriel | ${i + 1}`,
			roles: { cache: new Collection([[role.id, role], ['auto', { id: 'auto', position: -1 } as Role]]) } } as GuildMember)
		if (i % 3 === 0) threads.set(id, { id, name: `archive siriel ${i + 1}` } as ThreadChannel)
	}
	const guild = { members: { cache: members, fetch: async () => members }, roles: { cache: roles },
		channels: { fetch: async () => ({ threads: { fetchActive: async () => ({ threads }),
			fetchArchived: async () => ({ threads: new Collection() }) } }) } } as unknown as Guild
	return { guild, members, roles }
}

test('archive sections omit repeated statuses and split large roles without losing members', async t => {
	t.mock.method(store, 'getSetting', (key: string) => key === 'AUTO_ROLE' ? 'auto' : '')
	for (const [count, roleCount] of [[3, 1], [900, 1], [60, 60]]) {
		const f = fixture(count, roleCount)
		t.mock.method(store, 'roleIds', (key: string) => key === 'ARCHIVE_GROUP_ROLES' ? [...f.roles.keys()] : [])
		const result = await getArchivesLists(f.guild)
		assert.ok(result)
		const texts = result.parts.flatMap(part => part.toJSON().components.flatMap(component =>
			component.type === 10 ? [component.content] : []))
		const text = texts.join('\n')
		assert.match(text, /### Архивы\n1\. <@100000000000000000> → <#100000000000000000>/)
		assert.match(text, /### Нет архива\n1\. <@100000000000000001>/)
		assert.match(text, /### Некорректный никнейм\n1\. <@100000000000000002>/)
		assert.doesNotMatch(text, /→ (нет архива|некорректный никнейм)|часть/)
		for (const id of f.members.keys()) assert.equal(text.split(`<@${id}>`).length - 1, 1)
		for (const part of result.parts) {
			const components = part.toJSON().components
			assert.ok(components.length + 1 <= 40)
			assert.ok(components.reduce((sum, component) => sum + (component.type === 10 ? component.content.length : 0), 0) <= 4000)
		}
		if (count === 900) assert.ok(result.count > 1)
	}
})
