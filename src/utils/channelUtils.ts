import * as navigation from '../dashboard/navigationMessages'
import { store as dashboard } from '../dashboard/store'
import { MessageFlags, ChannelType } from 'discord.js'
import {
	getNavigationContainer
} from '../commands/admin/navigationBuilder'
import { editReplyWithAutoDelete, replyWithAutoDelete } from './autoDelete'
require('dotenv').config()

/**
 * Создаёт приватную ветку (Private Thread) внутри PARENT_CHANNEL_ID,
 * добавляет member, отправляет навигационный контейнер.
 * @param {Interaction|Guild} interactionOrGuild
 * @param {{channelName: string, member: GuildMember}}
 * @returns {Promise<ThreadChannel>}
 */
async function createArchiveChannel(
	interactionOrGuild: import('discord.js').Guild | import('discord.js').RepliableInteraction<'cached'>,
	{ channelName, member }: { channelName: string; member: import('discord.js').GuildMember }
) {
	const guild = 'guild' in interactionOrGuild ? interactionOrGuild.guild : interactionOrGuild
	const isInteraction = 'reply' in interactionOrGuild

	const parentChannel =
		guild.channels.cache.get(dashboard.getSetting('PARENT_CHANNEL_ID')) ||
		(await guild.channels.fetch(dashboard.getSetting('PARENT_CHANNEL_ID')).catch(() => null))

	if (!parentChannel || parentChannel.type !== ChannelType.GuildText) {
		if (isInteraction) {
			const alreadyDeferred =
				interactionOrGuild.deferred || interactionOrGuild.replied
			const send = alreadyDeferred
				? (opts: { content: string }) => editReplyWithAutoDelete(interactionOrGuild, opts)
				: (opts: { content: string }) =>
						replyWithAutoDelete(interactionOrGuild, {
							...opts,
							flags: MessageFlags.Ephemeral as const
						})

			await send({
				content: `❌ Родительский канал для веток не найден или настроен неверно.`
			})
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
			flags: MessageFlags.IsComponentsV2 as const,
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
		.then(async sent => { await navigation.rememberSent(sent) })
		.catch(error => console.error('[Archive navigation]', error.message))

	// 5. Отвечаем на саму кнопку (если вызов был через взаимодействие)
	if (isInteraction) {
		const alreadyDeferred =
			interactionOrGuild.deferred || interactionOrGuild.replied
		const send = alreadyDeferred
			? (opts: { content: string }) => editReplyWithAutoDelete(interactionOrGuild, opts)
			: (opts: { content: string }) =>
					replyWithAutoDelete(interactionOrGuild, {
						...opts,
						flags: MessageFlags.Ephemeral as const
					})

		await send({
			content: `✅ Приватная ветка создана успешно — ${newThread}`
		})
	}

	return newThread
}

export { createArchiveChannel }
