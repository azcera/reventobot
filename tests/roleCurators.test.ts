import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Collection, MessageFlags, ApplicationCommandType, type Client, type Guild, type UserContextMenuCommandInteraction, type ButtonInteraction } from 'discord.js'
import type { Pool } from 'pg'
import type { RoleCurator, Store } from '../src/types'
import { createRoleCurators, ROLE_CURATOR_COMMAND } from '../src/services/roleCurators'

const guildId = '100000000000000001', actorId = '100000000000000002', targetId = '100000000000000003'
const curatorId = '100000000000000004', roleId = '100000000000000005', otherId = '100000000000000006'

function fixture() {
	let curators: Record<string, RoleCurator> = { [curatorId]: { roleId: curatorId, managedRoleIds: [roleId] } }
	let actorRoles = new Set([curatorId]), targetRoles = new Set([otherId]), canWrite = true
	const changes: { action: string; roleId: string; reason: string }[] = [], replies: any[] = [], edits: any[] = []
	const requests: string[] = [], registered = new Set<string>(), messages: any[] = []
	const roles = new Collection<string, any>([curatorId, roleId, otherId].map(id => [id, { id, editable: true, managed: false }]))
	const remote = new Collection<string, any>()
	const commands = new Collection<string, any>()
	const guild = {
		id: guildId, roles: { cache: roles, fetch: async () => roles },
		channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: async (id: string) => messages.find(message => message.id === id) } }) },
		commands: {
			fetch: async () => remote.clone(),
			create: async (data: any) => { requests.push('create'); const command = { id: 'new', ...data, delete: async () => { remote.delete('new') } }; remote.set('new', command); return command }
		},
		members: { fetch: async ({ user, force }: { user: string; force: boolean }) => {
			assert.equal(force, true)
			const ids = user === actorId ? actorRoles : targetRoles
			return { id: user, guild, permissions: { has: () => true }, permissionsIn: () => ({ has: () => canWrite }), roles: {
				cache: new Collection([...ids].map(id => [id, roles.get(id)])),
				add: async (id: string, reason: string) => { changes.push({ action: 'add', roleId: id, reason }); targetRoles.add(id) },
				remove: async (id: string, reason: string) => { changes.push({ action: 'remove', roleId: id, reason }); targetRoles.delete(id) }
			} }
		} }
	}
	const pool = { query: async (sql: string, values: any[] = []) => {
		if (sql.startsWith('SELECT name')) return { rows: [...registered].map(name => ({ name })) }
		if (sql.startsWith('INSERT INTO mcl_commands')) registered.add(values[1])
		if (sql.startsWith('DELETE FROM mcl_commands')) registered.delete(values[1])
		if (sql.startsWith('SELECT channel_id')) return { rows: messages.map(message => ({ channel_id: 'channel', message_id: message.id })) }
		if (sql.startsWith('DELETE FROM mcl_messages')) requests.push('forget-message')
		return { rows: [] }
	} } as unknown as Pool
	const store = { get roleCurators() { return structuredClone(curators) }, revision: 0,
		save: async (_section: string, values: any, revision: number) => {
			if (revision !== store.revision) throw new Error('stale revision')
			for (const [id, value] of Object.entries(values)) if (value === null) delete curators[id]; else curators[id] = value as RoleCurator
			store.revision++
		} }
	const client = { commands, user: { id: 'bot' } } as unknown as Client
	const service = createRoleCurators({ client, pool, store: store as unknown as Store, env: { GUILD_ID: guildId } })
	const interaction = {
		guildId, guild, user: { id: actorId }, targetId, channel: { isThread: () => false },
		isUserContextMenuCommand: () => true,
		deferReply: async (payload: any) => { replies.push(payload) },
		reply: async (payload: any) => { replies.push(payload) },
		deferUpdate: async () => {},
		editReply: async (payload: any) => { edits.push(JSON.parse(JSON.stringify(payload))) }
	}
	return { service, guild: guild as unknown as Guild, commands, remote, registered, requests, messages, changes, replies, edits, roles,
		interaction: interaction as unknown as UserContextMenuCommandInteraction<'cached'>,
		setActorRoles(value: string[]) { actorRoles = new Set(value) }, setCurators(value: Record<string, RoleCurator>) { curators = value },
		setCanWrite(value: boolean) { canWrite = value }, targetRoles, store,
		async open() { await service.sync(guild as unknown as Guild); await commands.get(ROLE_CURATOR_COMMAND).execute(interaction) },
		async click(action = 'add', id = roleId, page = 0, owner = actorId) {
			await service.handle({ ...interaction, customId: `role_curator_${action}_${owner}_${targetId}_${id}_${page}` } as unknown as ButtonInteraction<'cached'>)
		} }
}

function buttons(payload: any): any[] {
	const found: any[] = []
	const visit = (value: any) => { if (!value || typeof value !== 'object') return; if (value.custom_id) found.push(value); if (value.accessory) visit(value.accessory); for (const component of value.components || []) visit(component) }
	visit(payload)
	return found
}

test('one context command opens a private status panel; add/remove preserve unrelated roles and refresh buttons', async () => {
	const f = fixture()
	await f.open()
	assert.equal(f.commands.size, 1)
	assert.equal(f.replies[0].flags, MessageFlags.Ephemeral)
	assert.equal(f.edits[0].flags, MessageFlags.IsComponentsV2)
	assert.match(JSON.stringify(f.edits[0]), /нет/)
	assert.equal(buttons(f.edits[0])[0].label, 'Добавить')
	await f.click()
	assert.deepEqual([...f.targetRoles], [otherId, roleId])
	assert.equal(buttons(f.edits.at(-1))[0].label, 'Убрать')
	assert.match(f.changes[0].reason, new RegExp(actorId))
	await f.click('remove')
	assert.deepEqual([...f.targetRoles], [otherId])
	assert.equal(buttons(f.edits.at(-1))[0].label, 'Добавить')
})

test('non-curators including administrators are denied; revoked role/config and forged targets cannot mutate roles', async () => {
	const f = fixture()
	f.setActorRoles([])
	await f.open()
	assert.match(f.edits.at(-1).content, /только настроенным кураторам/)
	f.setActorRoles([curatorId])
	await f.click('add', otherId)
	assert.match(JSON.stringify(f.edits.at(-1)), /больше нет доступа/)
	f.setCurators({})
	await f.click()
	assert.match(JSON.stringify(f.edits.at(-1)), /только настроенным кураторам/)
	f.setCurators({ [curatorId]: { roleId: curatorId, managedRoleIds: [roleId] } })
	f.setActorRoles([])
	await f.click()
	assert.match(JSON.stringify(f.edits.at(-1)), /только настроенным кураторам/)
	await f.click('add', roleId, 0, targetId)
	assert.match(f.replies.at(-1).content, /панель недоступна/)
	assert.deepEqual(f.changes, [])
})

test('current channel permission and bot hierarchy are checked at every click', async () => {
	const f = fixture()
	await f.open()
	f.setCanWrite(false)
	await f.click()
	assert.match(JSON.stringify(f.edits.at(-1)), /можете писать/)
	f.setCanWrite(true)
	f.roles.get(roleId).editable = false
	await f.click()
	assert.match(JSON.stringify(f.edits.at(-1)), /Бот не может/)
	f.roles.get(roleId).editable = true
	f.roles.get(roleId).managed = true
	await f.click()
	assert.deepEqual(f.changes, [])
})

test('duplicate concurrent add clicks are idempotent; curator role permissions are combined and paginated', async () => {
	const f = fixture()
	await f.open()
	await Promise.all([f.click(), f.click()])
	assert.equal(f.changes.length, 1)
	const ids = Array.from({ length: 8 }, (_, i) => String(BigInt('200000000000000000') + BigInt(i)))
	for (const id of ids) f.roles.set(id, { id, editable: true, managed: false })
	f.setActorRoles([curatorId, otherId])
	f.setCurators({ [curatorId]: { roleId: curatorId, managedRoleIds: ids.slice(0, 5) }, [otherId]: { roleId: otherId, managedRoleIds: ids.slice(4) } })
	await f.click('page', '0', 0)
	assert.equal(buttons(f.edits.at(-1)).filter(button => button.label === 'Добавить').length, 5)
	await f.click('page', '0', 1)
	assert.equal(buttons(f.edits.at(-1)).filter(button => button.label === 'Добавить').length, 3)
	assert.match(JSON.stringify(f.edits.at(-1)), /2\/2/)
})

test('synchronization removes only tracked old commands and bot list messages; repeated sync keeps one command', async () => {
	const f = fixture()
	f.registered.add('Old list command')
	f.remote.set('old', { id: 'old', name: 'Old list command', type: ApplicationCommandType.User, delete: async () => { f.requests.push('delete-old'); f.remote.delete('old') } })
	f.remote.set('archive', { id: 'archive', name: 'Открыть архив', type: ApplicationCommandType.User })
	f.messages.push({ id: 'old-message', author: { id: 'bot' }, delete: async () => { f.requests.push('delete-message') } })
	await f.service.sync(f.guild)
	assert.ok(f.requests.indexOf('delete-old') < f.requests.indexOf('create'))
	assert.ok(f.requests.includes('delete-message'))
	assert.ok(f.remote.has('archive'))
	assert.deepEqual([...f.registered], [ROLE_CURATOR_COMMAND])
	await f.service.sync(f.guild)
	assert.equal(f.commands.size, 1)
	assert.equal(f.remote.filter(command => command.name === ROLE_CURATOR_COMMAND).size, 1)
})

test('saving replaces curator rules with revision checks, rejects invalid roles and reports partial sync failures', async () => {
	const f = fixture()
	const result = await f.service.save(f.guild, [{ roleId: otherId, managedRoleIds: [roleId] }], 0, { id: actorId })
	assert.equal(result.revision, 1)
	assert.deepEqual(result.curators, [{ roleId: otherId, managedRoleIds: [roleId] }])
	await assert.rejects(f.service.save(f.guild, [], 0), /stale revision/)
	await assert.rejects(f.service.save(f.guild, [{ roleId: otherId, managedRoleIds: ['missing'] }], 1), /Бот не может/)
	const create = f.guild.commands.create
	f.guild.commands.create = (async () => { throw new Error('Discord unavailable') }) as any
	await assert.rejects(f.service.save(f.guild, [], 1), /Настройки сохранены/)
	assert.deepEqual(f.store.roleCurators, {})
	f.guild.commands.create = create
	await f.service.sync(f.guild)
})

test('first registration can recover after Discord created the command but its response was lost', async () => {
	const f = fixture()
	const create = f.guild.commands.create.bind(f.guild.commands)
	f.guild.commands.create = (async (data: any) => { await create(data); throw new Error('response lost') }) as any
	await assert.rejects(f.service.sync(f.guild), /response lost/)
	assert.ok(f.registered.has(ROLE_CURATOR_COMMAND))
	f.guild.commands.create = create as any
	await f.service.sync(f.guild)
	assert.equal(f.remote.filter(command => command.name === ROLE_CURATOR_COMMAND).size, 1)
})

test('legacy cleanup preserves foreign messages and their tracking when deletion is unsafe', async () => {
	const f = fixture()
	let deleted = false
	f.messages.push({ id: 'foreign', author: { id: 'someone-else' }, delete: async () => { deleted = true } })
	await assert.rejects(f.service.sync(f.guild), /другому автору/)
	assert.equal(deleted, false)
	assert.equal(f.requests.includes('forget-message'), false)
})
