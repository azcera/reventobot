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
	if (oldMember.displayName === newMember.displayName) return

	const parsedNew = parseDisplayName(newMember.displayName)
	if (!parsedNew) return // новый ник тоже без | — выходим

	const newThreadName = [
		'archive',
		parsedNew.memberName.toLowerCase(),
		parsedNew.memberStatic.toLowerCase()
	].join(' ')

	const guild = newMember.guild
	const parentId = process.env.PARENT_CHANNEL_ID

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
	} catch (err) {
		console.error('❌ Ошибка при переименовании ветки:', err.message)
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
