const { randomUUID } = require('node:crypto')
const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
	StringSelectMenuBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js')

const CHANNEL_ID = '1569055629098745896'
const FRIEND_ROLE_ID = '1499398714765348896'
const INTERVAL_MS = 10 * 60 * 1000
const PREFIX = 'family_cleanup_'
const isMembershipMessage = message => message.components.some(component => JSON.stringify(component.toJSON()).includes(PREFIX))

function classify(snapshot, applications) {
	const manual = [], automatic = []
	const reasons = new Map()
	for (const member of snapshot.members.values()) {
		if (member.user.bot || member.id === member.guild?.ownerId ||
			member.roles.cache.has(FRIEND_ROLE_ID) || applications.has(member.id)) continue
		if (snapshot.statics.has(snapshot.linked.get(member.id))) continue
		if (snapshot.bindings[member.id] && !snapshot.statics.has(snapshot.bindings[member.id])) automatic.push(member)
		else {
			manual.push(member)
			reasons.set(member.id, snapshot.linked.get(member.id) ? 'не в составе семьи' : 'ник не по форме: нужен формат Имя | static')
		}
	}
	manual.sort((a, b) => reasons.get(a.id).localeCompare(reasons.get(b.id), 'ru'))
	return { manual, automatic, reasons }
}

function createFamilyMembership({ client, pool, store, sync, env = process.env, logger = console,
	setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }) {
	let stopped = true, timer, busy = false, active
	const sessions = new Map()
	async function applications() {
		// Applications are deleted on acceptance/rejection; any remaining row is active.
		const result = await pool.query('SELECT user_id FROM family_applications')
		return new Set(result.rows.map(row => row.user_id))
	}
	async function load(guild) {
		const snapshot = await sync.membershipSnapshot(guild)
		return { ...classify(snapshot, await applications()), source: snapshot.source }
	}
	async function freshMember(guild, id) {
		const member = await guild.members.fetch({ user: id, force: true })
		if (member.user.bot || member.id === guild.ownerId || member.roles.cache.has(FRIEND_ROLE_ID)) return null
		if ((await applications()).has(id)) return null
		return member
	}
	async function change(guild, id, action, actor) {
		try {
			const member = await freshMember(guild, id)
			if (!member) return false
			const permission = action === 'kick' ? PermissionFlagsBits.KickMembers : PermissionFlagsBits.ManageRoles
			if (!guild.members.me.permissions.has(permission)) throw new Error('Недостаточно прав у бота')
			if (action === 'kick' ? !member.kickable : !member.manageable) throw new Error('Иерархия ролей запрещает действие')
			if (action === 'roles' && member.roles.cache.some(role => role.id !== guild.id && (role.managed || !role.editable))) {
				throw new Error('Невозможно снять все роли: есть управляемые или недоступные роли')
			}
			await store.audit(actor, 'family.' + action + '.request', id)
			const reason = `Нет в семье Majestic; ${actor.id}`
			if (action === 'kick') await member.kick(reason)
			else await member.roles.set([], reason)
			await store.audit(actor, 'family.' + action + '.result', id, { status: 'applied' })
			return true
		} catch (error) {
			logger.error('[Family] Действие не выполнено', { id, action, code: error.code, message: error.message })
			return false
		}
	}
	async function publish(guild, report, failed = 0) {
		const channel = await guild.channels.fetch(CHANNEL_ID)
		if (!channel?.isTextBased() || !channel.messages) throw new Error('Канал списка семьи недоступен')
		const existing = []
		let before
		for (;;) {
			const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) })
			existing.push(...[...messages.values()].filter(message => message.author.id === client.user.id && isMembershipMessage(message)))
			if (messages.size < 100) break
			before = messages.last().id
		}
		existing.sort((a, b) => a.createdTimestamp - b.createdTimestamp)
		const pages = Math.max(1, Math.ceil(report.manual.length / 25))
		for (let page = 0; page < pages; page++) {
			const members = report.manual.slice(page * 25, (page + 1) * 25)
			const groups = new Map()
			for (const member of members) {
				const reason = report.reasons.get(member.id)
				if (!groups.has(reason)) groups.set(reason, [])
				groups.get(reason).push(member)
			}
			const text = `## Участники вне семьи — ${report.manual.length}\n` +
				`Страница ${page + 1}/${pages}. Проверено <t:${Math.floor(now() / 1000)}:R>.\n` +
				(failed ? `⚠️ Не удалось автоматически кикнуть: ${failed}. Проверьте права и журнал бота.\n` : '') +
				([...groups].map(([reason, group]) => `### ${reason}\n${group.map(member => `- <@${member.id}>`).join('\n')}`).join('\n\n') || 'Список пуст.')
			const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
			container.addActionRowComponents(new ActionRowBuilder().addComponents(
				...['kick', 'roles'].map(action => new ButtonBuilder().setCustomId(`${PREFIX}open_${action}_${page}`)
					.setLabel(action === 'kick' ? 'Выбрать для кика' : 'Выбрать для снятия ролей')
					.setStyle(action === 'kick' ? ButtonStyle.Danger : ButtonStyle.Secondary).setDisabled(!members.length))))
			const payload = { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }
			if (existing[page]) await existing[page].edit(payload)
			else await channel.send(payload)
		}
		for (const message of existing.slice(pages)) await message.delete()
	}
	async function refresh(guild) {
		const report = await load(guild)
		let failed = 0
		for (const member of report.automatic) {
			if (!await change(guild, member.id, 'kick', { id: 'family-auto', name: 'Проверка состава семьи' })) failed++
		}
		await publish(guild, report, failed)
	}
	async function exclusive(work) {
		if (busy) throw new Error('Проверка состава уже выполняется. Повторите позже.')
		busy = true
		try { return await work() } finally { busy = false }
	}
	async function tick() {
		if (stopped) return
		try {
			if (store.ready && env.MAJESTIC_SESSION_ID && env.MAJESTIC_SERVER && env.MAJESTIC_CHARACTER_ID) {
				active = exclusive(async () => refresh(await client.guilds.fetch(env.GUILD_ID)))
				await active
			}
		} catch (error) {
			if (error.code === 'MAJESTIC_SYNC_BUSY') logger.info('[Family] Проверка состава пропущена: синхронизация уже выполняется.')
			else logger.error('[Family] Проверка состава остановлена:', error.message)
		}
		finally {
			active = null
			if (!stopped) { timer = setTimer(tick, INTERVAL_MS); timer.unref?.() }
		}
	}
	return {
		start() { if (stopped) { stopped = false; timer = setTimer(tick, 1000); timer.unref?.() } },
		async stop() { stopped = true; clearTimer(timer); await active?.catch(() => {}) },
		async refresh(guild) { return exclusive(() => refresh(guild)) },
		async handle(interaction) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral })
			try {
				await exclusive(async () => {
					const guild = interaction.guild
					if (guild.id !== env.GUILD_ID || interaction.channelId !== CHANNEL_ID) throw new Error('Действие доступно только в канале списка семьи.')
					const actor = await guild.members.fetch({ user: interaction.user.id, force: true })
					const match = /^family_cleanup_open_(kick|roles)_(\d+)$/.exec(interaction.customId)
					const token = interaction.customId.startsWith(PREFIX + 'apply_') ? interaction.customId.slice((PREFIX + 'apply_').length) : null
					for (const [key, session] of sessions) if (now() - session.createdAt > 5 * 60 * 1000) sessions.delete(key)
					const session = token ? sessions.get(token) : null
					const action = match?.[1] || session?.action
					if (!action) throw new Error('Окно выбора устарело. Откройте его заново.')
					const permission = action === 'kick' ? PermissionFlagsBits.KickMembers : PermissionFlagsBits.ManageRoles
					if (!actor.permissions.has(permission) && !store.roleIds('ADMIN_ROLES').some(id => actor.roles.cache.has(id))) throw new Error('Недостаточно прав для этого действия.')
					const report = await load(guild)
					if (match) {
						const members = report.manual.slice(Number(match[2]) * 25, (Number(match[2]) + 1) * 25)
						if (!members.length) throw new Error('На этой странице больше нет участников. Дождитесь обновления списка.')
						const id = randomUUID()
						sessions.set(id, { action, actorId: actor.id, guildId: guild.id, source: report.source, ids: members.map(member => member.id), createdAt: now() })
						const select = new StringSelectMenuBuilder().setCustomId(PREFIX + 'apply_' + id)
							.setPlaceholder(action === 'kick' ? 'Кикнуть выбранных участников' : 'Снять все роли у выбранных')
							.setMinValues(1).setMaxValues(members.length).addOptions(members.map(member => ({
								label: String(member.displayName || member.id).slice(0, 100), value: member.id, description: member.id
							})))
						return interaction.editReply({ content: 'Выберите участников. Действие выполнится сразу после отправки выбора.', components: [new ActionRowBuilder().addComponents(select)] })
					}
					if (session.actorId !== actor.id || session.guildId !== guild.id || session.source !== report.source) throw new Error('Окно выбора недействительно. Откройте его заново.')
					sessions.delete(token)
					const ids = interaction.values
					if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !session.ids.includes(id))) throw new Error('Некорректный выбор участников.')
					const eligible = new Set(report.manual.map(member => member.id))
					let applied = 0
					for (const id of ids) if (eligible.has(id) && await change(guild, id, action, { id: actor.id, name: actor.displayName })) applied++
					let content = `Выполнено: ${applied}. Пропущено или ошибка: ${ids.length - applied}.`
					try { await refresh(guild) }
					catch (error) {
						logger.error('[Family] Не удалось обновить список после действия:', error.message)
						content += ' Не удалось обновить список; он обновится при следующей проверке.'
					}
					await interaction.editReply({ content, components: [] })
				})
			} catch (error) {
				logger.error('[Family] Ошибка обработки списка:', error.message)
				await interaction.editReply({ content: error.status === 502 ? 'Не удалось получить полный состав семьи. Действия остановлены.' : error.message, components: [] })
			}
		}
	}
}

module.exports = { createFamilyMembership, classify, isMembershipMessage, CHANNEL_ID, FRIEND_ROLE_ID, INTERVAL_MS }
