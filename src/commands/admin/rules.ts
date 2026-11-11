import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	TextDisplayBuilder
} from 'discord.js'
import { replyWithAutoDelete } from '../../utils/autoDelete'

/**
 * Команда !rules (Administrator).
 * Собирает контейнер со всеми правилами семьи и картинкой.
 * @param {Message} message
 * @param {string[]} args
 */
export = {
	name: 'rules',
	description: 'Создает сообщение для rules',
	async execute(message: import('discord.js').Message<true>, args: string[]) {
		if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
			return await replyWithAutoDelete(message, {
				content: '❌ У вас нет прав для использования этой команды!'
			})
		}
		const payload = await this.buildPayload()
		const sent = await message.channel.send(payload)
		await (require('../../dashboard/permanentMessages') as typeof import('../../dashboard/permanentMessages')).rememberSent(
			'rules',
			sent
		)
		await message.delete().catch(() => {})
	},
	async buildPayload() {


		const templates = dashboard.snapshot().templates
		const document = templates.find(field => field.key === 'rules.document')
		const fields = document
			? [document]
			: templates.filter(field => /^rules\.(heading|rule)\./.test(field.key))
		const container = new ContainerBuilder()
		for (const field of fields) {
			container
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(field.value)
				)
				.addSeparatorComponents(new SeparatorBuilder())
		}

		return {
			flags: MessageFlags.IsComponentsV2 as const,
			components: [dashboard.decorate('rules', container)]
		}
	}
}
