const { store, catalog } = require('./store')
const { getNavigationContainer } = require('../commands/admin/navigationBuilder')
const locks = require('../services/messageLocks')
const running = new Set()
const json = component => component.toJSON ? component.toJSON() : component

function locate(message) {
	for (const [containerIndex, component] of message.components.map(json).entries()) {
		if (component.type !== 17) continue
		const prefixLength = component.components.findIndex(item => item.type === 10 && [catalog['navigation.1'].default, store.text('navigation.1')].includes(item.content))
		if (prefixLength >= 0 && component.components.filter(item => item.type === 9 && item.accessory?.style === 5).length === 7) return { containerIndex, prefixLength }
	}
	return null
}

async function rememberSent(message) {
	if (!store.ready || !message || (process.env.GUILD_ID && (message.guildId || message.guild?.id) !== process.env.GUILD_ID)) return
	const location = locate(message)
	if (location) await store.trackNavigation(message, location)
}

async function sync(client, guild) {
	if (running.has(guild.id)) return [{ kind: 'navigation', ok: false, error: 'Навигация уже обновляется. Повторите обновление после завершения.' }]
	running.add(guild.id)
	const failures = []
	let updated = 0
	try {
		const known = await store.navigationMessages(guild.id)
		const targets = new Map(known.map(row => [row.message_id, row]))
		const channels = new Map()
		const parentId = store.getSetting('PARENT_CHANNEL_ID')
		if (!parentId && !known.length) throw new Error('Выберите канал архивов в настройках.')
		if (parentId) {
			try {
				const parent = await guild.channels.fetch(parentId)
				if (!parent?.threads || !parent.messages) throw new Error('Канал архивов недоступен.')
				channels.set(parent.id, parent)
				try {
					const active = await parent.threads.fetchActive()
					for (const [id, thread] of active.threads) channels.set(id, thread)
				} catch { failures.push({ channelId: parentId, error: 'Не удалось получить активные архивы.' }) }
				for (const type of ['public', 'private']) {
					try {
						let before
						while (true) {
							const page = await parent.threads.fetchArchived({ type, fetchAll: true, limit: 100, ...(before ? { before } : {}) })
							for (const [id, thread] of page.threads) channels.set(id, thread)
							if (!page.hasMore) break
							const next = Math.min(...[...page.threads.values()].map(thread => thread.archiveTimestamp))
							if (!Number.isFinite(next) || (before && next >= before.getTime())) throw new Error('Не удалось продолжить список архивов.')
							before = new Date(next)
						}
					} catch { failures.push({ channelId: parentId, error: 'Не удалось получить все закрытые архивы (' + type + '). Проверьте права бота на управление ветками.' }) }
				}
			} catch (error) { failures.push({ channelId: parentId, error: error.message }) }
		}
		// Discover older copies as well as those already recorded by the bot.
		for (const channel of channels.values()) {
			try {
				let before
				while (true) {
					const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) })
					for (const message of page.values()) {
						if (message.author.id !== client.user.id || message.webhookId || targets.has(message.id)) continue
						const location = locate(message)
						if (!location) continue
						await store.trackNavigation(message, location)
						targets.set(message.id, { message_id: message.id, channel_id: channel.id, container_index: location.containerIndex, prefix_length: location.prefixLength })
					}
					if (page.size < 100) break
					const next = page.last().id
					if (next === before) throw new Error('Не удалось продолжить историю сообщений.')
					before = next
				}
			} catch { failures.push({ channelId: channel.id, error: 'Не удалось прочитать сообщения архива.' }) }
		}
		for (const row of targets.values()) {
			if (locks.has(row.message_id)) { failures.push({ messageId: row.message_id, error: 'Сообщение уже сохраняется.' }); continue }
			locks.add(row.message_id)
			let channel, archived = false
			try {
				channel = channels.get(row.channel_id) || await guild.channels.fetch(row.channel_id)
				const message = await channel.messages.fetch({ message: row.message_id, force: true, cache: false })
				if (message.author.id !== client.user.id || message.webhookId) throw new Error('Сообщение принадлежит другому отправителю.')
				const components = message.components.map(json)
				const container = components[row.container_index]
				if (container?.type !== 17 || (row.prefix_length !== 0 && (row.prefix_length !== 2 || container.components[0]?.type !== 10 || container.components[1]?.type !== 14))) throw new Error('Структура навигации изменилась.')
				const mentionHere = container.components.at(-1)?.content === '||@here||'
				components[row.container_index] = { ...container, components: [...container.components.slice(0, row.prefix_length), ...getNavigationContainer(null, mentionHere).toJSON().components] }
				archived = Boolean(channel.archived)
				if (archived) await channel.setArchived(false)
				await message.edit({ components, allowedMentions: { parse: [], repliedUser: false } })
				updated++
			} catch (error) {
				if (Number(error.code) === 10008 || Number(error.code) === 10003) await store.forgetNavigation(row.message_id)
				else failures.push({ messageId: row.message_id, channelId: row.channel_id, error: error.message })
			} finally {
				if (archived) try { await channel.setArchived(true) } catch { failures.push({ channelId: row.channel_id, error: 'Не удалось снова закрыть архив.' }) }
				locks.delete(row.message_id)
			}
		}
		return [{ kind: 'navigation', ok: failures.length === 0, updated, failures, ...(failures.length ? { error: 'Обновлено сообщений: ' + updated + '. Ошибок: ' + failures.length + '. ' + failures[0].error } : {}) }]
	} catch (error) { return [{ kind: 'navigation', ok: false, updated, error: error.message }] }
	finally { running.delete(guild.id) }
}

module.exports = { locate, rememberSent, sync }
