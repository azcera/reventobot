const {
	Message,
	MessageFlags,
	ButtonBuilder,
	ButtonStyle,
	PermissionFlagsBits,
	ContainerBuilder,
	SectionBuilder,
	SeparatorBuilder,
	TextDisplayBuilder,
	AttachmentBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder
} = require('discord.js')

const path = require('path')
const { IMAGES_PATH } = require('../../config/path')
const { replyWithAutoDelete } = require('../../utils/autoDelete')
const pool = require('../../services/database')

module.exports = {
	name: 'panel',
	description: 'Создает кнопки админ-панели',
	/**
	 * Команда !panel (Administrator).
	 * Создаёт админ-панель с тремя кнопками: групп, капт, move-all + изображение.
	 * @param {Message} message
	 * @param {string[]} args
	 */
	async execute(message, args) {
		if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return await replyWithAutoDelete(message, {
				content: '❌ У вас нет прав для использования этой команды!'
			})
		}

		if (message.channel.id != process.env.ADMIN_PANEL_CHANNEL_ID) {
			return await replyWithAutoDelete(message, {
				content:
					'❌ Использование этой команды в данном канале не предусмотрено!'
			})
		}

		try {
			const result = await pool.query(`SELECT * FROM admin_panel`)

			if (result.rows.length === 0) {
				console.error('❌ Админ-панель не настроена в базе данных')
				return await message.channel
					.send('❌ Ошибка: панель не настроена в БД.')
					.catch(() => {})
			}

			const imagePath = path.join(IMAGES_PATH, 'panel.png')
			const localImage = new AttachmentBuilder(imagePath, {
				name: 'panel.png'
			})

			const inviteImage = new MediaGalleryBuilder().addItems(
				new MediaGalleryItemBuilder()
					.setURL('attachment://panel.png')
					.setDescription('REVENTO')
			)

			const titleText = new TextDisplayBuilder().setContent(
				'## 📌 Админ-панель\nДля взаимодействия с ботом используйте кнопки ниже.'
			)

			const container = new ContainerBuilder()
				.addMediaGalleryComponents(inviteImage)
				.addTextDisplayComponents(titleText)
				.addSeparatorComponents(new SeparatorBuilder())

			for (const row of result.rows) {
				const button = new ButtonBuilder()
					.setLabel(row.buttonLabel)
					.setStyle(row.style)

				if (row.buttonId.includes('http')) {
					button.setURL(row.buttonId)
				} else {
					button.setCustomId(row.buttonId)
				}

				const section = new SectionBuilder()
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(row.text)
					)
					.setButtonAccessory(button)
				container
					.addSectionComponents(section)
					.addSeparatorComponents(new SeparatorBuilder())
			}

			const footerText = new TextDisplayBuilder().setContent(
				'*Время необходимо указывать по МСК. Формат \`ДД.ММ.ГГГГ ЧЧ:ММ\` нужен только если дата не сегодняшняя.*'
			)

			container.addTextDisplayComponents(footerText)

			const messageData = {
				flags: MessageFlags.IsComponentsV2,
				components: [container],
				files: [localImage]
			}

			// Поиск старой панели для редактирования
			const messages = await message.channel.messages
				.fetch({ limit: 5 })
				.catch(() => null)
			const botMessage = messages ? messages.find(m => m.author.bot) : null

			if (botMessage) {
				await botMessage.edit(messageData)
			} else {
				await message.channel.send(messageData)
			}

			return await message.delete().catch(() => {})
		} catch (error) {
			// Если база данных упадет или файл panel.png пропадет — бот выполнит этот блок и НЕ крашнется
			console.error('🔥 Критическая ошибка при формировании панели:', error)
			return await message.channel
				.send(
					'❌ Произошла внутренняя ошибка при сборке панели. Проверьте консоль бота.'
				)
				.catch(() => {})
		}
	}
}
