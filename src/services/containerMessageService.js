const { createHash } = require('node:crypto')
const { MessageFlags } = require('discord.js')
const { buildWebContainer } = require('./containerService')
const saving = require('./messageLocks')

function fail(status, message) {
	throw Object.assign(new Error(message), { status })
}

function parseMessageLink(link) {
	let url
	try { url = new URL(link) } catch { fail(400, 'Вставьте полную ссылку на сообщение Discord.') }
	const match = url.pathname.match(/^\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/)
	if (url.protocol !== 'https:' || url.port || url.username || url.password ||
		!['discord.com', 'www.discord.com', 'canary.discord.com', 'ptb.discord.com', 'discordapp.com'].includes(url.hostname) || !match) {
		fail(400, 'Нужна ссылка вида https://discord.com/channels/сервер/канал/сообщение.')
	}
	return { guildId: match[1], channelId: match[2], messageId: match[3] }
}

function rawComponents(message) {
	return message.components.map(component => component.toJSON ? component.toJSON() : component)
}

function messageRevision(message) {
	return createHash('sha256').update(JSON.stringify({
		components: rawComponents(message), editedTimestamp: message.editedTimestamp,
		content: message.content, flags: message.flags.bitfield,
		attachments: [...message.attachments.keys()], embeds: message.embeds
	})).digest('hex')
}

function parseContainerMessage(message) {
	const unsupported = () => fail(422, 'Сообщение содержит компоненты или свойства, которые билдер пока не поддерживает. Импорт отменён, чтобы не потерять данные.')
	const keys = (object, allowed) => {
		if (!object || Object.keys(object).some(key => !allowed.includes(key))) unsupported()
	}
	if (!message.flags.has(MessageFlags.IsComponentsV2)) fail(422, 'Это не сообщение Components v2.')
	const components = rawComponents(message)
	if (components.length !== 1 || components[0].type !== 17 || message.content ||
		message.attachments.size || message.embeds.length) unsupported()
	const container = components[0]
	keys(container, ['type', 'id', 'accent_color', 'spoiler', 'components'])
	if (container.spoiler || !Array.isArray(container.components) || !container.components.length) unsupported()
	const items = container.components.map((component, index) => {
		const item = { id: `import-${index}`, value: '' }
		if (component.type === 10) {
			keys(component, ['type', 'id', 'content'])
			return { ...item, type: 'text', value: component.content }
		}
		if (component.type === 14) {
			keys(component, ['type', 'id', 'spacing', 'divider'])
			if (component.spacing != null && ![1, 2].includes(component.spacing)) unsupported()
			return { ...item, type: 'separator', spacing: component.spacing === 2 ? 'large' : 'small', divider: component.divider ?? true }
		}
		if (component.type === 12) {
			keys(component, ['type', 'id', 'items'])
			if (component.items?.length !== 1) unsupported()
			const image = component.items[0]
			keys(image, ['media', 'description', 'spoiler'])
			if (image.spoiler || image.description || !/^https?:\/\//.test(image.media?.url)) unsupported()
			return { ...item, type: 'image', value: image.media.url }
		}
		if (component.type === 9) {
			keys(component, ['type', 'id', 'components', 'accessory'])
			const text = component.components?.[0]
			const button = component.accessory
			if (component.components?.length !== 1 || text?.type !== 10 || button?.type !== 2 ||
				button.style !== 5 || !button.label || !button.url || button.disabled || button.emoji) unsupported()
			keys(text, ['type', 'id', 'content'])
			keys(button, ['type', 'id', 'style', 'label', 'url', 'disabled', 'emoji'])
			return { ...item, type: 'section', value: text.content, btnLabel: button.label, btnLink: button.url }
		}
		unsupported()
	})
	return {
		noColor: container.accent_color == null,
		accentColor: '#' + (container.accent_color ?? 0x5865f2).toString(16).padStart(6, '0'),
		items
	}
}

function buildEditPayload(data, allowMentions = false) {
	if (!Array.isArray(data.items) || !data.items.length || data.items.length > 39 ||
		data.items.some(item => !item || !['text', 'image', 'separator', 'section'].includes(item.type) ||
			(item.type !== 'separator' && (typeof item.value !== 'string' || !item.value.trim())) ||
			(item.type === 'section' && (!item.btnLabel || !item.btnLink)))) {
		fail(400, 'Заполните компоненты: текст, адрес изображения, подпись и ссылку кнопки не могут быть пустыми.')
	}
	try {
		const payload = buildWebContainer(data)
		payload.components[0].toJSON()
		payload.allowedMentions = { parse: allowMentions ? ['users', 'roles', 'everyone'] : ['roles'], repliedUser: false }
		return payload
	} catch {
		fail(400, 'Проверьте содержимое компонентов, ссылки, длину текста и подписи кнопок.')
	}
}

function registerContainerMessageRoutes(app, client, { beforeMutation, afterMutation } = {}) {
	async function fetchMessage(link) {
		const ids = parseMessageLink(link)
		if (!client.isReady()) fail(503, 'Бот не подключён к Discord. Проверьте его запуск и токен.')
		const channel = await client.channels.fetch(ids.channelId)
		if (!channel?.isTextBased() || !channel.messages || channel.guildId !== ids.guildId) {
			fail(404, 'Канал не найден на указанном сервере или недоступен боту.')
		}
		return channel.messages.fetch({ message: ids.messageId, force: true, cache: false })
	}
	function source(message) {
		return {
			url: message.url, revision: messageRevision(message), channelId: message.channelId,
			canEdit: message.author.id === client.user.id && !message.webhookId
		}
	}
	function errorResponse(res, error) {
		const missing = [10003, 10008, 50001, 50013].includes(error.code)
		res.status(error.status || (missing ? 404 : 502)).json({
			success: false,
			error: error.status ? error.message : missing
				? 'Сообщение удалено или у бота нет доступа. Нужны права просмотра канала и истории сообщений.'
				: 'Не удалось выполнить запрос к Discord. Попробуйте ещё раз.'
		})
	}
	app.get('/api/container-message', async (req, res) => {
		res.set('Cache-Control', 'no-store')
		try {
			const message = await fetchMessage(req.query.link)
			res.json({ success: true, ...parseContainerMessage(message), source: source(message) })
		} catch (error) { errorResponse(res, error) }
	})
	app.post('/api/edit-container', async (req, res) => {
		let lock
		try {
			const { link, revision } = req.body
			const ids = parseMessageLink(link)
			if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) fail(400, 'Сначала загрузите сообщение по ссылке.')
			if (saving.has(ids.messageId)) fail(409, 'Сообщение уже сохраняется. Дождитесь завершения.')
			saving.add(ids.messageId)
			lock = ids.messageId
			const payload = buildEditPayload(req.body)
			const message = await fetchMessage(link)
			if (!source(message).canEdit) fail(403, 'Можно изменять только сообщения этого бота. Для остальных используйте «Отправить копию».')
			if (revision !== messageRevision(message)) fail(409, 'Сообщение изменилось после загрузки. Загрузите его заново перед сохранением.')
			parseContainerMessage(message)
			await beforeMutation?.(req, 'container.edit', message.url)
			const { linesOf, diffLines, logMessageChange } = require('../dashboard/changeLog')
			const before = linesOf(message)
			const updated = await message.edit({
				...payload, flags: message.flags.bitfield
			})
			const after = linesOf(updated)
			const logResult = await logMessageChange({ guild: req.guild, actor: req.dashboardUser, link: updated.url, before, after })
			await afterMutation?.(req, 'container.edit', updated.url, { diff: diffLines(before, after), ...logResult })
			res.json({ success: true, source: source(updated), ...logResult })
		} catch (error) {
			if (lock) {
				try { await afterMutation?.(req, 'container.edit.failed', req.body.link, { error: error.status ? error.message : 'Не удалось обновить контейнер в Discord.' }) }
				catch (auditError) { console.error('[Dashboard audit]', auditError.message) }
			}
			errorResponse(res, error)
		}
		finally { if (lock) saving.delete(lock) }
	})
}

module.exports = { parseMessageLink, parseContainerMessage, messageRevision, buildEditPayload, registerContainerMessageRoutes }
