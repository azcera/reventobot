import { Events, GuildMember } from 'discord.js'
import { store as dashboard } from '../dashboard/store'
import { getRegisteredArchive } from '../features/archive/archiveSearch'
import { getMemberIdentity, saveMemberStatic } from '../services/memberIdentity'
import { adminPrefix, stripRolePrefix } from '../utils/adminPrefix'
import { getError } from '../utils/errors'
import { parseDisplayName } from '../utils/parseDisplayName'

/**
 * Действия при добавлению участнику админ ролей
 *
 * @param {GuildMember} oldMember
 * @param {GuildMember} newMember
 */
let handleMakeAdmin = async (
	oldMember:
		| import('discord.js').GuildMember
		| import('discord.js').PartialGuildMember,
	newMember: import('discord.js').GuildMember
) => {
	const rolePrefixes = dashboard.getSetting('ROLE_PREFIXES')
	const prefixRoleIds = rolePrefixes.map(entry => entry.roleId)
	const oldHasAdmin = oldMember.roles.cache.filter(role =>
		prefixRoleIds.includes(role.id)
	)
	const newHasAdmin = newMember.roles.cache.filter(role =>
		prefixRoleIds.includes(role.id)
	)
	const addedRole = newHasAdmin.find(role => !oldHasAdmin.has(role.id))
	const removedRole = oldHasAdmin.find(role => !newHasAdmin.has(role.id))

	if (!addedRole && !removedRole) return

	const cleanName = stripRolePrefix(newMember.displayName, rolePrefixes)

	const newPrefix = adminPrefix(
		[...newMember.roles.cache.keys()],
		dashboard.roleIds('ADMIN_ROLES'),
		rolePrefixes
	)
	const finalNickname = `${newPrefix}${cleanName}`.slice(0, 32)

	if (newMember.displayName !== finalNickname && newMember.manageable) {
		await newMember.setNickname(finalNickname)
	}
}

/**
 * Действия при изменении никнейма
 *
 * @param {GuildMember} oldMember
 * @param {GuildMember} newMember
 */
let handleNameEdit = async (
	oldMember:
		| import('discord.js').GuildMember
		| import('discord.js').PartialGuildMember,
	newMember: import('discord.js').GuildMember
) => {
	if (oldMember.displayName === newMember.displayName) return

	const parsedNew = parseDisplayName(newMember.displayName)
	if (!parsedNew) return // новый ник тоже без | — выходим

	const newThreadName = [
		'archive',
		parsedNew.memberName.toLowerCase(),
		parsedNew.memberStatic.toLowerCase()
	].join(' ')

	const guild = newMember.guild
	if (!dashboard.ready) return
	const identity = await getMemberIdentity(guild.id, newMember.id)
	if (identity?.game_static !== parsedNew.memberStatic)
		await saveMemberStatic(guild.id, newMember.id, parsedNew.memberStatic)
	if (!identity?.archive_thread_id || !dashboard.getSetting('PARENT_CHANNEL_ID')) return
	const existingThread = await getRegisteredArchive(guild, identity.archive_thread_id)
	if (!existingThread?.isThread()) return

	// Если название уже правильное — ничего не делаем
	if (existingThread.name === newThreadName) {
		console.log('[NameEdit] Название ветки уже актуальное')
		return
	}

	if (!existingThread.manageable) {
		console.warn(
			`[NameEdit] Нет прав на переименование ветки ${existingThread.name}`
		)
		return
	}

	try {
		await existingThread.setName(newThreadName)
		console.log(
			`✅ Ветка переименована: "${existingThread.name}" → "${newThreadName}"`
		)
	} catch (caught) {
		const err = getError(caught)
		console.error('❌ Ошибка при переименовании ветки:', err.message)
	}
}

export = (client: import('discord.js').Client) => {
	client.on(
		Events.GuildMemberUpdate,
		/**
		 * Обработчик события GuildMemberUpdate
		 *
		 * @async
		 * @param {GuildMember} newMember
		 * @param {GuildMember} oldMember
		 *
		 */
		async (
			oldMember:
				| import('discord.js').GuildMember
				| import('discord.js').PartialGuildMember,
			newMember: import('discord.js').GuildMember
		) => {
			try {
				if (oldMember.partial) return
				await handleMakeAdmin(oldMember, newMember)
				await handleNameEdit(oldMember, newMember)
			} catch (caught) {
				const error = getError(caught)
				console.error('❌ Ошибка выполнения: ', error)
			}
		}
	)
}
