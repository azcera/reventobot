import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	TextDisplayBuilder,
	SeparatorSpacingSize,
	SectionBuilder,
	ButtonBuilder,
	ButtonStyle
} from 'discord.js'
import { replyWithAutoDelete } from '../../utils/autoDelete'


/**
 * Команда !invite (только Administrator).
 * Собирает большой ContainerBuilder с описанием семьи, требованиями и формой заявки
 * (поля берутся динамически из MODAL_FIELDS) и кнопку «Подать заявку».
 * @param {Message} message
 * @param {string[]} args
 */
export = {
	name: 'invite',
	description: 'Создает сообщение для канала заявок',
	async execute(message: import('discord.js').Message<true>, args: string[]) {
		if (!message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
			return await replyWithAutoDelete(
				message,
				'У вас нет прав для использования этой команды!'
			)
		}

		const payload = await this.buildPayload()
		const sent = await message.channel.send(payload)
		await (require('../../dashboard/permanentMessages') as typeof import('../../dashboard/permanentMessages')).rememberSent('invite', sent)
		await message.delete().catch(() => {})
	},
	async buildPayload() {
		const container = new ContainerBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(dashboard.text('invite.document')))
			.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large))
			.addSectionComponents(new SectionBuilder()
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(dashboard.text('invite.3')))
				.setButtonAccessory(new ButtonBuilder().setCustomId('open_invite_modal')
					.setLabel(dashboard.text('invite.4')).setStyle(ButtonStyle.Primary)))

		// 6. Отправка и очистка команды
		return {
			flags: MessageFlags.IsComponentsV2 as const,
			components: [dashboard.decorate('invite', container)]
		}
	}
}
