const discord = require('discord.js')
const { parse } = require('../../public/component-markdown')

function expand(components) {
	return components.flatMap(component => {
		if (component.type !== 10) return [component]
		const items = parse(component.content)
		if (items.length === 1 && items[0].type === 'text') return [component]
		return items.map(item => {
			if (item.type === 'text') return { type: 10, content: item.value }
			if (item.type === 'separator') return { type: 14, spacing: item.spacing === 'large' ? 2 : 1, divider: item.divider }
			if (item.type === 'image') return { type: 12, items: [{ media: { url: item.value } }] }
			return { type: 9, components: [{ type: 10, content: item.value }], accessory: { type: 2, style: 5, label: item.btnLabel, url: item.btnLink } }
		})
	})
}
class ContainerBuilder extends discord.ContainerBuilder {
	toJSON() {
		const data = super.toJSON()
		data.components = expand(data.components)
		let count = 1, length = 0
		function inspect(components) { for (const component of components) { count++; if (component.type === 10) length += component.content.length; if (component.components) inspect(component.components); if (component.accessory) inspect([component.accessory]) } }
		inspect(data.components)
		if (count > 40 || length > 4000) throw new Error('Контейнер превышает лимит Discord: 40 компонентов или 4000 символов.')
		return new discord.ContainerBuilder(data).toJSON()
	}
}
module.exports = { ContainerBuilder, expand }
