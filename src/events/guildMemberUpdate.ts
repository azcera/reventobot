import { getError } from '../utils/errors'
import { store as dashboard } from '../dashboard/store'
import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	roleMention,
	GuildMember,
	Events
} from 'discord.js'
import { parseDisplayName } from '../utils/parseDisplayName'
import { adminPrefix } from '../utils/adminPrefix'


/**
 * Действия при добавлению участнику админ ролей
 *
 * @param {GuildMember} oldMember
 * @param {GuildMember} newMember
 */
let handleMakeAdmin = async (oldMember: import('discord.js').GuildMember | import('discord.js').PartialGuildMember, newMember: import('discord.js').GuildMember) => {
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

	const cleanName = newMember.displayName.replace(/^\[[^\]]*\]\s*/, '').trim()

	const newPrefix = adminPrefix([...newMember.roles.cache.keys()], dashboard.roleIds('ADMIN_ROLES'), rolePrefixes)
	const finalNickname = `${newPrefix}${cleanName}`.slice(0, 32)

	if (newMember.displayName !== finalNickname && newMember.manageable) {
		await newMember.setNickname(finalNickname)
	}
}

/**
 * Действия при добавлении роли REVENTO
 *
 * @param {GuildMember} oldMember
 * @param {GuildMember} newMember
 * @param {string} channelName
 */
let handleMakeRevento = async (oldMember: import('discord.js').GuildMember | import('discord.js').PartialGuildMember, newMember: import('discord.js').GuildMember) => {
	const hadRoleBefore = oldMember.roles.cache.has(dashboard.getSetting('AUTO_ROLE'))
	const hasRoleNow = newMember.roles.cache.has(dashboard.getSetting('AUTO_ROLE'))

	// Реагируем только на выдачу роли
	if (hadRoleBefore || !hasRoleNow) return

	const parsedData = parseDisplayName(newMember.displayName)
	if (!parsedData) {
		console.log('❌ Ник не по форме, пропускаем создание архива')
		return
	}

	const threadName = [
		'archive',
		parsedData.memberName.toLowerCase(),
		parsedData.memberStatic.toLowerCase()
	].join(' ')

	const parentId = dashboard.getSetting('PARENT_CHANNEL_ID')

	// Сначала ищем, есть ли уже такая ветка
	const existingThread = newMember.guild.channels.cache.find(
		channel =>
			channel.isThread() &&
			channel.parentId === parentId &&
			channel.name === threadName
	)

	// Если ветка уже есть — ничего не делаем
	if (existingThread) {
		console.log(`Ветка "${threadName}" уже существует`)
		return
	}

	// Ветки нет → отправляем уведомление
	const messagesChannel = newMember.guild.channels.cache.get(
		dashboard.getSetting('LOG_CHANNEL_ID')
	)

	if (!messagesChannel?.isTextBased()) return

	const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`create_${threadName.replace(/ /g, '-')}-${newMember.id}`)
			.setLabel('Да')
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId(
				`cancel_create_${threadName.replace(/ /g, '-')}-${newMember.id}`
			)
			.setLabel('Нет')
			.setStyle(ButtonStyle.Danger)
	)

	await messagesChannel.send({
		content: `${dashboard.roleIds('ADMIN_ROLES').map(id => roleMention(id)).join(' ')} Создать для <@${newMember.id}> архив - \`${threadName}\`?`,
		components: [row]
	})
}

/**
 * Действия при изменении никнейма
 *
 * @param {GuildMember} oldMember
 * @param {GuildMember} newMember
 */
let handleNameEdit = async (oldMember: import('discord.js').GuildMember | import('discord.js').PartialGuildMember, newMember: import('discord.js').GuildMember) => {
	if (oldMember.displayName === newMember.displayName) return

	const parsedNew = parseDisplayName(newMember.displayName)
	if (!parsedNew) return // новый ник тоже без | — выходим

	const newThreadName = [
		'archive',
		parsedNew.memberName.toLowerCase(),
		parsedNew.memberStatic.toLowerCase()
	].join(' ')

	const guild = newMember.guild
	const parentId = dashboard.getSetting('PARENT_CHANNEL_ID')

	// Ищем ветку, у которой в названии есть такой же static (цифры)
	const existingThread = guild.channels.cache.find(channel => {
		if (!channel.isThread()) return false
		if (channel.parentId !== parentId) return false

		// Название вида "archive что-то 300911"
		const parts = channel.name.toLowerCase().split(' ')
		const threadStatic = parts[parts.length - 1] // последнее слово = цифры

		return threadStatic === parsedNew.memberStatic.toLowerCase()
	})

	if (!existingThread) {
		console.log(
			`[NameEdit] Ветка с static "${parsedNew.memberStatic}" не найдена`
		)
		return
	}

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
 const err = getError(caught);
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
		async (oldMember: import('discord.js').GuildMember | import('discord.js').PartialGuildMember, newMember: import('discord.js').GuildMember) => {
			try {
 if (oldMember.partial) return
 await handleMakeAdmin(oldMember, newMember)
				await handleMakeRevento(oldMember, newMember)
				await handleNameEdit(oldMember, newMember)
			} catch (caught) {
 const error = getError(caught);
				console.error('❌ Ошибка выполнения: ', error)
			}
		}
	)
}
