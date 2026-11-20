import {
	captureSortLabel, captureSortPreference, compareCaptureRanks,
	nextCaptureSort, saveCaptureSort
} from './captureSort'
import { enqueueCaptureEdit } from './captureMessageQueue'
import {
	collectionSortId,
	completeCollectionCreation,
	isCollectionSort
} from './collectionCreation'
interface JoinedPlayer {
	userId?: string
	joinedAt: number
}
function captureArray(value: unknown): unknown[] {
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value) as unknown
		} catch {
			return []
		}
	}
	return Array.isArray(value) ? value : []
}
function readIds(value: unknown): string[] {
	return captureArray(value).filter(
		(id): id is string => typeof id === 'string'
	)
}
function readMeta(value: unknown): JoinedPlayer[] {
	return captureArray(value).filter(
		(item): item is JoinedPlayer =>
			typeof item === 'object' &&
			item !== null &&
			'joinedAt' in item &&
			typeof item.joinedAt === 'number'
	)
}

import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	MessageFlags,
	PermissionFlagsBits,
	TextDisplayBuilder
} from 'discord.js'
import { store as dashboard } from '../../dashboard/store'
import { ContainerBuilder } from '../../services/markdownContainer'
import { getError } from '../../utils/errors'
import { captureExpired } from './captureExpiry'
require('dotenv').config()

import pool = require('../../services/database.js')

const APPROVAL_PAGE_SIZE = 50
const capturePageCount = (joined: number, left: number) =>
	Math.max(1, Math.ceil(Math.max(joined, left) / APPROVAL_PAGE_SIZE))

function joinedPlayers(
	mainList: string[],
	reserveList: string[],
	mainMeta: JoinedPlayer[],
	reserveMeta: JoinedPlayer[]
) {
	return [...mainList, ...reserveList]
		.map((userId, index) => {
			const meta =
				index < mainList.length
					? mainMeta[index]
					: reserveMeta[index - mainList.length]
			return { userId, joinedAt: meta?.joinedAt ?? index }
		})
		.sort((a, b) => a.joinedAt - b.joinedAt)
}

function redistributeApproved(
	mainList: string[],
	reserveList: string[],
	mainMeta: JoinedPlayer[],
	reserveMeta: JoinedPlayer[],
	approved: string[],
	maxMain: number
) {
	const selected = new Set(approved)
	const players = joinedPlayers(mainList, reserveList, mainMeta, reserveMeta)
	const main = approved.length
		? players.filter(player => selected.has(player.userId))
		: players.slice(0, maxMain)
	const reserve = approved.length
		? players.filter(player => !selected.has(player.userId))
		: players.slice(maxMain)
	return {
		mainList: main.map(p => p.userId),
		reserveList: reserve.map(p => p.userId),
		mainMeta: main,
		reserveMeta: reserve
	}
}

// Parse PRIORITY_ROLES from env: comma-separated role IDs, highest priority first

/**
 * Gets the priority index for a member based on their highest role.
 * Returns index in PRIORITY_ROLES array, or PRIORITY_ROLES.length if no match.
 * @param {GuildMember} member
 * @returns {number}
 */
function getRolePriority(member: import('discord.js').GuildMember) {
	for (let i = 0; i < dashboard.roleIds('PRIORITY_ROLES').length; i++) {
		if (member.roles.cache.has(dashboard.roleIds('PRIORITY_ROLES')[i])) return i
	}
	return dashboard.roleIds('PRIORITY_ROLES').length // lowest priority (after all configured roles)
}

/**
 * Sorts a list of user objects by role priority, then by join timestamp.
 * Each item: { userId, joinedAt }
 * @param {Array<{userId: string, joinedAt: number}>} list
 * @param {Guild} guild
 * @returns {Array<string>} sorted userIds
 */
function sortByRolePriority(
	list: Array<{ userId: string; joinedAt: number }>,
	guild: import('discord.js').Guild,
	ranks?: ReadonlyMap<string, number>
) {
	return [...list]
		.sort((a, b) => {
			const difference = compareCaptureRanks(ranks?.get(a.userId), ranks?.get(b.userId))
			if (difference) return difference
			const memberA = guild.members.cache.get(a.userId)
			const memberB = guild.members.cache.get(b.userId)

			const priorityA = memberA
				? getRolePriority(memberA)
				: dashboard.roleIds('PRIORITY_ROLES').length
			const priorityB = memberB
				? getRolePriority(memberB)
				: dashboard.roleIds('PRIORITY_ROLES').length

			if (priorityA !== priorityB) return priorityA - priorityB

			// Same priority: earlier join timestamp comes first
			return a.joinedAt - b.joinedAt
		})
		.map(item => item.userId)
}

function buildCaptureMessage(
	discordTimestamp: string,
	mainList: string[],
	reserveList: string[],
	leftList: string[],
	target: string,
	maxMain: number,
	guild: import('discord.js').Guild | undefined = undefined,
	mainListMeta: JoinedPlayer[] = [],
	reserveListMeta: JoinedPlayer[] = [],
	approvedUsers: string[] = [],
	approvalPage = 0,
	sortMode: string = 'priority',
	creationKey?: string
) {
	const approved = new Set(approvedUsers)
	const expired = captureExpired(discordTimestamp)
	const pageCount = capturePageCount(
		mainList.length + reserveList.length,
		leftList.length
	)
	approvalPage = Math.max(0, Math.min(approvalPage, pageCount - 1))
	const players = joinedPlayers(
		mainList,
		reserveList,
		mainListMeta,
		reserveListMeta
	)
	const timeMode = sortMode === 'time'
	const ranks = guild?.client?.captureRankings?.byDiscord(guild)
	const playerLabel = (id: string) => {
		const rank = ranks?.get(id)
		return rank ? `<@${id}> · #${rank}` : `<@${id}>`
	}
	const currentOrder =
		!timeMode && guild
			? sortByRolePriority(players, guild, sortMode === 'rating' ? ranks : undefined)
			: players.map(player => player.userId)
	const visible = new Set(
		currentOrder.slice(
			approvalPage * APPROVAL_PAGE_SIZE,
			(approvalPage + 1) * APPROVAL_PAGE_SIZE
		)
	)
	const confirmed = currentOrder.filter(id => approved.has(id))
	const waiting = currentOrder.filter(id => !approved.has(id))
	const list = (ids: string[]) =>
		ids
			.map((id, index) => ({ id, index }))
			.filter(({ id }) => visible.has(id))
			.map(({ id, index }) => `${index + 1}. ${playerLabel(id)}`)
			.join('\n') || 'Пусто'
	const containerComponent = new ContainerBuilder()
		.addTextDisplayComponents(
			new TextDisplayBuilder().setContent(
				dashboard.text('registration.document', {
					target: target ?? 'мероприятие',
					time: discordTimestamp,
					limit: maxMain,
					mode: captureSortLabel(sortMode).toLowerCase(),
					page: approvalPage + 1,
					pages: pageCount,
					confirmedCount: confirmed.length,
					confirmedPlayers: list(confirmed),
					waitingCount: waiting.length,
					waitingPlayers: list(waiting),
					leftCount: leftList.length,
					leftPlayers:
						leftList
							.slice(
								approvalPage * APPROVAL_PAGE_SIZE,
								(approvalPage + 1) * APPROVAL_PAGE_SIZE
							)
							.map(id => `• <@${id}>`)
							.join('\n') || 'Пусто'
				})
			)
		)
		.addActionRowComponents(
			new ActionRowBuilder<
				import('discord.js').MessageActionRowComponentBuilder
			>().addComponents(
				new ButtonBuilder()
					.setCustomId(
						creationKey
							? collectionSortId + ':' + creationKey
							: collectionSortId
					)
					.setLabel(
						sortMode === 'rating' ? captureSortLabel(sortMode) :
							dashboard.text(timeMode ? 'registration.sortTime' : 'registration.sortPriority')
					)
					.setStyle(ButtonStyle.Secondary)
			)
		)

	// Кнопки управления для участников и админов
	const buttonsRow = new ActionRowBuilder<
		import('discord.js').MessageActionRowComponentBuilder
	>().addComponents(
		new ButtonBuilder()
			.setCustomId('capt_join')
			.setLabel(dashboard.text('registration.join'))
			.setDisabled(expired)
			.setStyle(ButtonStyle.Success),
		new ButtonBuilder()
			.setCustomId('capt_leave')
			.setLabel(dashboard.text('registration.leave'))
			.setDisabled(expired)
			.setStyle(ButtonStyle.Danger),
		new ButtonBuilder()
			.setCustomId('capt_edit_time_trigger') // Название кнопки для перехвата админ права
			.setLabel(dashboard.text('registration.editTime'))
			.setDisabled(expired)
			.setStyle(ButtonStyle.Secondary)
	)
	containerComponent.addActionRowComponents(
		new ActionRowBuilder<
			import('discord.js').MessageActionRowComponentBuilder
		>().addComponents(
			new ButtonBuilder()
				.setCustomId('capt_manage')
				.setLabel('Управление составом')
				.setStyle(ButtonStyle.Primary)
				.setDisabled(expired)
		)
	)
	if (pageCount > 1)
		buttonsRow.addComponents(
			new ButtonBuilder()
				.setCustomId(`capt_approval_page_${approvalPage - 1}`)
				.setLabel(dashboard.text('registration.previous'))
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(approvalPage === 0),
			new ButtonBuilder()
				.setCustomId(`capt_approval_page_${approvalPage + 1}`)
				.setLabel(dashboard.text('registration.next'))
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(approvalPage >= pageCount - 1)
		)

	return {
		flags: MessageFlags.IsComponentsV2 as const,
		components: [
			dashboard.decorate('registration', containerComponent),
			buttonsRow
		]
	}
}

async function sendCollection(
	interaction:
		| import('discord.js').ButtonInteraction<'cached'>
		| import('discord.js').ModalSubmitInteraction<'cached'>,
	discordTimestamp: string,
	target: string = 'капт',
	maxMain: number = 20,
	sendReminders = true,
	channelId?: string
) {
	const guild = interaction.guild
	const channel = channelId
		? await guild.channels.fetch(channelId)
		: guild.channels.cache.get(dashboard.getSetting('PLUS_CHANNEL_ID'))
	if (!channel?.isSendable()) throw new Error('Канал регистрации недоступен')

	const key = interaction.id
	const sortMode = await captureSortPreference(pool, guild.id)
	const messageData = buildCaptureMessage(
		discordTimestamp,
		[],
		[],
		[],
		target,
		maxMain,
		guild,
		[],
		[],
		[],
		0,
		sortMode,
		key
	)
	for (const component of messageData.components) component.toJSON()
	const claim = await pool.query(
		`INSERT INTO collection_creations
		(creation_key, expires_at, channel_id, guild_id, discord_timestamp, target, max_main, sort_mode)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (creation_key) DO NOTHING RETURNING creation_key`,
		[
			key,
			new Date(Date.now() + 3600000),
			channel.id,
			guild.id,
			discordTimestamp,
			target,
			maxMain,
			sortMode
		]
	)
	if (!claim.rows.length) {
		const { rows } = await pool.query(
			'SELECT message_url FROM collection_creations WHERE creation_key = $1',
			[key]
		)
		if (rows[0]?.message_url) return rows[0].message_url as string
		throw new Error('Создание этого сбора ещё проверяется.')
	}
	const message = await channel.send({
		...messageData,
		nonce: key,
		enforceNonce: true
	})
	if (!(await completeCollectionCreation(pool, key, message))) {
		const { rows } = await pool.query(
			'SELECT message_url FROM collection_creations WHERE creation_key = $1',
			[key]
		)
		if (rows[0]?.message_url === message.url) return message.url
		throw new Error('Не удалось подтвердить запись сбора.')
	}
	if (sendReminders) {
		try {
			for (let i = 0; i < 3; i++) {
				await channel.send({
					content: `<@&${dashboard.getSetting('AUTO_ROLE')}> рега выше`
				})
			}
		} catch (error) {
			console.error('Не удалось отправить напоминания о наборе:', error)
		}
	}
	return message.url
}

function renderCapture(
	row: any,
	guild: import('discord.js').Guild | undefined
) {
	return buildCaptureMessage(
		row.discord_timestamp,
		readIds(row.main_list),
		readIds(row.reserve_list),
		readIds(row.left_list),
		row.target,
		row.max_main || 20,
		guild,
		readMeta(row.main_list_meta),
		readMeta(row.reserve_list_meta),
		readIds(row.approved_users),
		row.approval_page || 0,
		row.sort_mode
	)
}

type CaptureInteraction =
	| import('discord.js').ButtonInteraction<'cached'>
	| import('discord.js').StringSelectMenuInteraction<'cached'>
const captureRefreshes = new Map<
	string,
	{ revision: number; promise: Promise<void> }
>()

// Coalesce participant changes, reading the latest committed state inside the edit queue.
async function refreshCapture(
	interaction: CaptureInteraction,
	message?: import('discord.js').Message<true>
) {
	const id = message?.id ?? interaction.message.id
	const pending = captureRefreshes.get(id)
	if (pending) {
		pending.revision++
		return pending.promise
	}
	const refresh = async () => {
		const { rows } = await pool.query(
			'SELECT * FROM active_captures WHERE message_id = $1',
			[id]
		)
		const row = rows[0]
		if (!row) return
		const payload = renderCapture(row, interaction.guild)
		if (message) await message.edit(payload)
		else await interaction.editReply(payload)
		await confirmCaptureRefresh(id, row.message_revision)
	}
	const state = { revision: 0, promise: Promise.resolve() }
	state.promise = enqueueCaptureEdit(id, async () => {
		let revision
		do {
			revision = state.revision
			try {
				await refresh()
			} catch {
				await refresh()
			}
		} while (revision !== state.revision)
	}).finally(() => {
		captureRefreshes.delete(id)
	})
	captureRefreshes.set(id, state)
	return state.promise
}

async function confirmCaptureRefresh(id: string, revision: string) {
	await pool.query(
		`UPDATE active_captures SET message_refresh_pending = FALSE
		WHERE message_id = $1 AND message_revision = $2`,
		[id, revision]
	)
}

async function updateCollectionTime(
	messageId: string,
	channelId: string,
	client: import('discord.js').Client
) {
	await enqueueCaptureEdit(messageId, async () => {
		const { rows } = await pool.query(
			'SELECT * FROM active_captures WHERE message_id = $1',
			[messageId]
		)
		const row = rows[0]
		if (!row) return
		const channel = await client.channels.fetch(channelId)
		if (!channel?.isTextBased())
			throw new Error('Канал регистрации недоступен.')
		const message = await channel.messages.fetch(messageId)
		await message.edit(renderCapture(row, message.guild ?? undefined))
		await confirmCaptureRefresh(messageId, row.message_revision)
	})
}

async function completeCaptureChange(
	interaction: CaptureInteraction,
	promoted: string[],
	content?: string,
	message?: import('discord.js').Message<true>
) {
	await Promise.all([
		refreshCapture(interaction, message).catch(async error => {
			console.error('[Capture refresh]', error)
			await interaction
				.followUp({
					content:
						'Запись сохранена, но обновить общий список пока не удалось.',
					flags: MessageFlags.Ephemeral
				})
				.catch(console.error)
		}),
		content
			? interaction
					.followUp({
						content,
						flags: MessageFlags.Ephemeral,
						allowedMentions: { parse: [] }
					})
					.catch(console.error)
			: Promise.resolve(),
		...promoted.map(async id => {
			try {
				const user = await interaction.client.users.fetch(id)
				await user.send({
					content: `✅ Вы переведены из резерва в основной состав!\n${message?.url ?? interaction.message.url}`,
					allowedMentions: { parse: [] }
				})
			} catch (error) {
				console.error('[Capture promotion DM]', id, getError(error).message)
			}
		})
	])
}

async function handleButton(
	interaction: import('discord.js').ButtonInteraction<'cached'>
) {
	if (!interaction.isButton()) return
	if (
		interaction.customId !== 'capt_join' &&
		interaction.customId !== 'capt_leave'
	)
		return

	// Сразу подтверждаем, чтобы Discord не слал "не ответило вовремя"
	await interaction.deferUpdate()

	const messageId = interaction.message.id
	const userId = interaction.user.id

	let client
	try {
		client = await pool.connect()
		await client.query('BEGIN')

		const res = await client.query(
			'SELECT * FROM active_captures WHERE message_id = $1 FOR UPDATE',
			[messageId]
		)
		const row = res.rows[0]

		if (!row) {
			await client.query('ROLLBACK')
			return interaction
				.followUp({
					content: '❌ Данная регистрация устарела или неактивна.',
					flags: MessageFlags.Ephemeral as const
				})
				.catch(() => {})
		}

		const discordTimestamp = row.discord_timestamp
		if (captureExpired(discordTimestamp)) {
			await client.query('ROLLBACK')
			return interaction.followUp({
				content: '❌ Сбор завершён: с его начала прошёл час.',
				flags: MessageFlags.Ephemeral
			})
		}
		const maxMain = row.max_main || 20

		let mainList = readIds(row.main_list)
		let reserveList = readIds(row.reserve_list)
		let leftList = readIds(row.left_list)
		let mainListMeta = readMeta(row.main_list_meta)
		let reserveListMeta = readMeta(row.reserve_list_meta)
		let approvedUsers = readIds(row.approved_users)

		if (interaction.customId === 'capt_join') {
			if (mainList.includes(userId) || reserveList.includes(userId)) {
				await client.query('ROLLBACK')
				return interaction
					.followUp({
						content: 'Вы уже записаны на мероприятие!',
						flags: MessageFlags.Ephemeral as const
					})
					.catch(() => {})
			}

			const leftIndex = leftList.indexOf(userId)
			if (leftIndex !== -1) leftList.splice(leftIndex, 1)

			const now = Date.now()
			if (approvedUsers.length === 0 && mainList.length < maxMain) {
				mainList.push(userId)
				mainListMeta.push({ userId, joinedAt: now })
			} else {
				reserveList.push(userId)
				reserveListMeta.push({ userId, joinedAt: now })
			}
		} else if (interaction.customId === 'capt_leave') {
			const mainIndex = mainList.indexOf(userId)
			const reserveIndex = reserveList.indexOf(userId)

			if (mainIndex === -1 && reserveIndex === -1) {
				await client.query('ROLLBACK')
				return interaction
					.followUp({
						content: 'Вас и так нет в списках.',
						flags: MessageFlags.Ephemeral as const
					})
					.catch(() => {})
			}

			if (mainIndex !== -1) {
				mainList.splice(mainIndex, 1)
				mainListMeta.splice(mainIndex, 1)
				if (approvedUsers.length === 0 && reserveList.length > 0) {
					const movingPlayer = reserveList.shift()!
					const movingMeta = reserveListMeta.shift() || {
						userId: movingPlayer,
						joinedAt: Date.now()
					}
					mainList.push(movingPlayer)
					mainListMeta.push(movingMeta)
				}
			} else if (reserveIndex !== -1) {
				reserveList.splice(reserveIndex, 1)
				reserveListMeta.splice(reserveIndex, 1)
			}

			if (!leftList.includes(userId)) {
				leftList.push(userId)
			}
			const wasApproved = approvedUsers.includes(userId)
			approvedUsers = approvedUsers.filter(id => id !== userId)
			if (wasApproved && approvedUsers.length === 0) {
				const lists = redistributeApproved(
					mainList,
					reserveList,
					mainListMeta,
					reserveListMeta,
					approvedUsers,
					maxMain
				)
				mainList = lists.mainList
				reserveList = lists.reserveList
				mainListMeta = lists.mainMeta
				reserveListMeta = lists.reserveMeta
			}
		}

		await client.query(
			`UPDATE active_captures 
         SET main_list = $1, reserve_list = $2, left_list = $3, main_list_meta = $4, reserve_list_meta = $5, approved_users = $6,
             message_refresh_pending = TRUE, message_revision = message_revision + 1, channel_id = COALESCE(channel_id, $8)
         WHERE message_id = $7`,
			[
				JSON.stringify(mainList),
				JSON.stringify(reserveList),
				JSON.stringify(leftList),
				JSON.stringify(mainListMeta),
				JSON.stringify(reserveListMeta),
				JSON.stringify(approvedUsers),
				messageId,
				interaction.channelId
			]
		)

		await client.query('COMMIT')
		client.release()
		client = undefined
		const promoted = mainList.filter(id =>
			readIds(row.reserve_list).includes(id)
		)
		const content =
			interaction.customId === 'capt_leave'
				? '✅ Вы отменили запись на мероприятие.'
				: mainList.includes(userId)
					? '✅ Вы записаны в основной состав.'
					: `✅ Вы записаны в резерв. Позиция в очереди: ${reserveList.indexOf(userId) + 1}.`
		await completeCaptureChange(interaction, promoted, content)
	} catch (caught) {
		const err = getError(caught)
		if (client) await client.query('ROLLBACK').catch(() => {})
		console.error('Ошибка при обработке кнопки капта:', err)
		await interaction
			.followUp({
				content: '❌ Произошла ошибка базы данных при сохранении.',
				flags: MessageFlags.Ephemeral as const
			})
			.catch(() => {})
	} finally {
		client?.release()
	}
}

async function handleApproval(
	interaction: import('discord.js').ButtonInteraction<'cached'>
) {
	const adminRoles = (dashboard.getSetting('ADMIN_ROLES') || '')
		.split(',')
		.map(id => id.trim())
		.filter(Boolean)
	const member = interaction.member
	if (
		!member ||
		(!member.permissions.has(PermissionFlagsBits.Administrator) &&
			!adminRoles.some(id => member.roles.cache.has(id)))
	) {
		return interaction.reply({
			content: '❌ У вас нет прав для управления набором.',
			flags: MessageFlags.Ephemeral as const
		})
	}
	await interaction.deferUpdate()
	let client
	try {
		client = await pool.connect()
		await client.query('BEGIN')
		const result = await client.query(
			'SELECT * FROM active_captures WHERE message_id = $1 FOR UPDATE',
			[interaction.message.id]
		)
		const row = result.rows[0]
		if (!row) {
			await client.query('ROLLBACK')
			return interaction.followUp({
				content: '❌ Данная регистрация устарела или неактивна.',
				flags: MessageFlags.Ephemeral as const
			})
		}

		let main = readIds(row.main_list)
		let reserve = readIds(row.reserve_list)
		let mainMeta = readMeta(row.main_list_meta)
		let reserveMeta = readMeta(row.reserve_list_meta)
		let approved = readIds(row.approved_users)
		let sortMode = row.sort_mode ?? 'priority'
		const pageCount = capturePageCount(
			main.length + reserve.length,
			readIds(row.left_list).length
		)
		let page = Math.max(0, Math.min(row.approval_page || 0, pageCount - 1))
		if (isCollectionSort(interaction.customId)) {
			sortMode = nextCaptureSort(sortMode)
			await saveCaptureSort(client, interaction.guild.id, sortMode)
			page = 0
		} else {
			const requestedPage = Number(
				interaction.customId.slice('capt_approval_page_'.length)
			)
			if (
				!Number.isInteger(requestedPage) ||
				requestedPage < 0 ||
				requestedPage >= pageCount
			) {
				await client.query('ROLLBACK')
				return
			}
			page = requestedPage
		}
		await client.query(
			'UPDATE active_captures SET approved_users = $1, approval_page = $2, main_list = $3, reserve_list = $4, main_list_meta = $5, reserve_list_meta = $6, sort_mode = $8, message_refresh_pending = TRUE, message_revision = message_revision + 1, channel_id = COALESCE(channel_id, $9) WHERE message_id = $7',
			[
				JSON.stringify(approved),
				page,
				JSON.stringify(main),
				JSON.stringify(reserve),
				JSON.stringify(mainMeta),
				JSON.stringify(reserveMeta),
				interaction.message.id,
				sortMode,
				interaction.channelId
			]
		)
		await client.query('COMMIT')
		client.release()
		client = undefined
		await completeCaptureChange(
			interaction,
			main.filter(id => readIds(row.reserve_list).includes(id))
		)
	} catch (caught) {
		const err = getError(caught)
		if (client) await client.query('ROLLBACK').catch(() => {})
		console.error('Ошибка одобрения участников:', err)
		await interaction
			.followUp({
				content: '❌ Не удалось сохранить одобрение.',
				flags: MessageFlags.Ephemeral as const
			})
			.catch(() => {})
	} finally {
		if (client) client.release()
	}
}

export {
	buildCaptureMessage,
	completeCaptureChange,
	handleApproval,
	handleButton,
	joinedPlayers,
	redistributeApproved,
	sendCollection,
	sortByRolePriority,
	updateCollectionTime
}
