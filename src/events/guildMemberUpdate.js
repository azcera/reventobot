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
let handleMakeRevento = async (oldMember, newMember) => {
	const hadRoleBefore = oldMember.roles.cache.has(process.env.AUTO_ROLE)
	const hasRoleNow = newMember.roles.cache.has(process.env.AUTO_ROLE)

	if (!hadRoleBefore && hasRoleNow) {
		const parsedData = parseDisplayName(newMember.displayName)
		if (!parsedData) return

		const threadName = [
			'archive',
			parsedData.memberName.toLowerCase(),
			parsedData.memberStatic.toLowerCase()
		].join(' ') // пробелы, как у твоих веток

		const channels = newMember.guild.channels.cache

		const existingThread = channels.find(
			channel =>
				channel.isThread() &&
				channel.parentId === process.env.PARENT_CHANNEL_ID &&
				channel.name === threadName
		)

		if (!existingThread) {
			const messagesChannel = newMember.guild.channels.cache.get(
				process.env.LOG_CHANNEL_ID
			)

			const row = new ActionRowBuilder().addComponents(
				new ButtonBuilder()
					.setCustomId(
						`create_${threadName.replace(/ /g, '-')}-${newMember.id}`
					)
					.setLabel('Да')
					.setStyle(ButtonStyle.Success),
				new ButtonBuilder()
					.setCustomId(
						`cancel_create_${threadName.replace(/ /g, '-')}-${newMember.id}`
					)
					.setLabel('Нет')
					.setStyle(ButtonStyle.Danger)
			)

			if (messagesChannel?.isTextBased()) {
				await messagesChannel.send({
					content: `${ADMIN_ROLES.map(e => roleMention(e)).join(' ')} Создать для <@${newMember.id}> архив - \`${threadName}\`?`,
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
	if (oldMember.displayName === newMember.displayName) {
		console.log('[NameEdit] Ник не изменился')
		return
	}

	console.log('[NameEdit] Старый ник:', oldMember.displayName)
	console.log('[NameEdit] Новый ник:', newMember.displayName)

	const parsedOld = parseDisplayName(oldMember.displayName)
	const parsedNew = parseDisplayName(newMember.displayName)

	console.log('[NameEdit] parsedOld:', parsedOld)
	console.log('[NameEdit] parsedNew:', parsedNew)

	if (!parsedOld || !parsedNew) {
		console.log('[NameEdit] Не удалось распарсить один из ников')
		return
	}

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

	console.log('[NameEdit] Ищем ветку:', `"${oldThreadName}"`)
	console.log('[NameEdit] Хотим переименовать в:', `"${newThreadName}"`)

	if (oldThreadName === newThreadName) {
		console.log('[NameEdit] Имена веток одинаковые, ничего не делаем')
		return
	}

	const existingThread = newMember.guild.channels.cache.find(
		channel =>
			channel.isThread() &&
			channel.parentId === process.env.PARENT_CHANNEL_ID &&
			channel.name === oldThreadName
	)

	if (!existingThread) {
		console.log('[NameEdit] ❌ Ветка не найдена')

		// Покажем все ветки в этом родительском канале для отладки
		const allThreads = newMember.guild.channels.cache.filter(
			c => c.isThread() && c.parentId === process.env.PARENT_CHANNEL_ID
		)
		console.log('[NameEdit] Существующие ветки:')
		allThreads.forEach(t => console.log(`  - "${t.name}"`))
		return
	}

	console.log('[NameEdit] ✅ Ветка найдена:', existingThread.id)

	if (!existingThread.manageable) {
		console.warn('[NameEdit] ❌ Нет прав на переименование')
		return
	}

	try {
		await existingThread.setName(newThreadName)
		console.log(
			`✅ Ветка переименована: "${oldThreadName}" → "${newThreadName}"`
		)
	} catch (err) {
		console.error('❌ Ошибка при переименовании:', err.message)
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
			try {
				await handleMakeAdmin(oldMember, newMember)
				await handleMakeRevento(oldMember, newMember)
				await handleNameEdit(oldMember, newMember)
			} catch (error) {
				console.error('❌ Ошибка выполнения: ', error)
			}
		}
	)
}
