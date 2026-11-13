import { templateText } from '../dashboard/templateText'
import { getError } from '../utils/errors'
import {
	Events,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	TextDisplayBuilder,
	MessageFlags
} from 'discord.js'
import { NewMessage } from 'teleproto/events'
import { ContainerBuilder } from '../services/markdownContainer'
import { initTelegramClient } from '../services/telegramService'
import { store } from '../dashboard/store'
require('dotenv').config()

const MAJESTIC_BOT_ID = '6204267987'
const processedCaptures = new Map()

const ATTACK_RE = /Ваша организация\s+.+?\s+напала на/i
const DEFEND_RE = /На вашу организацию\s+.+?\s+напали/i
const ATTACK_MATCH_RE = /Ваша организация\s+([^\n]+?)\s+напала на\s+([^\n!]+)/i
const DEFEND_MATCH_RE = /На вашу организацию\s+([^\n]+?)\s+напали\s+([^\n!]+)/i

export = (client: import('discord.js').Client) => {
	client.once(Events.ClientReady, async readyClient => {
		try {
			const tgClient = await initTelegramClient()
			console.log('👂 Слушаю уведомления от MajesticRolePlayBot...\n')

			tgClient.addEventHandler(async event => {
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

					const captKey = `${attacker}_${defender}_${startTime}_${zoneNum}`
						.toLowerCase()
						.replace(/\s+/g, '')

					if (processedCaptures.has(captKey)) return

					processedCaptures.set(captKey, true)
					setTimeout(() => {
						processedCaptures.delete(captKey)
					}, 300000)

					console.log(
						`[Telegram] Обнаружен капт: ${attacker} vs ${defender} (Квадрат ${zoneNum})`
					)

					const channel = await client.channels.fetch(
						store.getSetting('CAPT_INFO_CHANNEL_ID')
					)
					if (!channel?.isSendable())
						return console.error('[Discord] Канал для каптов не найден!')

					const enemyFaction = Buffer.from(isAttack ? defender : attacker)
						.toString('base64url')
						.replace(/_/g, '.')
					const cleanTime = startTime.replace(/\s+/g, '-')

					const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
						new ButtonBuilder()
							.setCustomId(`capt_tg_${enemyFaction}_${cleanTime}`)
							.setLabel(
								templateText('announcement.button', { icon: isAttack ? '⚔️' : '🛡️', target: isAttack ? 'АТАКУ' : 'ЗАЩИТУ' })
							)
							.setStyle(isAttack ? ButtonStyle.Success : ButtonStyle.Primary)
					)

					const container = new ContainerBuilder()
						.setAccentColor(isAttack ? 0x57f287 : 0x5865f2)
					container.addTextDisplayComponents(new TextDisplayBuilder().setContent(store.text('announcement.document', {
						icon: isAttack ? '⚔️' : '🛡️', title: isAttack ? 'АТАКА' : 'ЗАЩИТА',
						enemy: '`' + (isAttack ? defender : attacker) + '`', time: '`' + startTime + '`',
						zone: '`' + zoneName + ' (' + zoneNum + ')`', count: '`' + count + '`'
					})))
						.addActionRowComponents(actionRow)

					const sent = await channel.send({
						flags: MessageFlags.IsComponentsV2 as const,
						components: [container]
					})
					await client.captureResults?.track(sent, {
						attack: isAttack, enemy: isAttack ? defender : attacker, startTime, zone: zoneNum
					})
				} catch (caught) {
 const err = getError(caught);
					console.error('[Telegram Event Error]:', err)
				}
			}, new NewMessage({}))
		} catch (caught) {
 const error = getError(caught);
			console.error('❌ Критическая ошибка при запуске Telegram:', error)
		}
	})
}
