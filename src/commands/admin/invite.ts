import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	TextDisplayBuilder,
	AttachmentBuilder,
	SeparatorSpacingSize,
	SectionBuilder,
	ButtonBuilder,
	ButtonStyle
} from 'discord.js'
import path = require('path')
import { replyWithAutoDelete } from '../../utils/autoDelete'

import { IMAGES_PATH } from '../../config/path'

/**
 * Команда !invite (только Administrator).
 * Собирает большой ContainerBuilder с описанием семьи, требованиями и формой заявки
 * (поля берутся динамически из MODAL_FIELDS). Прикрепляет 2 изображения и кнопку «Подать заявку».
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

		// 1. Подготовка изображений
		const payload = await this.buildPayload()
		const sent = await message.channel.send(payload)
		await (require('../../dashboard/permanentMessages') as typeof import('../../dashboard/permanentMessages')).rememberSent('invite', sent)
		await message.delete().catch(() => {})
	},
	async buildPayload() {
		const imagePath1 = path.join(IMAGES_PATH, 'invites.png')
		const imagePath2 = path.join(IMAGES_PATH, 'revento.png')

		const localImage1 = new AttachmentBuilder(imagePath1, {
			name: 'invites.png'
		})
		const localImage2 = new AttachmentBuilder(imagePath2, {
			name: 'revento.png'
		})

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
			components: [dashboard.decorate('invite', container)],
			files: [localImage1, localImage2]
		}
	}
}
