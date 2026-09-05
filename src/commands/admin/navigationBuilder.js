const {
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	SectionBuilder
} = require('discord.js')

const navigationButtons = [
	{ label: 'Основное', link: 'category' },
	{
		text: 'Раздел всех основных правил',
		label: '📕 ПРАВИЛА',
		link: 'https://discord.com/channels/1445808131484553348/1544098139089277040'
	},
	{
		text: 'Информация о повышении',
		label: '📈 ПОВЫШЕНИЕ',
		link: 'https://discord.com/channels/1445808131484553348/1500204371638620170'
	},
	{
		text: 'Список и время проведения основных мероприятий',
		label: '⏰ РАСПИСАНИЕ МП',
		link: 'https://discord.com/channels/1445808131484553348/1500208108578930829'
	},
	{ label: 'Обучение', link: 'category' },
	{
		text: 'Обучение видам закура',
		label: '🥦 ЗАКУР',
		link: 'https://discord.com/channels/1445808131484553348/1500167057810128938'
	},
	{
		text: 'Использование группы',
		label: '✅ МЕТКИ',
		link: 'https://discord.com/channels/1445808131484553348/1500169291801301113'
	},
	{
		text: 'Информация об использовании эпиков и дефиков',
		label: '💊 ЭПИКИ/ДЕФИКИ',
		link: 'https://discord.com/channels/1445808131484553348/1500170743273750750'
	},
	{
		text: 'Видеоматериал про навыки',
		label: '💪 НАВЫКИ',
		link: 'https://discord.com/channels/1445808131484553348/1505861163328602182'
	}
]

function getNavigationContainer(text = null, isMentionHere = true) {
	const container = new ContainerBuilder()

	if (text != null) {
		container
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
	}
	container
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(`# Панель навигации`)
		)
		.addSeparatorComponents(
			new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
		)

	navigationButtons.forEach((btn, index) => {
		if (btn.link === 'category') {
			container
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(`## ${btn.label}`)
				)
				.addSeparatorComponents(new SeparatorBuilder())
		} else {
			container
				.addSectionComponents(
					new SectionBuilder()
						.addTextDisplayComponents(
							new TextDisplayBuilder().setContent(btn.text)
						)
						.setButtonAccessory(
							new ButtonBuilder()
								.setLabel(btn.label)
								.setStyle(ButtonStyle.Link)
								.setURL(btn.link.trim())
						)
				)
				.addSeparatorComponents(new SeparatorBuilder())
		}
	})

	if (isMentionHere) {
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('||@here||')
		)
	}

	return container
}

module.exports = { getNavigationContainer }
