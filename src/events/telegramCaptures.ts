import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	Events,
	MessageFlags,
	SnowflakeUtil,
	TextDisplayBuilder
} from 'discord.js'
import { NewMessage } from 'teleproto/events'
import { store } from '../dashboard/store'
import { templateText } from '../dashboard/templateText'
import { ContainerBuilder } from '../services/markdownContainer'
import { initTelegramClient } from '../services/telegramService'
import { getError } from '../utils/errors'
import pool = require('../services/database')
require('dotenv').config()

const MAJESTIC_BOT_ID = '6204267987'

const ATTACK_RE = /Ваша организация\s+.+?\s+напала на/i
const DEFEND_RE = /На вашу организацию\s+.+?\s+напали/i
const ATTACK_MATCH_RE = /Ваша организация\s+([^\n]+?)\s+напала на\s+([^\n!]+)/i
const DEFEND_MATCH_RE = /На вашу организацию\s+([^\n]+?)\s+напали\s+([^\n!]+)/i

interface CaptureDelivery {
	source: string
	marker: number
	channel_id: string | null
	message_id: string | null
	started_at: Date | null
	notice: { attack: boolean; enemy: string; startTime: string; zone: string }
	payload: import('discord.js').APIContainerComponent
}

export = (client: import('discord.js').Client) => {
	let telegram: Awaited<ReturnType<typeof initTelegramClient>> | undefined
	let stopping = false
	let timer: NodeJS.Timeout | undefined
	let active: Promise<void> | undefined
	async function deliver() {
		const { rows } =
			await pool.query<CaptureDelivery>(`SELECT source, marker, channel_id, message_id, started_at, notice, payload
			FROM telegram_capture_deliveries WHERE tracked_at IS NULL AND retry_at <= NOW() ORDER BY retry_at LIMIT 20`)
		for (const row of rows) {
			if (stopping) return
			try {
				const channelId =
					row.channel_id || store.getSetting('CAPT_INFO_CHANNEL_ID')
				const channel = await client.channels.fetch(channelId)
				if (
					!channel?.isSendable() ||
					!('guildId' in channel) ||
					channel.guildId !== process.env.GUILD_ID
				) {
					throw new Error('Канал объявлений каптов недоступен.')
				}
				if (!row.message_id) {
					let existing: string | undefined
					if (row.started_at) {
						let after = SnowflakeUtil.generate({
							timestamp: row.started_at.getTime() - 5000
						}).toString()
						for (let page = 0; page < 5; page++) {
							const messages = await channel.messages.fetch({
								after,
								limit: 100,
								cache: false
							})
							existing = messages.find(
								message =>
									message.author.id === client.user?.id &&
									!message.webhookId &&
									message.components.some(
										component =>
											component.type === 17 && component.id === row.marker
									)
							)?.id
							if (existing || messages.size < 100) break
							if (page === 4)
								throw new Error(
									'Для сверки объявления требуется проверить более 500 сообщений.'
								)
							after = [...messages.keys()].reduce((a, b) =>
								BigInt(a) > BigInt(b) ? a : b
							)
						}
					} else {
						await pool.query(
							'UPDATE telegram_capture_deliveries SET channel_id = $2, started_at = NOW() WHERE source = $1',
							[row.source, channelId]
						)
					}
					row.message_id =
						existing ??
						(
							await channel.send({
								flags: MessageFlags.IsComponentsV2,
								components: [row.payload],
								nonce: 'tg-' + row.source.slice(-20),
								enforceNonce: true
							})
						).id
					await pool.query(
						'UPDATE telegram_capture_deliveries SET message_id = $2 WHERE source = $1',
						[row.source, row.message_id]
					)
				}
				if (!client.captureResults)
					throw new Error('Сервис результатов каптов ещё запускается.')
				await client.captureResults.track(
					{ id: row.message_id, guildId: channel.guildId, channelId },
					row.notice
				)
				await pool.query(
					'UPDATE telegram_capture_deliveries SET tracked_at = NOW() WHERE source = $1',
					[row.source]
				)
			} catch (error) {
				console.error('[Telegram capture delivery]', error)
				await pool.query(
					"UPDATE telegram_capture_deliveries SET retry_at = NOW() + INTERVAL '1 minute' WHERE source = $1",
					[row.source]
				)
			}
		}
	}
	function tick() {
		if (!stopping)
			active ??= deliver()
				.catch(error => console.error('[Telegram capture queue]', error))
				.finally(() => {
					active = undefined
				})
	}
	client.stopTelegramCaptures = async () => {
		stopping = true
		clearInterval(timer)
		await Promise.all([telegram?.disconnect(), active])
	}
	client.once(Events.ClientReady, async () => {
		timer = setInterval(tick, 5000)
		timer.unref()
		tick()
		try {
			const tgClient = (telegram = await initTelegramClient())
			if (stopping) {
				await tgClient.disconnect()
				return
			}
			console.log('👂 Слушаю уведомления от MajesticRolePlayBot...\n')

			tgClient.addEventHandler(async event => {
				if (stopping) return
				try {
					const message = event.message
					if (!message) return

					// Проверяем отправителя по ID без дополнительного запроса.
					const senderId = message.senderId?.toString()
					if (senderId !== MAJESTIC_BOT_ID) return

					const text = message.text || ''
					const isAttackMessage = ATTACK_RE.test(text)
					const isDefendMessage = DEFEND_RE.test(text)

					if (!isAttackMessage && !isDefendMessage) return

					const isAttack = isAttackMessage
					let attacker = 'Неизвестно'
					let defender = 'Неизвестно'

					if (isAttack) {
						const match = text.match(ATTACK_MATCH_RE)
						if (match) {
							attacker = match[1].trim()
							defender = match[2].trim()
						}
					} else {
						const match = text.match(DEFEND_MATCH_RE)
						if (match) {
							attacker = match[2].trim()
							defender = match[1].trim()
						}
					}

					if (/нейтрал/i.test(attacker) || /нейтрал/i.test(defender)) return

					const startTime = (
						text.match(/Начало:\s*([^\n]+)/i)?.[1] || 'Не указано'
					).trim()
					const zoneName = (
						text.match(/Название квадрата:\s*([^\n]+)/i)?.[1] || 'Не указано'
					).trim()
					const zoneNum = (
						text.match(/Номер квадрата:\s*([^\n]+)/i)?.[1] || 'Не указано'
					).trim()
					const count = (
						text.match(/Количество нападающих:\s*([^\n]+)/i)?.[1] ||
						'Не указано'
					).trim()

					const source = `${message.chatId ?? senderId}:${message.id}`
					const marker = message.id
					const enemyFaction = Buffer.from(isAttack ? defender : attacker)
						.toString('base64url')
						.replace(/_/g, '.')
					const cleanTime = startTime.replace(/\s+/g, '-')

					const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(`capt_tg_${enemyFaction}_${cleanTime}`)
							.setLabel(
								templateText('announcement.button', {
									icon: isAttack ? '⚔️' : '🛡️',
									target: isAttack ? 'АТАКУ' : 'ЗАЩИТУ'
								})
							)
							.setStyle(isAttack ? ButtonStyle.Success : ButtonStyle.Primary)
					)

					const container = new ContainerBuilder()
						.setId(marker)
						.setAccentColor(isAttack ? 0x57f287 : 0x5865f2)
					container
						.addTextDisplayComponents(
							new TextDisplayBuilder().setContent(
								store.text('announcement.document', {
									icon: isAttack ? '⚔️' : '🛡️',
									title: isAttack ? 'АТАКА' : 'ЗАЩИТА',
									enemy: '`' + (isAttack ? defender : attacker) + '`',
									time: '`' + startTime + '`',
									zone: '`' + zoneName + ' (' + zoneNum + ')`',
									count: '`' + count + '`'
								})
							)
						)
						.addActionRowComponents(actionRow)

					const notice = {
						attack: isAttack,
						enemy: isAttack ? defender : attacker,
						startTime,
						zone: zoneNum
					}
					await pool.query(
						`INSERT INTO telegram_capture_deliveries (source, marker, notice, payload)
						VALUES ($1, $2, $3::jsonb, $4::jsonb) ON CONFLICT (source) DO NOTHING`,
						[
							source,
							marker,
							JSON.stringify(notice),
							JSON.stringify(container.toJSON())
						]
					)
					tick()
				} catch (caught) {
					const err = getError(caught)
					console.error('[Telegram Event Error]:', err)
				}
			}, new NewMessage({}))
		} catch (caught) {
			const error = getError(caught)
			console.error('❌ Критическая ошибка при запуске Telegram:', error)
		}
	})
}
