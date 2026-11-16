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
		const role = [...roles.values()][Math.floor(i * roleCount / count)]
		members.set(id, { id, user: { bot: false }, displayName: i % 3 === 2 ? 'Daler' : `Siriel | ${i + 1}`,
			roles: { cache: new Collection([[role.id, role], ['auto', { id: 'auto', position: -1 } as Role]]) } } as GuildMember)
		if (i % 3 === 0) threads.set(id, { id, name: `archive siriel ${i + 1}` } as ThreadChannel)
	}
	const guild = { members: { cache: members, fetch: async () => members }, roles: { cache: roles },
		channels: { fetch: async () => ({ threads: { fetchActive: async () => ({ threads }),
			fetchArchived: async () => ({ threads: new Collection() }) } }) } } as unknown as Guild
	return { guild, members, roles }
}

test('archive lists include moderators with role prefixes and preserve membership filters', async t => {
	const f = fixture(7)
	const members = [...f.members.values()]
	const adminRole = { id: 'admin', position: 10 } as Role
	for (const member of members.slice(0, 3)) {
		member.roles.cache.set(adminRole.id, adminRole)
		if (member.displayName.includes('|')) Object.assign(member, { displayName: `[Mod] ${member.displayName}` })
	}
	Object.assign(members[4].user, { bot: true })
	members[5].roles.cache.delete('auto')
	members[6].roles.cache.delete(f.roles.first()!.id)
	t.mock.method(store, 'getSetting', (key: string) => key === 'AUTO_ROLE' ? 'auto' : key === 'ROLE_PREFIXES' ? [{ roleId: 'admin', prefix: '[Mod]' }] : '')
	t.mock.method(store, 'roleIds', (key: string) => key === 'ARCHIVE_GROUP_ROLES' ? [...f.roles.keys()] : key === 'ADMIN_ROLES' ? ['admin'] : [])
	const result = await getArchivesLists(f.guild)
	assert.ok(result)
	const text = result.parts.flatMap(part => part.toJSON().components.flatMap(component =>
		component.type === 10 ? [component.content] : [])).join('\n')
	assert.match(text, /### Архивы\n1\. <@100000000000000000> → <#100000000000000000>/)
	assert.match(text, /### Нет архива\n1\. <@100000000000000001>/)
	assert.match(text, /### Некорректный никнейм\n1\. <@100000000000000002>/)
	for (const member of members.slice(0, 4)) assert.equal(text.split(`<@${member.id}>`).length - 1, 1)
	for (const member of members.slice(4)) assert.ok(!text.includes(`<@${member.id}>`))
})

test('archive sections omit repeated statuses and split large roles without losing members', async t => {
	t.mock.method(store, 'getSetting', (key: string) => key === 'AUTO_ROLE' ? 'auto' : '')
	for (const [count, roleCount] of [[3, 1], [900, 1], [60, 60], [180, 3]]) {
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
			const partText = components.flatMap(component => component.type === 10 ? [component.content] : []).join('\n')
			for (const id of f.roles.keys()) assert.ok(partText.split(`<@&${id}>`).length - 1 <= 1)
			assert.ok(components.length + 1 <= 40)
			assert.ok(components.reduce((sum, component) => sum + (component.type === 10 ? component.content.length : 0), 0) <= 4000)
		}
		if (count === 900) assert.ok(result.count > 1)
		if (count === 180) {
			assert.ok(result.count > 1)
			for (const roleId of f.roles.keys()) {
				const roleTexts = texts.filter(text => text.includes(`<@&${roleId}>`))
				assert.equal(roleTexts.length, 1, 'a role that fits must stay in one message')
				for (const heading of ['Архивы', 'Нет архива', 'Некорректный никнейм']) {
					assert.ok(roleTexts[0].includes(`### ${heading}`))
				}
			}
		}
	}
})
