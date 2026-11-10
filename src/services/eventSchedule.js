const {
	ContainerBuilder,
	SectionBuilder,
	TextDisplayBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	SeparatorSpacingSize,
	escapeMarkdown,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	AttachmentBuilder
} = require('discord.js')
const path = require('path')
const { IMAGES_PATH } = require('../config/path')
const events = require('../config/eventSchedule')

const UPDATE_INTERVAL = 15 * 60000
const DAY = 86400000
const MSK = 3 * 3600000
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
const EVENT_EMOJI = {
	Дроп: '📍',
	Тайники: '🔒',
	Дилеры: '💊',
	Цеха: '🏭',
	Поставки: '🚚',
	Контрабанда: '🛡️',
	'Остров | ФЗ': '💀',
	Капты: '⚔️'
}
const SERVER_EMOJI = {
	Дроп: 'airdrop',
	Тайники: 'chest',
	Дилеры: 'dilers',
	Цеха: 'ceha',
	Поставки: 'postavka',
	'Остров | ФЗ': 'ostrov',
	Капты: 'capts'
}

function canCreateGroup(member, store) {
	return (
		!!member &&
		(member.permissions.has(PermissionFlagsBits.Administrator) ||
			member.roles.cache.some(role =>
				store.roleIds('ADMIN_ROLES').includes(role.id)
			))
	)
}

function upcomingEvents(events, now = Date.now()) {
	const today = Math.floor((now + MSK) / DAY) * DAY - MSK
	return events
		.filter(
			event =>
				!event.is247 &&
				!event.window &&
				/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)
		)
		.map(event => {
			const [hours, minutes] = event.time.split(':').map(Number)
			for (let day = 0; day <= 7; day++) {
				const timestamp = today + day * DAY + (hours * 60 + minutes) * 60000
				const weekday = WEEKDAYS[new Date(timestamp + MSK).getUTCDay()]
				if (
					timestamp > now &&
					(!event.days?.length || event.days.includes(weekday))
				)
					return { ...event, timestamp }
			}
			return null
		})
		.filter(Boolean)
		.sort((a, b) => a.timestamp - b.timestamp)
}

function selectionId(event) {
	return `${event.id}_${Math.floor(event.timestamp / 1000)}`
}

function getSchedule(now = Date.now()) {
	return {
		project: 'MAJESTIC',
		timezone: 'Europe/Moscow',
		generatedAt: now,
		events: structuredClone(events),
		upcoming: upcomingEvents(events, now)
	}
}

function buildSchedule(events, updatedAt, stale, now = Date.now(), emojis) {
	const eventEmoji = label =>
		emojis
			?.find(
				emoji => emoji.name === SERVER_EMOJI[label] && emoji.available !== false
			)
			?.toString() ||
		EVENT_EMOJI[label] ||
		'📌'
	const upcoming = upcomingEvents(events, now)
	const nearest = upcoming[0]
	const container = new ContainerBuilder({ accent_color: null })
		.addMediaGalleryComponents(
			new MediaGalleryBuilder().addItems(
				new MediaGalleryItemBuilder()
					.setURL('https://i.imgur.com/7dBrrO0.png')
					.setDescription('Расписание')
			)
		)
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent('## Расписание Majestic RP')
		)
	if (nearest) {
		container.addSectionComponents(
			new SectionBuilder()
				.addTextDisplayComponents(
					new TextDisplayBuilder().setContent(
						`### ${eventEmoji(nearest.label)} Ближайшее — ${escapeMarkdown(nearest.label)}\n**${nearest.time} МСК** · <t:${Math.floor(nearest.timestamp / 1000)}:R>`
					)
				)
				.setButtonAccessory(
					new ButtonBuilder()
						.setCustomId(`schedule_group_${selectionId(nearest)}`)
						.setLabel('Создать групп')
						.setStyle(ButtonStyle.Primary)
						.setDisabled(stale)
				)
		)
	}
	const rows = upcoming
		.slice(1, 4)
		.map(
			event =>
				`### ${eventEmoji(event.label)} ${event.time} — ${escapeMarkdown(event.label)}${event.timestamp >= Math.floor((now + MSK) / DAY) * DAY - MSK + DAY ? ' (завтра)' : ''}`
		)
	const special = events
		.filter(
			event =>
				event.is247 ||
				event.window ||
				!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)
		)
		.map(event => {
			let status = ''
			if (event.id === 'captures') {
				const moscow = new Date(now + MSK)
				const minutes = moscow.getUTCHours() * 60 + moscow.getUTCMinutes()
				const [start, end] = event.time.split('–').map(time => {
					const [hours, minutes] = time.split(':').map(Number)
					return hours * 60 + minutes
				})
				const active =
					event.days.includes(WEEKDAYS[moscow.getUTCDay()]) &&
					minutes >= start &&
					minutes < end
				status = `\nКапты ${active ? 'активны' : 'не активны'}`
			}
			return `### ${eventEmoji(event.label)} ${escapeMarkdown(event.label)} — ${escapeMarkdown(event.time)}${event.days?.length ? ` · ${event.days.join(', ')}` : ''}${event.note ? `\n${escapeMarkdown(event.note)}` : ''}${status}`
		})
	if (rows.length)
		container
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(rows.join('\n'))
			)
	for (const row of special)
		container
			.addSeparatorComponents(
				new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)
			)
			.addTextDisplayComponents(
				new TextDisplayBuilder().setContent(row.slice(0, 3000))
			)
	container.addTextDisplayComponents(
		new TextDisplayBuilder().setContent(
			`-# Время МСК · обновлено <t:${Math.floor(updatedAt / 1000)}:R>${stale ? '\n⚠️ Источник недоступен. Показано последнее полученное расписание; создание группа временно отключено.' : ''}`
		)
	)
	return {
		flags: MessageFlags.IsComponentsV2,
		components: [container],
		allowedMentions: { parse: [] }
	}
}

function createEventSchedule({ client, pool, store, now = Date.now }) {
	let timer,
		queue = Promise.resolve()
	function serialized(task) {
		const result = queue.then(task)
		queue = result.catch(() => {})
		return result
	}
	async function updateChannel(channel, messageId) {
		const snapshot = getSchedule(now())
		const payload = buildSchedule(
			snapshot.events,
			snapshot.generatedAt,
			false,
			snapshot.generatedAt,
			channel.guild?.emojis.cache
		)
		if (messageId) {
			try {
				const message = await channel.messages.fetch(messageId)
				const banner = message.attachments?.find(
					attachment => attachment.name === 'schedule.png'
				)
				payload.attachments = banner ? [{ id: banner.id }] : []
				if (banner) delete payload.files
				await message.edit(payload)
				return
			} catch (error) {
				if (error.code !== 10008) throw error
			}
		}
		const message = await channel.send(payload)
		try {
			await pool.query(
				'INSERT INTO event_schedule_messages (channel_id, message_id) VALUES ($1, $2) ON CONFLICT (channel_id) DO UPDATE SET message_id = EXCLUDED.message_id',
				[channel.id, message.id]
			)
		} catch (error) {
			await message.delete().catch(() => {})
			throw error
		}
	}
	async function tick() {
		const { rows } = await pool.query(
			'SELECT channel_id, message_id FROM event_schedule_messages'
		)
		for (const row of rows) {
			try {
				const channel = await client.channels.fetch(row.channel_id)
				await updateChannel(channel, row.message_id)
			} catch (error) {
				console.error('[Schedule] Ошибка обновления сообщения:', error.message)
			}
		}
	}
	return {
		async start() {
			await pool.query(
				'CREATE TABLE IF NOT EXISTS event_schedule_messages (channel_id TEXT PRIMARY KEY, message_id TEXT NOT NULL)'
			)
			await serialized(tick)
			timer = setInterval(
				() =>
					serialized(tick).catch(error =>
						console.error('[Schedule]', error.message)
					),
				UPDATE_INTERVAL
			)
			timer.unref()
		},
		async stop() {
			clearInterval(timer)
			await queue
		},
		canCreateGroup(member) {
			return canCreateGroup(member, store)
		},
		resolveSelection(id) {
			return (
				upcomingEvents(events, now()).find(
					event => selectionId(event) === id
				) || null
			)
		},
		publish(channel) {
			return serialized(async () => {
				const { rows } = await pool.query(
					'SELECT message_id FROM event_schedule_messages WHERE channel_id = $1',
					[channel.id]
				)
				await updateChannel(channel, rows[0]?.message_id)
			})
		}
	}
}

module.exports = {
	createEventSchedule,
	upcomingEvents,
	buildSchedule,
	canCreateGroup,
	selectionId,
	getSchedule
}
