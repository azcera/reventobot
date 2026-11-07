const { MessageFlags } = require('discord.js')
const { store, templateDefinition } = require('./store')
const { problem } = require('./auth')
const { parseMessageLink } = require('../services/containerMessageService')
const { snapshot, applyFields } = require('./messageEditor')
const locks = require('../services/messageLocks')
const { linesOf, logMessageChange } = require('./changeLog')

const definitions = {
	rules: { group: 'Правила', command: 'rules' },
	invite: { group: 'Приглашение', command: 'invite' },
	promotion: { group: 'Система повышения' },
	recruit: { group: 'Памятка рекрута' }
}

async function fetchMessage(client, guild, link) {
	const ids = parseMessageLink(link)
	if (ids.guildId !== guild.id) throw problem(403, 'Сообщение другого сервера.')
	const channel = await guild.channels.fetch(ids.channelId)
	if (!channel?.messages) throw problem(400, 'Нужен текстовый канал.')
	const message = await channel.messages.fetch({ message: ids.messageId, force: true, cache: false })
	if (message.author.id !== client.user.id || message.webhookId) throw problem(403, 'Нужно сообщение этого бота.')
	if (!message.flags.has(MessageFlags.IsComponentsV2)) throw problem(400, 'Нужен контейнер Components v2.')
	return message
}

function bindingFor(kind, message) {
	const definition = definitions[kind]
	if (!definition) throw problem(400, 'Неизвестный вид сообщения.')
	const fields = definition.command ? [] : snapshot(message).fields.map((field, index) => ({
		...field, key: `permanent.${kind}.${message.id}.${index}`, group: definition.group,
		default: field.value, variables: [], type: field.label === 'Подпись кнопки' ? 'button' : field.type
	}))
	return { link: message.url, fields }
}

async function rememberSent(kind, message) {
	if (!store.ready || !message?.url || message.guildId !== process.env.GUILD_ID) return
	try { await store.save('bindings', { [kind]: bindingFor(kind, message) }, store.revision, 'bot') }
	catch (error) { console.error('[Dashboard] Не удалось сохранить привязку:', error.message) }
}

async function updateMessage(kind, binding, client, guild, actor) {
	const id = parseMessageLink(binding.link).messageId
	if (locks.has(id)) throw problem(409, 'Сообщение уже сохраняется.')
	locks.add(id)
	try {
		const message = await fetchMessage(client, guild, binding.link)
		let payload
		if (definitions[kind].command) {
			const built = await require('../commands/admin/' + definitions[kind].command).buildPayload()
			payload = { components: built.components.map(component => component.toJSON()), allowedMentions: { parse: [], repliedUser: false } }
			const resolveMedia = components => {
				for (const component of components) {
					for (const item of component.items || []) if (item.media?.url.startsWith('attachment://')) {
						const attachment = [...message.attachments.values()].find(file => file.name === item.media.url.slice(13))
						if (!attachment?.url) throw problem(409, 'В сообщении отсутствует изображение шаблона. Повторно отправьте его командой бота.')
						item.media.url = attachment.url
					}
					if (component.components) resolveMedia(component.components)
				}
			}
			resolveMedia(payload.components)
		} else {
			const current = snapshot(message).fields
			if (current.length !== binding.fields.length || binding.fields.some((field, index) => field.path !== current[index].path || field.type !== (current[index].label === 'Подпись кнопки' ? 'button' : current[index].type))) {
				throw problem(409, 'Структура сообщения изменилась. Привяжите его заново.')
			}
			payload = applyFields(message, Object.fromEntries(binding.fields.map(field => [field.path, store.text(field.key)])))
		}
		for (const component of payload.components) if (component.type === 17) component.accent_color = null
		const before = linesOf(message)
		await message.edit(payload)
		return await logMessageChange({ guild, actor, kind, link: binding.link, before, after: linesOf(payload) })
	} finally { locks.delete(id) }
}

async function syncMessages(keys, client, guild, selectedKind, actor) {
	const results = []
	for (const [kind, binding] of Object.entries(store.bindings)) {
		if (!definitions[kind] || (selectedKind ? kind !== selectedKind : !keys.some(key => templateDefinition(key)?.group === definitions[kind].group))) continue
		try { const logResult = await updateMessage(kind, binding, client, guild, actor); results.push({ kind, ok: true, ...logResult }) }
		catch (error) { results.push({ kind, ok: false, error: error.status ? error.message : 'Discord недоступен или у бота нет прав на сообщение. Повторите обновление.' }) }
	}
	return results
}

module.exports = { definitions, bindingFor, fetchMessage, rememberSent, syncMessages }
