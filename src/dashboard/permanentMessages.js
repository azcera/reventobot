const { MessageFlags, PermissionsBitField } = require('discord.js')
const { store, templateDefinition } = require('./store')
const { problem } = require('./auth')
const { parseMessageLink, parseContainerMessage, buildEditPayload } = require('../services/containerMessageService')
const markdown = require('../../public/component-markdown')
const { snapshot, applyFields } = require('./messageEditor')
const locks = require('../services/messageLocks')
const { linesOf, logMessageChange } = require('./changeLog')

const definitions = {
	rules: { group: 'Правила', command: 'rules' },
	invite: { group: 'Приглашение', command: 'invite' },
	promotion: { group: 'Система повышения' },
	recruit: { group: 'Памятка рекрута' }
}
const publications = new Set()

// Attachments stay on the original message; Markdown uses their Discord URLs.
function parsePermanentMessage(message) {
	return parseContainerMessage({ flags: message.flags, components: message.components,
		content: message.content, embeds: message.embeds, attachments: new Map() })
}

async function publish(kind, channelId, revision, client, guild, actor) {
	if (!Object.hasOwn(definitions, kind)) throw problem(400, 'Неизвестный вид сообщения.')
	if (revision !== store.revision) throw problem(409, 'Настройки изменились. Обновите данные.')
	if (publications.has(kind)) throw problem(409, 'Шаблон уже публикуется.')
	publications.add(kind)
	try {
		const channel = await guild.channels.fetch(channelId)
		if (!channel || ![0, 5].includes(channel.type) || !channel.send || !channel.permissionsFor(client.user)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) throw problem(400, 'Выберите доступный текстовый канал сервера.')
		const binding = store.bindings[kind]
		if (binding && parseMessageLink(binding.link).channelId === channelId) {
			await updateMessage(kind, binding, client, guild, actor)
			return
		}
		let payload
		if (definitions[kind].command) payload = await require('../commands/admin/' + definitions[kind].command).buildPayload()
		else if (binding) {
			const source = await fetchMessage(client, guild, binding.link)
			payload = binding.markdown ? buildEditPayload({ items: markdown.parse(store.text(binding.fields[0].key)) })
				: applyFields(source, Object.fromEntries(binding.fields.map(field => [field.path, store.text(field.key)])), { expandMarkdown: false })
			payload.components = payload.components.map(component => component.toJSON ? component.toJSON() : component)
			const resolve = components => {
				for (const component of components) {
					for (const item of component.items || []) if (item.media?.url.startsWith('attachment://')) {
						const file = [...source.attachments.values()].find(file => file.name === item.media.url.slice(13))
						if (!file?.url) throw problem(409, 'Не найдено вложение исходного сообщения.')
						item.media.url = file.url
					}
					if (component.components) resolve(component.components)
				}
			}
			resolve(payload.components)
			delete payload.attachments
		} else payload = buildEditPayload({ items: markdown.parse(store.text(kind + '.document', {}, templateDefinition(kind + '.document').default)) })
		payload.flags = MessageFlags.IsComponentsV2
		payload.allowedMentions = { parse: [], repliedUser: false }
		const sent = await channel.send(payload)
		try { await store.save('bindings', { [kind]: bindingFor(kind, sent) }, revision, actor) }
		catch (error) {
			try { await sent.delete() } catch { throw problem(503, 'Сообщение опубликовано, но привязка не сохранена. Сохраните ссылку вручную: ' + sent.url) }
			throw error
		}
	} finally { publications.delete(kind) }
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
	if (!definition.command) {
		try {
			const parsed = parsePermanentMessage(message)
			return { link: message.url, markdown: true, fields: [{ key: `permanent.${kind}.${message.id}.0`, path: 'markdown', group: definition.group, label: 'Текст сообщения (Markdown)', type: 'text', components: true, maxLength: 16000, default: markdown.stringify(parsed.items), variables: [] }] }
		} catch (error) { if (error.status !== 422) throw error }
	}
	const fields = definition.command ? [] : snapshot(message).fields.map((field, index) => ({
		...field, components: false, key: `permanent.${kind}.${message.id}.${index}`, group: definition.group,
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
			payload = { components: built.components.map(component => component.toJSON()), allowedMentions: { parse: ['roles'], repliedUser: false } }
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
		} else if (binding.markdown) {
			parsePermanentMessage(message)
			payload = buildEditPayload({ items: markdown.parse(store.text(binding.fields[0].key)) })
			payload.components = payload.components.map(component => component.toJSON())
		} else {
			const current = snapshot(message).fields
			if (current.length !== binding.fields.length || binding.fields.some((field, index) => field.path !== current[index].path || field.type !== (current[index].label === 'Подпись кнопки' ? 'button' : current[index].type))) {
				throw problem(409, 'Структура сообщения изменилась. Привяжите его заново.')
			}
			payload = applyFields(message, Object.fromEntries(binding.fields.map(field => [field.path, store.text(field.key)])), { expandMarkdown: false })
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

async function upgradeLegacyBindings(client, guild) {
	for (const kind of ['promotion', 'recruit']) {
		const binding = store.bindings[kind]
		if (!binding || binding.markdown) continue
		try {
			const message = await fetchMessage(client, guild, binding.link)
			const payload = applyFields(message, Object.fromEntries(binding.fields.map(field => [field.path, store.text(field.key)])), { expandMarkdown: false })
			const next = bindingFor(kind, { flags: message.flags, components: payload.components, content: message.content, embeds: message.embeds, attachments: message.attachments, url: message.url })
			if (next.markdown) await store.save('bindings', { [kind]: next }, store.revision, 'bot')
		} catch (error) {
			// Keep the existing field editor for unsupported messages or unavailable Discord.
			if (error.status === 409) break
		}
	}
}

module.exports = { definitions, bindingFor, fetchMessage, rememberSent, syncMessages, publish, upgradeLegacyBindings }
