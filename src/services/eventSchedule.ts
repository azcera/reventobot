import { getError } from '../utils/errors'
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import {
	SectionBuilder,
	TextDisplayBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	PermissionFlagsBits,
	SeparatorBuilder,
	SeparatorSpacingSize,
	escapeMarkdown
} from 'discord.js'
import { ContainerBuilder } from './markdownContainer'
import events = require('../config/eventSchedule')

const UPDATE_INTERVAL = 15 * 60000
const DAY = 86400000
const MSK = 3 * 3600000
const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']
interface ScheduleEvent { id: string; label: string; time: string; days: string[]; is247?: boolean; window?: boolean; note?: string }
type UpcomingEvent = ScheduleEvent & { timestamp: number }
const EVENT_EMOJI: Record<string, string> = {
	Дроп: '📍',
	Тайники: '🔒',
	Дилеры: '💊',
	Цеха: '🏭',
	Поставки: '🚚',
	Контрабанда: '🛡️',
	'Остров | ФЗ': '💀',
	Капты: '⚔️'
}
const SERVER_EMOJI: Record<string, string> = {
	Дроп: 'airdrop',
	Тайники: 'chest',
	Дилеры: 'dilers',
	Цеха: 'ceha',
	Поставки: 'postavka',
	'Остров | ФЗ': 'ostrov',
	Капты: 'capts'
}

function canCreateGroup(member: D.GuildMember, store: T.Store) {
	return (
		!!member &&
		(member.permissions.has(PermissionFlagsBits.Administrator) ||
			member.roles.cache.some(role =>
				store.roleIds('ADMIN_ROLES').includes(role.id)
			))
	)
}

function upcomingEvents(events: ScheduleEvent[], now = Date.now()) {
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
		.filter((event): event is UpcomingEvent => Boolean(event))
		.sort((a, b) => a.timestamp - b.timestamp)
}

function selectionId(event: UpcomingEvent) {
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

function buildSchedule(events: ScheduleEvent[], updatedAt: number, stale: boolean, now = Date.now(), emojis?: D.Collection<string, D.GuildEmoji>, banner = ''): D.MessageCreateOptions & D.MessageEditOptions {
	const eventEmoji = (label: string) =>
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
	if (banner) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(banner))
	container
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

function createEventSchedule({ client, pool, store, now = Date.now }: T.ServiceOptions & { now?: () => number }) {
	let timer: ReturnType<typeof setInterval> | undefined
	let queue: Promise<unknown> = Promise.resolve()
	function serialized<R>(task: () => Promise<R>) {
		const result = queue.then(task)
		queue = result.catch(() => {})
		return result
	}
	async function updateChannel(channel: D.GuildTextBasedChannel | null, messageId?: string) {
		if (!channel || !channel.isTextBased()) throw new Error('Канал расписания недоступен')
		const snapshot = getSchedule(now())
		const payload = buildSchedule(
			snapshot.events,
			snapshot.generatedAt,
			false,
			snapshot.generatedAt,
			channel.guild?.emojis.cache,
			store.text('schedule.banner')
		)
		if (messageId) {
			try {
				const message = await channel.messages.fetch(messageId)
				await message.edit(payload)
				return
			} catch (caughtError) {
 const error = getError(caughtError)

				if (error.code !== 10008) throw error
			}
		}
		const message = await channel.send(payload)
		try {
			await pool.query(
				'INSERT INTO event_schedule_messages (channel_id, message_id) VALUES ($1, $2) ON CONFLICT (channel_id) DO UPDATE SET message_id = EXCLUDED.message_id',
				[channel.id, message.id]
			)
		} catch (caughtError) {
 const error = getError(caughtError)

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
				await updateChannel(channel?.isTextBased() && 'guild' in channel ? channel : null, row.message_id)
			} catch (caughtError) {
 const error = getError(caughtError)

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
		canCreateGroup(member: D.GuildMember) {
			return canCreateGroup(member, store)
		},
		resolveSelection(id: string) {
			return (
				upcomingEvents(events, now()).find(
					event => selectionId(event) === id
				) || null
			)
		},
		publish(channel: D.GuildTextBasedChannel) {
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

export {
	createEventSchedule,
	upcomingEvents,
	buildSchedule,
	canCreateGroup,
	selectionId,
	getSchedule
}
