const { store: dashboard } = require('../../dashboard/store')
const { ContainerBuilder } = require('../../services/markdownContainer')
const {
	TextDisplayBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize
} = require('discord.js')

/**
 * Собирает ContainerBuilder с категориями и Link-кнопками навигации.
 * @param {string|null} text - опциональный заголовок сверху
 * @param {boolean} isMentionHere - добавлять ли ||@here||
 * @returns {ContainerBuilder}
 */
function getNavigationContainer(text = null, isMentionHere = true) {
	const container = new ContainerBuilder()

	if (text != null) {
		container
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
	}
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(dashboard.text('navigation.document')))

	if (isMentionHere) {
		container.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('||@here||')
		)
	}

	return dashboard.decorate('navigation', container)
}

module.exports = { getNavigationContainer }
