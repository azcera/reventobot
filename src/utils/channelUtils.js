const { MessageFlags, ChannelType } = require('discord.js')
const {
	getNavigationContainer
} = require('../commands/admin/navigationBuilder')
require('dotenv').config()
const parentChannelId = process.env.PARENT_CHANNEL_ID

/**
 * Создаёт приватную ветку (Private Thread) внутри PARENT_CHANNEL_ID,
 * добавляет member, отправляет навигационный контейнер.
 * @param {Interaction|Guild} interactionOrGuild
 * @param {{channelName: string, member: GuildMember}}
 * @returns {Promise<ThreadChannel>}
 */
async function createChannel(interactionOrGuild, { channelName, member }) {
	const guild = interactionOrGuild.guild || interactionOrGuild
	const isInteraction = !!interactionOrGuild.reply

	const parentChannel =
		guild.channels.cache.get(parentChannelId) ||
		(await guild.channels.fetch(parentChannelId).catch(() => null))

	if (!parentChannel || parentChannel.type !== ChannelType.GuildText) {
		if (isInteraction) {
			await interactionOrGuild
				.reply({
					content:
						'❌ Родительский канал для веток не найден или настроен неверно.',
					flags: [MessageFlags.Ephemeral]
				})
				.then(() => {
					setTimeout(async () => {
						await interactionOrGuild.deleteReply().catch(() => {})
					}, 60000)
				})
				.catch(() => {})
		}
		throw new Error(
			'❌ Не удалось найти текстовый канал PARENT_CHANNEL_ID для создания ветки.'
		)
	}

	// 2. Создаем приватную ветку внутри этого канала
	const newThread = await parentChannel.threads.create({
		name: channelName,
		autoArchiveDuration: 1440,
		type: ChannelType.PrivateThread,
		reason: `Приватная ветка для ${member.user.tag}`
	})

	await newThread.members.add(member.id).catch(() => {})

	// 4. Отправляем приветственное сообщение
	await newThread
		.send({
			allowedMentions: { users: [member.id] },
			flags: [MessageFlags.IsComponentsV2],
			components: [
				getNavigationContainer(
					`## <@${member.id}>\n` +
						`### Это твой личный канал-архив, куда ты можешь отправлять:\n` +
						`> Откаты с мероприятий\n` +
						`> Откаты с каптов\n` +
						`> Заявки на повышение\n` +
						`> Задавать вопросы хай-составу\n` +
						`## Зачем отправлять откаты?\n` +
						`Это все нужно для получения TIER, который показывает уровень твоей игры в нашей семье. Ниже ты можешь увидеть кнопки с навигацией, которые помогут тебе быстро найти нужный контент.`,
					false
				)
			]
		})
		.catch(() => {})

	// 5. Отвечаем на саму кнопку (если вызов был через взаимодействие)
	if (isInteraction) {
		await interactionOrGuild
			.reply({
				content: `✅ Приватная ветка создана успешно — ${newThread}`,
				flags: [MessageFlags.Ephemeral]
			})
			.then(() => {
				setTimeout(async () => {
					await interactionOrGuild.deleteReply().catch(() => {})
				}, 60000)
			})
			.catch(() => {})
	}

	return newThread
}

module.exports = { createChannel }
