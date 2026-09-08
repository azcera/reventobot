const {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	roleMention,
	GuildMember,
	Events
} = require('discord.js')
const { parseDisplayName } = require('../utils/parseDisplayName')

const ADMIN_ROLES = process.env.ADMIN_ROLES
	? process.env.ADMIN_ROLES.split(',')
			.map(r => r.trim())
			.filter(Boolean)
	: []

/**
 * Действия при добавлению участнику админ ролей
 *
 * @param {GuildMember} oldMember
 * @param {GuildMember} newMember
 */
let handleMakeAdmin = async (oldMember, newMember) => {
	const oldHasAdmin = oldMember.roles.cache.filter(role =>
		ADMIN_ROLES.includes(role.id)
	)
	const newHasAdmin = newMember.roles.cache.filter(role =>
		ADMIN_ROLES.includes(role.id)
	)
	const addedRole = newHasAdmin.find(role => !oldHasAdmin.has(role.id))
	const removedRole = oldHasAdmin.find(role => !newHasAdmin.has(role.id))

	if (!addedRole && !removedRole) return

	const cleanName = newMember.displayName.replace(/^\[.*\]\s*/g, '').trim()

	let newPrefix = ''

	if (addedRole) {
		if (addedRole.id === ADMIN_ROLES[0]) {
			newPrefix = '[𝐃𝐞𝐩] ' // dep
		} else if (addedRole.id === ADMIN_ROLES[1]) {
			newPrefix = '[𝐇𝐢𝐠𝐡] ' // high
		} else if (addedRole.id === ADMIN_ROLES[2]) {
			newPrefix = '[𝐑𝐞𝐜] ' // recruit
		}
	}
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
let handleMakeRevento = async (oldMember, newMember, channelName) => {
	const hadRoleBefore = oldMember.roles.cache.has(process.env.AUTO_ROLE)
	const hasRoleNow = newMember.roles.cache.has(process.env.AUTO_ROLE)
	let parsedChannelName = channelName.replace(/-/g, ' ')

	if (!hadRoleBefore && hasRoleNow) {
		const channels = newMember.guild.channels.cache

		let existingChannel = channels.find(
			channel => channel.name === parsedChannelName
		)

		if (!existingChannel) {
			const messagesChannel = newMember.guild.channels.cache.get(
				process.env.LOG_CHANNEL_ID
			)
			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(`create_${channelName}-${newMember.id}`)
					.setLabel('Да')
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId(`cancel_create_${channelName}-${newMember.id}`)
					.setLabel('Нет')
					.setStyle(ButtonStyle.Danger)
			)

			if (messagesChannel && messagesChannel.isTextBased()) {
				messagesChannel.send({
					content: `${ADMIN_ROLES.map(e => roleMention(e))} Создать для <@${newMember.id}> архив - \`${parsedChannelName}\`?`,
					components: [row]
				})
			}
		}
	}
}

/**
 * Действия при изменении никнейма
 *
 * @param {GuildMember} oldMember
 * @param {GuildMember} newMember
 */
let handleNameEdit = async (oldMember, newMember) => {
	// Ник не изменился
	if (oldMember.displayName === newMember.displayName) return

	const parsedOld = parseDisplayName(oldMember.displayName)
	const parsedNew = parseDisplayName(newMember.displayName)

	if (!parsedOld || !parsedNew) return

	// Старое и новое имя ветки (с пробелами)
	const oldThreadName = [
		'archive',
		parsedOld.memberName.toLowerCase(),
		parsedOld.memberStatic.toLowerCase()
	].join(' ')

	const newThreadName = [
		'archive',
		parsedNew.memberName.toLowerCase(),
		parsedNew.memberStatic.toLowerCase()
	].join(' ')

	// Имя не поменялось
	if (oldThreadName === newThreadName) return

	const guild = newMember.guild

	const existingThread = guild.channels.cache.find(
		channel =>
			channel.isThread() &&
			channel.parentId === process.env.PARENT_CHANNEL_ID &&
			channel.name === oldThreadName
	)

	if (!existingThread) {
		console.log(`Ветка "${oldThreadName}" не найдена`)
		return
	}

	if (!existingThread.manageable) {
		console.warn(`❌ Нет прав на переименование ветки ${existingThread.name}`)
		return
	}

	try {
		await existingThread.setName(newThreadName)
		console.log(
			`✅ Ветка переименована: "${oldThreadName}" → "${newThreadName}"`
		)
	} catch (err) {
		console.error(`❌ Ошибка при переименовании ветки:`, err.message)
	}
}

module.exports = client => {
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
		async (oldMember, newMember) => {
			const displayName = oldMember.displayName
			const parsedData = parseDisplayName(displayName)
			if (!parsedData) return

			try {
				await handleMakeAdmin(oldMember, newMember)
				await handleMakeRevento(
					oldMember,
					newMember,
					[
						'archive',
						parsedData.memberName.toLowerCase(),
						parsedData.memberStatic.toLowerCase()
					].join('-')
				)
				await handleNameEdit(oldMember, newMember)
			} catch (error) {
				console.error('❌ Ошибка выполнения: ', error)
			}
		}
	)
}
