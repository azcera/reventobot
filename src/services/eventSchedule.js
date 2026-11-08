const {
	ContainerBuilder, SectionBuilder, TextDisplayBuilder, ButtonBuilder,
	ButtonStyle, MessageFlags, PermissionFlagsBits, escapeMarkdown
} = require('discord.js')

const SOURCE = 'https://mitsuki-hub.ru/api/schedule?project=MAJESTIC'
const DAY = 86400000
const MSK = 3 * 3600000
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

function canCreateGroup(member, store) {
	return !!member && (member.permissions.has(PermissionFlagsBits.Administrator) ||
		member.roles.cache.some(role => store.roleIds('ADMIN_ROLES').includes(role.id)))
}

function upcomingEvents(events, now = Date.now()) {
	const today = Math.floor((now + MSK) / DAY) * DAY - MSK
	return events.filter(event => !event.is247 && !event.window && /^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)).map(event => {
		const [hours, minutes] = event.time.split(':').map(Number)
		for (let day = 0; day <= 7; day++) {
			const timestamp = today + day * DAY + (hours * 60 + minutes) * 60000
			const weekday = WEEKDAYS[new Date(timestamp + MSK).getUTCDay()]
			if (timestamp > now && (!event.days?.length || event.days.includes(weekday))) return { ...event, timestamp }
		}
		return null
	}).filter(Boolean).sort((a, b) => a.timestamp - b.timestamp)
}

function selectionId(event) {
	return `${event.id}_${Math.floor(event.timestamp / 1000)}`
}

function buildSchedule(events, updatedAt, stale, now = Date.now()) {
	const upcoming = upcomingEvents(events, now)
	const nearest = upcoming[0]
	const container = new ContainerBuilder().addTextDisplayComponents(
		new TextDisplayBuilder().setContent('## 📅 Расписание Majestic RP'))
	if (nearest) {
		container.addSectionComponents(new SectionBuilder()
			.addTextDisplayComponents(new TextDisplayBuilder().setContent(
				`### Ближайшее — ${escapeMarkdown(nearest.label)}\n**${nearest.time} МСК** · <t:${Math.floor(nearest.timestamp / 1000)}:R>`))
			.setButtonAccessory(new ButtonBuilder().setCustomId(`schedule_group_${selectionId(nearest)}`)
				.setLabel('Создать групп').setStyle(ButtonStyle.Primary).setDisabled(stale)))
	}
	const rows = upcoming.map(event => `**${event.time}** — ${escapeMarkdown(event.label)}${event.timestamp >= Math.floor((now + MSK) / DAY) * DAY - MSK + DAY ? ' (завтра)' : ''}`)
	const special = events.filter(event => event.is247 || event.window || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time))
		.map(event => `**${escapeMarkdown(event.label)}** — ${escapeMarkdown(event.time)}${event.days?.length ? ` · ${event.days.join(', ')}` : ''}${event.note ? `\n${escapeMarkdown(event.note)}` : ''}`)
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
		[rows.join('\n'), special.join('\n\n')].filter(Boolean).join('\n\n').slice(0, 3500)))
	container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
		`-# Время МСК · [Mitsuki Hub](https://mitsuki-hub.ru/) · синхронизация <t:${Math.floor(updatedAt / 1000)}:R>${stale ? '\n⚠️ Источник недоступен. Показано последнее полученное расписание; создание группа временно отключено.' : '\n-# «Создать групп» доступно администраторам и ADMIN_ROLES.'}`))
	return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { parse: [] } }
}

function createEventSchedule({ client, pool, store, fetchImpl = fetch, now = Date.now }) {
	let events = [], updatedAt = 0, lastAttempt = 0, stale = true, timer, queue = Promise.resolve()
	function serialized(task) {
		const result = queue.then(task)
		queue = result.catch(() => {})
		return result
	}
	async function refresh() {
		if (lastAttempt && now() - lastAttempt < 5 * 60000) return
		lastAttempt = now()
		try {
			const response = await fetchImpl(SOURCE, { signal: AbortSignal.timeout(10000), cache: 'no-store' })
			if (!response.ok) throw new Error(`HTTP ${response.status}`)
			const data = await response.json()
			if (!Array.isArray(data.events) || !data.events.length || data.events.length > 30 ||
				data.events.some(event => !event || !/^[a-zA-Z0-9-]{1,40}$/.test(event.id) ||
					typeof event.label !== 'string' || !event.label.length || event.label.length > 100 ||
					typeof event.time !== 'string' || event.time.length > 30 ||
					(event.note != null && (typeof event.note !== 'string' || event.note.length > 200)) ||
					!Array.isArray(event.days) || event.days.some(day => !WEEKDAYS.includes(day))) ||
				!upcomingEvents(data.events, now()).length) throw new Error('Некорректное расписание')
			events = data.events
			updatedAt = now()
			stale = false
		} catch (error) {
			stale = true
			console.error('[Schedule] Не удалось обновить расписание:', error.message)
		}
	}
	async function updateChannel(channel, messageId) {
		const payload = buildSchedule(events, updatedAt, stale, now())
		if (messageId) {
			try {
				const message = await channel.messages.fetch(messageId)
				await message.edit(payload)
				return
			} catch (error) {
				if (error.code !== 10008) throw error
			}
		}
		const message = await channel.send(payload)
		try {
			await pool.query('INSERT INTO event_schedule_messages (channel_id, message_id) VALUES ($1, $2) ON CONFLICT (channel_id) DO UPDATE SET message_id = EXCLUDED.message_id', [channel.id, message.id])
		} catch (error) {
			await message.delete().catch(() => {})
			throw error
		}
	}
	async function tick() {
		await refresh()
		if (!events.length) return
		const { rows } = await pool.query('SELECT channel_id, message_id FROM event_schedule_messages')
		for (const row of rows) {
			try {
				const channel = await client.channels.fetch(row.channel_id)
				await updateChannel(channel, row.message_id)
			} catch (error) { console.error('[Schedule] Ошибка обновления сообщения:', error.message) }
		}
	}
	return {
		async start() {
			await pool.query('CREATE TABLE IF NOT EXISTS event_schedule_messages (channel_id TEXT PRIMARY KEY, message_id TEXT NOT NULL)')
			await serialized(tick)
			timer = setInterval(() => serialized(tick).catch(error => console.error('[Schedule]', error.message)), 60000)
			timer.unref()
		},
		async stop() { clearInterval(timer); await queue },
		canCreateGroup(member) { return canCreateGroup(member, store) },
		resolveSelection(id) {
			if (stale || now() - updatedAt > 6 * 60000) return null
			return upcomingEvents(events, now()).find(event => selectionId(event) === id) || null
		},
		publish(channel) {
			return serialized(async () => {
				await refresh()
				if (stale || !events.length) throw new Error('Не удалось получить актуальное расписание Mitsuki Hub. Повторите позже.')
				const { rows } = await pool.query('SELECT message_id FROM event_schedule_messages WHERE channel_id = $1', [channel.id])
				await updateChannel(channel, rows[0]?.message_id)
			})
		}
	}
}

module.exports = { createEventSchedule, upcomingEvents, buildSchedule, canCreateGroup, selectionId }
