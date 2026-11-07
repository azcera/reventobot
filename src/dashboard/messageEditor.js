const { MessageFlags } = require('discord.js')
const { messageRevision } = require('../services/containerMessageService')
const { problem } = require('./auth')

function isHttpsUrl(value) {
	try {
		const url = new URL(value)
		return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
	} catch { return false }
}

// Only these fields may be changed. Component structure, IDs and attachments stay on the server.
function editableFields(components, prefix = 'components', result = []) {
	components.forEach((component, index) => {
		const path = `${prefix}.${index}`
		const add = (property, label, maxLength, type = 'text') => {
			if (typeof component[property] === 'string') result.push({ path: `${path}.${property}`, label, value: component[property], maxLength, type })
		}
		if (component.type === 10) add('content', 'Текст', 4000)
		if (component.type === 2) {
			add('label', 'Подпись кнопки', 80)
			if (component.style === 5) add('url', 'Ссылка кнопки', 512, 'url')
		}
		if (component.type === 17) result.push({ path: `${path}.accent_color`, label: 'Цвет контейнера (пусто — без цвета)',
			value: component.accent_color == null ? '' : '#' + component.accent_color.toString(16).padStart(6, '0'), maxLength: 7, type: 'color' })
		if (component.components) editableFields(component.components, path + '.components', result)
		if (component.accessory) editableFields([component.accessory], path + '.accessory', result)
	})
	return result
}

function snapshot(message) {
	const components = message.components.map(component => component.toJSON ? component.toJSON() : component)
	const fields = editableFields(components)
	if (!message.flags.has(MessageFlags.IsComponentsV2)) fields.unshift({ path: 'content', label: 'Текст сообщения', value: message.content, maxLength: 2000, type: 'text' })
	return { revision: messageRevision(message), fields, url: message.url }
}

function applyFields(message, values) {
	const current = snapshot(message)
	if (!values || typeof values !== 'object' || Array.isArray(values)) throw problem(400, 'Некорректные поля сообщения.')
	const payload = { components: message.components.map(component => structuredClone(component.toJSON ? component.toJSON() : component)),
		allowedMentions: { parse: [], repliedUser: false } }
	const allowed = new Map(current.fields.map(field => [field.path, field]))
	for (const [path, value] of Object.entries(values)) {
		const field = allowed.get(path)
		if (!field || typeof value !== 'string' || value.length > field.maxLength || (!value.trim() && field.type !== 'color' && path !== 'content')) throw problem(400, 'Недопустимое поле, пустой или слишком длинный текст.')
		if (field.type === 'url' && !isHttpsUrl(value)) throw problem(400, 'Для кнопки нужна HTTPS-ссылка.')
		if (field.type === 'color' && value && !/^#[a-f0-9]{6}$/i.test(value)) throw problem(400, 'Цвет должен иметь вид #5865f2.')
		let target = payload
		const parts = path.split('.')
		for (const part of parts.slice(0, -1)) {
			// accessory is a single component; the synthetic 0 is only used in field paths.
			if (part === '0' && target.type) continue
			target = target[part]
		}
		target[parts.at(-1)] = field.type === 'color' ? value ? parseInt(value.slice(1), 16) : null : value
	}
	let textLength = 0
	function count(components) {
		for (const component of components) {
			if (component.type === 10) textLength += component.content.length
			if (component.components) count(component.components)
			if (component.accessory) count([component.accessory])
		}
	}
	count(payload.components)
	if (textLength > 4000) throw problem(400, 'Общая длина текста компонентов не должна превышать 4000 символов.')
	return payload
}

module.exports = { editableFields, snapshot, applyFields, isHttpsUrl }
