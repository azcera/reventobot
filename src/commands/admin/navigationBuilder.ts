import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	TextDisplayBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize
} from 'discord.js'

/**
 * Собирает ContainerBuilder с категориями и Link-кнопками навигации.
 * @param {string|null} text - опциональный заголовок сверху
 * @param {boolean} isMentionHere - добавлять ли ||@here||
 * @returns {ContainerBuilder}
 */
function getNavigationContainer(text: string|null = null, isMentionHere: boolean = true) {
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

export { getNavigationContainer }
