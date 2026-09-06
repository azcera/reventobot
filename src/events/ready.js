const {
	Events,
	AttachmentBuilder,
	MediaGalleryBuilder,
	MediaGalleryItemBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ContainerBuilder,
	TextDisplayBuilder,
	SeparatorBuilder,
	MessageFlags
} = require('discord.js')
const { NewMessage } = require('telegram/events')
const path = require('path')
const { initTelegramClient } = require('../services/telegramService')

const majesticBotUsername = 'MajesticRolePlayBot'
const discordChannelId = process.env.CAPT_INFO_CHANNEL_ID
const processedCaptures = new Map()

const ATTACK_RE = /Ваша организация\s+.+?\s+напала на/i
const DEFEND_RE = /На вашу организацию\s+.+?\s+напали/i
const ATTACK_MATCH_RE = /Ваша организация\s+([^\n]+?)\s+напала на\s+([^\n!]+)/i
const DEFEND_MATCH_RE = /На вашу организацию\s+([^\n]+?)\s+напали\s+([^\n!]+)/i

module.exports = client => {
	client.once(Events.ClientReady, async readyClient => {
		console.log(`✅ Готово! Вход как ${readyClient.user.tag}`)

		try {
			const tgClient = await initTelegramClient()
			console.log('👂 Слушаю уведомления от MajesticRolePlayBot...\n')

			tgClient.addEventHandler(async event => {
				try {
					const message = event.message
					const sender = await message.getSender()

					if (
						!sender ||
						(sender.username !== majesticBotUsername &&
							sender.id?.toString() !== majesticBotUsername)
					)
						return

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

					const channel = await client.channels.fetch(discordChannelId)
					if (!channel)
						return console.error('[Discord] Канал для каптов не найден!')

					const imagePath = path.join(__dirname, '..', 'images', 'capt.png')
					const localImage = new AttachmentBuilder(imagePath, {
						name: 'capt.png'
					})
					const captImage = new MediaGalleryBuilder().addItems(
						new MediaGalleryItemBuilder()
							.setURL('attachment://capt.png')
							.setDescription('CAPT')
					)

					const enemyFaction = (isAttack ? defender : attacker).replace(
						/\s+/g,
						'-'
					)
					const cleanTime = startTime.replace(/\s+/g, '-')

					const actionRow = new ActionRowBuilder().addComponents(
						new ButtonBuilder()
							.setCustomId(`capt_${enemyFaction}_${cleanTime}`)
							.setLabel(
								isAttack
									? '⚔️ Создать регу на АТАКУ ⚔️'
									: '🛡️ Создать регу на ЗАЩИТУ 🛡️'
							)
							.setStyle(isAttack ? ButtonStyle.Success : ButtonStyle.Primary)
					)

					const container = new ContainerBuilder()
						.setAccentColor(isAttack ? 0x57f287 : 0x5865f2)
						.addMediaGalleryComponents(captImage)
						.addTextDisplayComponents(
							new TextDisplayBuilder().setContent(
								isAttack ? '# ⚔️ КАПТ АТАКА ⚔️ ' : '# 🛡️ КАПТ ЗАЩИТА 🛡️'
							)
						)
						.addSeparatorComponents(new SeparatorBuilder())
						.addTextDisplayComponents(
							new TextDisplayBuilder().setContent(
								`> ### 🆚 Против: \`${isAttack ? defender : attacker}\`\n` +
									`> ### ⏰ Начало: \`${startTime}\`\n` +
									`> ### 🗺️ Квадрат: \`${zoneName} (${zoneNum})\`\n` +
									`> ### 👥 Кол-во врагов: \`${count}\`\n` +
									`> ### ||@everyone||`
							)
						)
						.addActionRowComponents(actionRow)

					await channel.send({
						flags: [MessageFlags.IsComponentsV2],
						components: [container],
						files: [localImage]
					})
				} catch (err) {
					console.error('[Telegram Event Error]:', err)
				}
			}, new NewMessage({}))
		} catch (error) {
			console.error('❌ Критическая ошибка при запуске Telegram:', error)
		}
	})
}
