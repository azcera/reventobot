const { store: dashboard } = require('../../dashboard/store')
const {
	MessageFlags,
	PermissionFlagsBits,
	ContainerBuilder,
	SeparatorBuilder,
	TextDisplayBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	AttachmentBuilder
} = require('discord.js')
const path = require('path')
const { IMAGES_PATH } = require('../../config/path')
const { replyWithAutoDelete } = require('../../utils/autoDelete')

/**
 * Команда !rules (Administrator).
 * Собирает контейнер со всеми правилами семьи и картинкой.
 * @param {Message} message
 * @param {string[]} args
 */
module.exports = {
	name: 'rules',
	description: 'Создает сообщение для rules',
	async execute(message, args) {
		if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return await replyWithAutoDelete(message, {
				content: '❌ У вас нет прав для использования этой команды!'
			})
		}
		const payload = await this.buildPayload()
		const sent = await message.channel.send(payload)
		await require('../../dashboard/permanentMessages').rememberSent('rules', sent)
		await message.delete().catch(() => {})
	},
	async buildPayload() {
		const imagePath = path.join(IMAGES_PATH, 'rules.png')

		const localImage = new AttachmentBuilder(imagePath, {
			name: 'rules.png'
		})

		const inviteImage = new MediaGalleryBuilder().addItems(
			new MediaGalleryItemBuilder()
				.setURL(dashboard.text('rules.1'))
				.setDescription('REVENTO')
		)

		const container = new ContainerBuilder()
			.addMediaGalleryComponents(inviteImage)
			.addSeparatorComponents(new SeparatorBuilder())
		for (const field of dashboard.snapshot().templates.filter(field => /^rules\.(heading|rule)\./.test(field.key))) {
			container
				.addTextDisplayComponents(new TextDisplayBuilder().setContent(field.value))
				.addSeparatorComponents(new SeparatorBuilder())
		}

		return {
			flags: MessageFlags.IsComponentsV2,
			components: [dashboard.decorate('rules', container)],
			files: [localImage]
		}
	}
}
