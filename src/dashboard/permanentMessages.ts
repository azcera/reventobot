import { componentJSON } from '../types'
import { getError } from '../utils/errors'
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { MessageFlags, PermissionsBitField } from 'discord.js'
import { store, templateDefinition } from './store'
import { problem } from './auth'
import { parseMessageLink, parseContainerMessage, buildEditPayload } from '../services/containerMessageService'
import markdown = require('../../public/component-markdown')
import { snapshot, applyFields } from './messageEditor'
import locks = require('../services/messageLocks')
import { linesOf, logMessageChange } from './changeLog'

const definitions: Record<string, { group: string; command?: string }> = {
	rules: { group: 'Правила', command: 'rules' },
	invite: { group: 'Приглашение', command: 'invite' },
	promotion: { group: 'Система повышения' },
	recruit: { group: 'Памятка рекрута' }
}
function definition(kind: string) {
	if (Object.hasOwn(definitions, kind)) return definitions[kind]
	if (/^custom-[a-f0-9-]{36}$/.test(kind)) {
		const field = store.bindings[kind]?.fields[0]
		if (field) return { group: field.group, command: undefined }
	}
	return undefined
}
const publications = new Set()

// Attachments stay on the original message; Markdown uses their Discord URLs.
function parsePermanentMessage(message: T.MessageShape) {
	return parseContainerMessage({ flags: message.flags, components: message.components,
		content: message.content, embeds: message.embeds, attachments: new Map() })
}

async function publish(kind: string, channelId: string, revision: number, client: D.Client, guild: D.Guild, actor: T.Actor | undefined) {
	if (!definition(kind)) throw problem(400, 'Неизвестный вид сообщения.')
	if (revision !== store.revision) throw problem(409, 'Настройки изменились. Обновите данные.')
	if (publications.has(kind)) throw problem(409, 'Шаблон уже публикуется.')
	publications.add(kind)
	try {
		const channel = await guild.channels.fetch(channelId)
		if (!channel || ![0, 5].includes(channel.type) || !channel.isTextBased() || !channel.permissionsFor(client.user!)?.has([PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages])) throw problem(400, 'Выберите доступный текстовый канал сервера.')
		const binding = store.bindings[kind]
		if (binding?.link && parseMessageLink(binding.link).channelId === channelId) {
			await updateMessage(kind, binding, client, guild, actor)
			return
		}
		let payload: T.MutableMessagePayload
		if (definition(kind)!.command) payload = await (require('../commands/admin/' + definition(kind)!.command) as { buildPayload(): Promise<T.MutableMessagePayload> }).buildPayload()
		else if (binding?.link) {
			const source = await fetchMessage(client, guild, binding.link)
			payload = binding.markdown ? buildEditPayload({ items: markdown.parse(store.text(binding.fields[0].key)) })
				: applyFields(source, Object.fromEntries(binding.fields.map(field => [field.path, store.text(field.key)])), { expandMarkdown: false })
			payload.components = payload.components.map(component => componentJSON(component))
			const resolve = (components: T.RawComponent[]): void => {
				for (const component of components) {
					for (const item of component.items || []) if (item.media?.url.startsWith('attachment://')) {
						const file = [...source.attachments.values()].find(file => file.name === item.media.url.slice(13))
						if (!file?.url) throw problem(409, 'Не найдено вложение исходного сообщения.')
						item.media.url = file.url
					}
					if (component.components) resolve(component.components)
				}
			}
			resolve(payload.components as T.RawComponent[])
			delete payload.attachments
		} else payload = buildEditPayload({ items: markdown.parse(binding ? store.text(binding.fields[0].key) : store.text(kind + '.document', {}, templateDefinition(kind + '.document')!.default)) })
		payload.flags = MessageFlags.IsComponentsV2
		payload.allowedMentions = { parse: [], repliedUser: false }
		const sent = await channel.send(payload as D.MessageCreateOptions)
		try { await store.save('bindings', { [kind]: bindingFor(kind, sent) }, revision, actor) }
		catch (caughtError) {
 const error = getError(caughtError)

			try { await sent.delete() } catch { throw problem(503, 'Сообщение опубликовано, но привязка не сохранена. Сохраните ссылку вручную: ' + sent.url) }
			throw error
		}
	} finally { publications.delete(kind) }
}

async function fetchMessage(client: D.Client, guild: D.Guild, link: string) {
	const ids = parseMessageLink(link)
	if (ids.guildId !== guild.id) throw problem(403, 'Сообщение другого сервера.')
	const channel = await guild.channels.fetch(ids.channelId)
	if (!channel || !channel.isTextBased()) throw problem(400, 'Нужен текстовый канал.')
	const message = await channel.messages.fetch({ message: ids.messageId, force: true, cache: false })
	if (message.author.id !== client.user!.id || message.webhookId) throw problem(403, 'Нужно сообщение этого бота.')
	if (!message.flags.has(MessageFlags.IsComponentsV2)) throw problem(400, 'Нужен контейнер Components v2.')
	return message
}

function bindingFor(kind: string, message: T.MessageShape & { id?: string; url: string }) {
	const entry = definition(kind)!
	if (!entry) throw problem(400, 'Неизвестный вид сообщения.')
	if (!entry.command) {
		try {
			const parsed = parsePermanentMessage(message)
			return { link: message.url, markdown: true, fields: [{ key: `permanent.${kind}.${message.id}.0`, path: 'markdown', group: entry.group, label: 'Текст сообщения (Markdown)', type: 'text', components: true, maxLength: 16000, default: markdown.stringify(parsed.items), variables: [] }] }
		} catch (caughtError) {
 const error = getError(caughtError)
 if (error.status !== 422) throw error }
	}
	const fields = entry.command ? [] : snapshot(message).fields.map((field, index) => ({
		...field, components: false, key: `permanent.${kind}.${message.id}.${index}`, group: entry.group,
		default: field.value, variables: [], type: field.label === 'Подпись кнопки' ? 'button' : field.type
	}))
	return { link: message.url, fields }
}

async function rememberSent(kind: string, message: D.Message) {
	if (!store.ready || !message?.url || message.guildId !== process.env.GUILD_ID) return
	try { await store.save('bindings', { [kind]: bindingFor(kind, message) }, store.revision, 'bot') }
	catch (caughtError) {
 const error = getError(caughtError)
 console.error('[Dashboard] Не удалось сохранить привязку:', error.message) }
}

async function updateMessage(kind: string, binding: T.Binding, client: D.Client, guild: D.Guild, actor: T.Actor | undefined) {
	const id = parseMessageLink(binding.link).messageId
	if (locks.has(id)) throw problem(409, 'Сообщение уже сохраняется.')
	locks.add(id)
	try {
		const message = await fetchMessage(client, guild, binding.link)
		let payload: T.MutableMessagePayload

		if (definition(kind)!.command) {
			const built = await (require('../commands/admin/' + definition(kind)!.command) as { buildPayload(): Promise<T.MutableMessagePayload> }).buildPayload()
			payload = { components: built.components.map(component => componentJSON(component)), ...(kind === 'rules' ? { attachments: [] } : {}), allowedMentions: { parse: ['roles'], repliedUser: false } }
			const files = new Set<NonNullable<D.MessageCreateOptions['files']>[number]>()
			const resolveMedia = (components: T.RawComponent[]): void => {
				for (const component of components) {
					for (const item of component.items || []) if (item.media?.url.startsWith('attachment://')) {
						const attachment = [...message.attachments.values()].find(file => file.name === item.media.url.slice(13))
						if (attachment?.url) item.media.url = attachment.url
						else {
							const file = built.files?.find(file => typeof file === 'object' && file !== null && 'name' in file && file.name === item.media.url.slice(13))
							if (!file) throw problem(409, 'Не найден файл изображения шаблона.')
							files.add(file)
						}
					}
					if (component.components) resolveMedia(component.components)
				}
			}
			resolveMedia(payload.components as T.RawComponent[])
			if (files.size) payload.files = [...files]
		} else if (binding.markdown) {
			parsePermanentMessage(message)
			payload = buildEditPayload({ items: markdown.parse(store.text(binding.fields[0].key)) })
			payload.components = payload.components.map(component => componentJSON(component))
		} else {
			const current = snapshot(message).fields
			if (current.length !== binding.fields.length || binding.fields.some((field, index) => field.path !== current[index].path || field.type !== (current[index].label === 'Подпись кнопки' ? 'button' : current[index].type))) {
				throw problem(409, 'Структура сообщения изменилась. Привяжите его заново.')
			}
			payload = applyFields(message, Object.fromEntries(binding.fields.map(field => [field.path, store.text(field.key)])), { expandMarkdown: false })
		}
		for (const component of payload.components as T.RawComponent[]) if (component.type === 17) component.accent_color = null
		const before = linesOf(message)
		await message.edit(payload as D.MessageEditOptions)
		return await logMessageChange({ guild, actor, kind, link: binding.link, before, after: linesOf({ ...payload, content: payload.content || '' }) })
	} finally { locks.delete(id) }
}

async function syncMessages(keys: string[], client: D.Client, guild: D.Guild, selectedKind: string | undefined, actor: T.Actor | undefined) {
	const results = []
	for (const [kind, binding] of Object.entries(store.bindings)) {
		if (!binding.link || !definition(kind) || (selectedKind ? kind !== selectedKind : !keys.some((key: string) => templateDefinition(key)?.group === definition(kind)!.group))) continue
		try { const logResult = await updateMessage(kind, binding, client, guild, actor); results.push({ kind, ok: true, ...logResult }) }
		catch (caughtError) {
 const error = getError(caughtError)
 results.push({ kind, ok: false, error: error.status ? error.message : 'Discord недоступен или у бота нет прав на сообщение. Повторите обновление.' }) }
	}
	return results
}

async function upgradeLegacyBindings(client: D.Client, guild: D.Guild) {
	for (const kind of ['promotion', 'recruit']) {
		const binding = store.bindings[kind]
		if (!binding || binding.markdown) continue
		try {
			const message = await fetchMessage(client, guild, binding.link)
			const payload = applyFields(message, Object.fromEntries(binding.fields.map(field => [field.path, store.text(field.key)])), { expandMarkdown: false })
			const next = bindingFor(kind, { flags: message.flags, components: payload.components, content: message.content, embeds: message.embeds, attachments: message.attachments, url: message.url })
			if (next.markdown) await store.save('bindings', { [kind]: next }, store.revision, 'bot')
		} catch (caughtError) {
 const error = getError(caughtError)

			// Keep the existing field editor for unsupported messages or unavailable Discord.
			if (error.status === 409) break
		}
	}
}

export { definition, definitions, bindingFor, fetchMessage, rememberSent, syncMessages, publish, upgradeLegacyBindings }
