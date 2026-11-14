import { randomBytes } from 'node:crypto'
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags, PermissionFlagsBits, StringSelectMenuBuilder, TextDisplayBuilder } from 'discord.js'
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js'
import pool = require('../../services/database')
import { store } from '../../dashboard/store'
import { captureExpired } from './captureExpiry'
import { completeCaptureChange, joinedPlayers, redistributeApproved, sortByRolePriority } from './captureManager'

type Interaction = ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>
type StoredList<T> = T[] | string | null
interface CaptureRow {
	discord_timestamp: string
	main_list: StoredList<string>
	reserve_list: StoredList<string>
	main_list_meta: StoredList<{ userId?: string; joinedAt: number }>
	reserve_list_meta: StoredList<{ userId?: string; joinedAt: number }>
	approved_users: StoredList<string>
	max_main: number | null
	approval_page: number | null
	sort_mode: string | null
}
interface Panel {
	messageId: string
	channelId: string
	userId: string
	players: string[]
	page: number
	selected: string[]
	expires: number
	busy: boolean
}
const panels = new Map<string, Panel>()
const PAGE_SIZE = 5

function array<T>(value: T[] | string | null | undefined): T[] {
	if (typeof value === 'string') return JSON.parse(value)
	return value ?? []
}

function snapshot(row: CaptureRow, interaction: Interaction) {
	const players = joinedPlayers(array(row.main_list), array(row.reserve_list), array(row.main_list_meta), array(row.reserve_list_meta))
	return row.sort_mode === 'time' ? players.map(player => player.userId) : sortByRolePriority(players, interaction.guild)
}

function pagePlayers(panel: Panel) {
	return panel.players.slice(panel.page * PAGE_SIZE, (panel.page + 1) * PAGE_SIZE)
}

function render(token: string, panel: Panel, row: CaptureRow, interaction: Interaction, notice = '') {
	const approved = new Set(array<string>(row.approved_users))
	const joined = new Set([...array<string>(row.main_list), ...array<string>(row.reserve_list)])
	const expired = captureExpired(row.discord_timestamp)
	const pages = Math.max(1, Math.ceil(panel.players.length / PAGE_SIZE))
	const players = pagePlayers(panel)
	const id = (action: string) => `capt_panel_${token}_${action}`
	const button = (action: string, label: string, disabled = false) => new ButtonBuilder().setCustomId(id(action)).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled)
	const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(
		`## Управление составом\nПодтверждено: ${approved.size}/${row.max_main || 20}. Страница ${panel.page + 1}/${pages}.\nНовые записи появятся после «Обновить». Выбор действует на текущую страницу.${notice ? `\n${notice}` : ''}`
	))
	for (const userId of players) {
		const name = interaction.guild.members.cache.get(userId)?.displayName || userId
		const status = !joined.has(userId) ? 'Вышел' : approved.has(userId) ? 'Подтверждён' : 'Ожидает'
		container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
			button(`${approved.has(userId) ? 'remove' : 'add'}:${userId}`, `${status} · ${name} · ${approved.has(userId) ? 'Снять' : 'Подтвердить'}`.slice(0, 80), expired || !joined.has(userId))
		))
	}
	if (players.length) {
		container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
			new StringSelectMenuBuilder().setCustomId(id('select')).setPlaceholder('Выбрать игроков для пакетного действия')
				.setMinValues(0).setMaxValues(players.length).setDisabled(expired).addOptions(players.map(userId => ({
					label: (interaction.guild.members.cache.get(userId)?.displayName || userId).slice(0, 100), value: userId, default: panel.selected.includes(userId)
				})))
		))
		container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
			button('add', 'Подтвердить выбранных', expired || !panel.selected.length),
			button('remove', 'Снять подтверждение', expired || !panel.selected.length)
		))
	}
	container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
		button('prev', 'Назад', panel.page === 0), button('next', 'Далее', panel.page >= pages - 1), button('refresh', 'Обновить')
	))
	return { flags: MessageFlags.IsComponentsV2 as const, components: [container], allowedMentions: { parse: [] as const } }
}

export async function handleCapturePanel(interaction: Interaction) {
	const roles = store.roleIds('ADMIN_ROLES')
	if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) && !roles.some(id => interaction.member.roles.cache.has(id))) {
		await interaction.reply({ content: '❌ У вас нет прав для управления набором.', flags: MessageFlags.Ephemeral })
		return
	}
	for (const [key, panel] of panels) if (panel.expires <= Date.now() && !panel.busy) panels.delete(key)
	const opening = interaction.customId === 'capt_manage' || interaction.customId.startsWith('capt_approve_')
	const [, , token, action] = interaction.customId.split('_')
	let panel = opening ? undefined : panels.get(token)
	if (!opening && (!panel || panel.userId !== interaction.user.id || panel.channelId !== interaction.channelId)) {
		await interaction.reply({ content: 'Панель устарела. Откройте «Управление составом» заново.', flags: MessageFlags.Ephemeral })
		return
	}
	if (panel?.busy) {
		await interaction.reply({ content: 'Предыдущее действие ещё сохраняется.', flags: MessageFlags.Ephemeral })
		return
	}
	if (panel) panel.busy = true
	let client
	try {
		if (opening) await interaction.deferReply({ flags: MessageFlags.Ephemeral })
		else await interaction.deferUpdate()
		const mutation = !opening && (action === 'add' || action === 'remove' || action.startsWith('add:') || action.startsWith('remove:'))
		client = await pool.connect()
		if (mutation) await client.query('BEGIN')
		const { rows } = await client.query<CaptureRow>(`SELECT * FROM active_captures WHERE message_id = $1${mutation ? ' FOR UPDATE' : ''}`, [panel?.messageId ?? interaction.message.id])
		const row = rows[0]
		if (!row) {
			if (mutation) await client.query('ROLLBACK')
			client.release()
			client = undefined
			await interaction.editReply({ flags: MessageFlags.IsComponentsV2, components: [new TextDisplayBuilder().setContent('Регистрация больше неактивна.')] })
			return
		}
		const key = opening ? randomBytes(12).toString('hex') : token
		if (!panel) {
			panel = { messageId: interaction.message.id, channelId: interaction.channelId, userId: interaction.user.id,
				players: snapshot(row, interaction), page: 0, selected: [], expires: Date.now() + 15 * 60_000, busy: true }
			panels.set(key, panel)
		}
		let notice = ''
		let promoted: string[] = []
		if (mutation) {
			if (captureExpired(row.discord_timestamp)) {
				await client.query('ROLLBACK')
				notice = 'Сбор завершён: с его начала прошёл час.'
			} else {
				const [operation, userId] = action.split(':')
				const visible = pagePlayers(panel)
				const requested = (userId ? [userId] : panel.selected).filter(id => visible.includes(id))
				const joined = new Set([...array<string>(row.main_list), ...array<string>(row.reserve_list)])
				const approved = new Set(array<string>(row.approved_users))
				let changed = 0, left = 0, full = 0, unchanged = 0
				for (const id of requested) {
					if (!joined.has(id)) { left++; continue }
					if (operation === 'remove') {
						if (approved.delete(id)) changed++
						else unchanged++
					} else if (approved.has(id)) unchanged++
					else if (approved.size >= (row.max_main || 20)) full++
					else { approved.add(id); changed++ }
				}
				const lists = redistributeApproved(array(row.main_list), array(row.reserve_list), array(row.main_list_meta), array(row.reserve_list_meta), [...approved], row.max_main || 20)
				promoted = lists.mainList.filter(id => array<string>(row.reserve_list).includes(id))
				await client.query('UPDATE active_captures SET approved_users = $1, approval_page = $2, main_list = $3, reserve_list = $4, main_list_meta = $5, reserve_list_meta = $6, sort_mode = $8 WHERE message_id = $7',
					[JSON.stringify([...approved]), row.approval_page || 0, JSON.stringify(lists.mainList), JSON.stringify(lists.reserveList), JSON.stringify(lists.mainMeta), JSON.stringify(lists.reserveMeta), panel.messageId, row.sort_mode])
				await client.query('COMMIT')
				Object.assign(row, { approved_users: [...approved], main_list: lists.mainList, reserve_list: lists.reserveList })
				notice = `Изменено: ${changed}. Уже в нужном состоянии: ${unchanged}. Вышли: ${left}. Не хватило мест: ${full}.`
				panel.selected = []
			}
		} else if (!opening) {
			if (action === 'refresh') { panel.players = snapshot(row, interaction); panel.page = 0 }
			if (action === 'prev') panel.page = Math.max(0, panel.page - 1)
			if (action === 'next') panel.page = Math.min(Math.max(0, Math.ceil(panel.players.length / PAGE_SIZE) - 1), panel.page + 1)
			panel.selected = action === 'select' && interaction.isStringSelectMenu() ? interaction.values.filter(id => pagePlayers(panel!).includes(id)) : []
		}
		client.release()
		client = undefined
		if (mutation && !captureExpired(row.discord_timestamp)) {
			try {
				const channel = interaction.channel
				if (!channel || !('messages' in channel)) throw new Error('Канал регистрации недоступен')
				const message = await channel.messages.fetch(panel.messageId)
				await completeCaptureChange(interaction, promoted, undefined, message)
			} catch (error) {
				console.error('[Capture panel refresh]', error)
				await interaction.followUp({ content: 'Изменения сохранены, но обновить общее сообщение не удалось.', flags: MessageFlags.Ephemeral }).catch(console.error)
			}
		}
		await interaction.editReply(render(key, panel, row, interaction, notice))
	} catch (error) {
		if (client) await client.query('ROLLBACK').catch(console.error)
		console.error('[Capture panel]', error)
		await interaction.followUp({ content: 'Не удалось выполнить действие. Обновите панель и проверьте состав.', flags: MessageFlags.Ephemeral }).catch(console.error)
	} finally {
		client?.release()
		if (panel) panel.busy = false
	}
}
