const { store: dashboard } = require('../../dashboard/store')
const { ContainerBuilder } = require('../../services/markdownContainer')
const {
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	TextDisplayBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	AttachmentBuilder,
	SeparatorSpacingSize,
	SectionBuilder,
	ButtonBuilder,
	ButtonStyle
} = require('discord.js')
const path = require('path')
const { replyWithAutoDelete } = require('../../utils/autoDelete')

const inviteApplication = require('../../features/invite/inviteApplication')
const { IMAGES_PATH } = require('../../config/path')
const FORM_FIELDS = inviteApplication.MODAL_FIELDS

/**
 * Команда !invite (только Administrator).
 * Собирает большой ContainerBuilder с описанием семьи, требованиями и формой заявки
 * (поля берутся динамически из MODAL_FIELDS). Прикрепляет 2 изображения и кнопку «Подать заявку».
 * @param {Message} message
 * @param {string[]} args
 */
module.exports = {
	name: 'invite',
	description: 'Создает сообщение для канала заявок',
	async execute(message, args) {
		if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return await replyWithAutoDelete(
				message,
				'У вас нет прав для использования этой команды!'
			)
		}

		// 1. Подготовка изображений
		const payload = await this.buildPayload()
		const sent = await message.channel.send(payload)
		await require('../../dashboard/permanentMessages').rememberSent('invite', sent)
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

		const inviteImage = new MediaGalleryBuilder().addItems(
			new MediaGalleryItemBuilder()
				.setURL(dashboard.text('invite.1'))
				.setDescription('REVENTO')
		)

		const reventoImage = new MediaGalleryBuilder().addItems(
			new MediaGalleryItemBuilder()
				.setURL(dashboard.text('invite.2'))
				.setDescription('REVENTO')
		)

		// 2. Кнопка подачи заявки
		const inviteButton = new SectionBuilder()
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.3'))
			)
			.setButtonAccessory(
				new ButtonBuilder()
					.setCustomId('open_invite_modal')
					.setLabel(dashboard.text('invite.4'))
					.setStyle(ButtonStyle.Primary)
			)

		// 3. Сборка основной части контейнера
		const container = new ContainerBuilder()
			.addMediaGalleryComponents(inviteImage)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.5'))
			)
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.6'))
			)
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.7'))
			)
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.8'))
			)
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.9'))
			)
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.10'))
			)
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addMediaGalleryComponents(reventoImage)
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.11'))
			)

		// 🚀 4. ДИНАМИЧЕСКАЯ ГЕНЕРАЦИЯ ТЕКСТА ИЗ MODAL_FIELDS
		// Цикл автоматически создаст ровно столько блоков, сколько полей в модалке (сейчас их 5)
		FORM_FIELDS.forEach((field, index) => {
			let fieldText = `### ${index + 1}. ${field.label}\n`

			if (field.description) {
				fieldText += `> ${field.description}\n`
			}

			fieldText += `> **Пример:** ||${field.placeholder}||`

			container
				.addSeparatorComponents(
					new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
				)
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(dashboard.text('invite.form.' + field.customId, {}, fieldText))
				)
		})

		// 5. Завершающая часть контейнера
		container
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.12'))
			)
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.13'))
			)
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(dashboard.text('invite.14'))
			)
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addSectionComponents(inviteButton)

		// 6. Отправка и очистка команды
		return {
			flags: [MessageFlags.IsComponentsV2],
			components: [dashboard.decorate('invite', container)],
			files: [localImage1, localImage2]
		}
	}
}
