const {
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder,
	SeparatorSpacingSize,
	SectionBuilder,
	ButtonBuilder,
	ButtonStyle,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	MessageFlags
} = require('discord.js')

/**
 * Собирает ContainerBuilder из данных, пришедших с веб-интерфейса (text/separator/image/section).
 * @param {{noColor?: boolean, accentColor?: string, items: Array}} data
 * @returns {{flags, components}}
 */
function buildWebContainer(data) {
	const { noColor, accentColor, items } = data
	const container = new ContainerBuilder()

	if (!noColor) {
		container.setAccentColor(
			accentColor ? parseInt(accentColor.replace('#', '0x')) : 0x5865f2
		)
	}

	for (const item of items) {
		if (item.type === 'text') {
			if (item.value) {
				container.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(item.value)
				)
			}
		} else if (item.type === 'separator') {
			const sep = new SeparatorBuilder()
			// spacing: 'large' | 'small' (legacy: item.large === true)
			const isLarge =
				item.spacing === 'large' ||
				(item.spacing == null && item.large === true)
			sep.setSpacing(
				isLarge ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small
			)
			// divider: boolean, default true (legacy large=true означало divider=false)
			let showDivider = true
			if (typeof item.divider === 'boolean') {
				showDivider = item.divider
			} else if (item.large === true) {
				showDivider = false
			}
			sep.setDivider(showDivider)
			container.addSeparatorComponents(sep)
		} else if (item.type === 'image') {
			if (item.value) {
				const mediaItem = new MediaGalleryItemBuilder().setURL(item.value)
				const gallery = new MediaGalleryBuilder().addItems(mediaItem)
				container.addMediaGalleryComponents(gallery)
			}
		} else if (item.type === 'section') {
			const section = new SectionBuilder()

			if (item.value) {
				section.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(item.value)
				)
			}

			if (item.btnLabel && item.btnLink) {
				const button = new ButtonBuilder()
					.setLabel(item.btnLabel)
					.setURL(item.btnLink)
					.setStyle(ButtonStyle.Link)

				section.setButtonAccessory(button)
			}

			container.addSectionComponents(section)
		}
	}

	return {
		flags: [MessageFlags.IsComponentsV2],
		components: [container]
	}
}

module.exports = { buildWebContainer }
