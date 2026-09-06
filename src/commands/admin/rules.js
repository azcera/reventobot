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

const rules = [
	{
		name: 'Общие положения',
		list: [
			'Запрещено разжигать конфликты, оскорблять или проявлять неуважение внутри и вне семьи к кому-либо незавсисимо от пола.',
			'Никнейм в дискорде должен строго соответствовать вашему игровому нику и статическому ID (пример: Имя | Статик).',
			'Запрещен флуд, спам, реклама сторонних ресурсов и упоминание родных в любом виде.'
		]
	},
	{
		name: 'Голосовые каналы',
		list: [
			'Заходя в каналы сбора на семейные МП (мероприятия, капты), вы обязаны иметь работающий микрофон и не создавать посторонних шумов.',
			'Запрещено издавать громкие звуки, перебивать старших, кричать или использовать программы для изменения голоса на протяжении всего общения.'
		]
	},
	{
		name: 'Дисциплина и информация',
		list: [
			'Запрещена передача любой внутренней информации и ресурсов семьи третьим лицам.',
			'Запрещено игнорировать сборы (https://discord.com/channels/1445808131484553348/1445808132671668233) на семейные мероприятия, если вы находитесь в игре и не имеете уважительной причины.'
		]
	},
	{
		name: 'Правила для мероприятий',
		list: [
			'При участии на мероприятии \`"ОПАСНЫЕ ТАЙНИКИ"\` запрещено оставлять или продавать лут из тайников у себя, все что было найдено должно попасть на __склад__ или __особняк__.\n\n\`\`\`ansi\n[2;31m[1;31mПод правила опасных тайников попадают предметы: Строительное и электронное оборудование, материалы, генераторы, (1,2,3) уровня. Остальные предметы: пачки сигарет, металлолом и т.д вы можете оставлять себе и продавать.[0m[2;31m[0m\n\`\`\`',
			'При участии на любом из МП выбитое оружие должно быть сложено на склад или хранится на личный перезафул для ближайших мероприятий, продавать нельзя'
		]
	}
]

/**
 * Команда !rules (Administrator).
 * Собирает контейнер со всеми правилами семьи (4 раздела) и картинкой.
 * @param {Message} message
 * @param {string[]} args
 */
module.exports = {
	name: 'rules',
	description: 'Создает сообщение для rules',
	async execute(message, args) {
		if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
			return message
				.reply('У вас нет прав для использования этой команды!')
				.then(msg => setTimeout(() => msg.delete().catch(() => {}), 5000))
		}
		const imagePath = path.join(IMAGES_PATH, 'rules.png')

		const localImage = new AttachmentBuilder(imagePath, {
			name: 'rules.png'
		})

		const inviteImage = new MediaGalleryBuilder().addItems(
			new MediaGalleryItemBuilder()
				.setURL('attachment://rules.png')
				.setDescription('REVENTO')
		)

		const container = new ContainerBuilder()
			.addMediaGalleryComponents(inviteImage)
			.addSeparatorComponents(new SeparatorBuilder())
		let mainIndex = 1,
			subIndex
		for (const rule of rules) {
			subIndex = 1
			container
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`## ${rule.name}`)
				)
				.addSeparatorComponents(new SeparatorBuilder())
			for (const item of rule.list) {
				container
					.addTextDisplayComponents(
						new TextDisplayBuilder().setContent(
							`**Правило — ${mainIndex}-${subIndex}**\n${item}`
						)
					)
					.addSeparatorComponents(new SeparatorBuilder())
				subIndex++
			}
			mainIndex++
		}

		await message.channel.send({
			flags: MessageFlags.IsComponentsV2,
			components: [container],
			files: [localImage]
		})

		return await message.delete().catch(() => {})
	}
}
