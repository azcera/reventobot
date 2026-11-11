import { getError } from '../utils/errors'
interface MembershipOptions { client: D.Client; pool: Pg.Pool; store: T.Store; sync: { membershipSnapshot(guild: D.Guild): Promise<T.MembershipSnapshot> }; env?: T.Env; logger?: Pick<Console, 'info' | 'error'>; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout; now?: () => number }
interface SelectionSession { action: string; actorId: string; guildId: string; source: string; ids: string[]; createdAt: number }
type Report = ReturnType<typeof classify>
import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import { randomUUID } from 'node:crypto'
import { parseNickname } from '../features/majestic/syncPreview'
import { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
	StringSelectMenuBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js'

const CHANNEL_ID = '1569055629098745896'
const FRIEND_ROLE_ID = '1499398714765348896'
const INTERVAL_MS = 10 * 60 * 1000
const PREFIX = 'family_cleanup_'
const CATEGORIES = ['Не в составе семьи', 'Ник не по форме', 'Без ролей']
const isMembershipMessage = (message: D.Message) => message.components.some(component => JSON.stringify(component.toJSON()).includes(PREFIX))

function classify(snapshot: T.MembershipSnapshot, applications: Set<string>) {
	const manual: D.GuildMember[] = [], automatic: D.GuildMember[] = []
	const reasons = new Map<string, string>()
	for (const member of snapshot.members.values()) {
		if (member.user.bot || member.id === member.guild?.ownerId ||
			member.roles.cache.has(FRIEND_ROLE_ID)) continue
		if (!member.roles.cache.some(role => role.id !== member.guild.id)) {
			manual.push(member)
			reasons.set(member.id, 'Без ролей')
			continue
		}
		if (applications.has(member.id)) continue
		const malformed = !parseNickname(member.nickname)
		if (!malformed && snapshot.statics.has(snapshot.linked.get(member.id) || '')) continue
		if (snapshot.bindings[member.id] && !snapshot.statics.has(snapshot.bindings[member.id])) automatic.push(member)
		else {
			manual.push(member)
			reasons.set(member.id, malformed ? 'Ник не по форме' : 'Не в составе семьи')
		}
	}
	manual.sort((a, b) => reasons.get(a.id)!.localeCompare(reasons.get(b.id)!, 'ru'))
	return { manual, automatic, reasons }
}

function reportPages(report: Report): { reason?: string; members: D.GuildMember[] }[] {
	const pages = []
	for (const reason of CATEGORIES) {
		const members = report.manual.filter((member: D.GuildMember) => report.reasons.get(member.id) === reason)
		for (let offset = 0; offset < members.length; offset += 25) {
			pages.push({ reason, members: members.slice(offset, offset + 25) })
		}
	}
	return pages.length ? pages : [{ members: [] }]
}

function createFamilyMembership({ client, pool, store, sync, env = process.env, logger = console,
	setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now }: MembershipOptions) {
	let stopped = true, timer: ReturnType<typeof setTimeout> | undefined, busy = false, active: Promise<void> | null = null
	const sessions = new Map<string, SelectionSession>()
	async function applications() {
		// Applications are deleted on acceptance/rejection; any remaining row is active.
		const result = await pool.query<{ user_id: string }>('SELECT user_id FROM family_applications')
		return new Set(result.rows.map(row => row.user_id))
	}
	async function load(guild: D.Guild) {
		const snapshot = await sync.membershipSnapshot(guild)
		return { ...classify(snapshot, await applications()), source: snapshot.source }
	}
	async function freshMember(guild: D.Guild, id: string) {
		const member = await guild.members.fetch({ user: id, force: true })
		if (member.user.bot || member.id === guild.ownerId || member.roles.cache.has(FRIEND_ROLE_ID)) return null
		if ((await applications()).has(id)) return null
		return member
	}
	async function change(guild: D.Guild, id: string, action: string, actor: T.Actor) {
		try {
			const member = await freshMember(guild, id)
			if (!member) return false
			const permission = action === 'kick' ? PermissionFlagsBits.KickMembers : PermissionFlagsBits.ManageRoles
			if (!guild.members.me?.permissions.has(permission)) throw new Error('Недостаточно прав у бота')
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
		} catch (caught) {
			const error = getError(caught)
			logger.error('[Family] Действие не выполнено', { id, action, code: error.code, message: error.message })
			return false
		}
	}
	async function publish(guild: D.Guild, report: Report, failed = 0) {
		const channel = await guild.channels.fetch(CHANNEL_ID)
		if (!channel?.isTextBased() || !channel.messages) throw new Error('Канал списка семьи недоступен')
		const existing: D.Message[] = []
		let before: string | undefined
		for (;;) {
			const messages: D.Collection<string, D.Message<true>> = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) })
			existing.push(...[...messages.values()].filter((message: D.Message) => message.author.id === client.user!.id && isMembershipMessage(message)))
			if (messages.size < 100) break
			before = messages.last()!.id
		}
		existing.sort((a, b) => a.createdTimestamp - b.createdTimestamp)
		const pages = reportPages(report)
		for (let page = 0; page < pages.length; page++) {
			const { members, reason } = pages[page]
			const text = `## Несинхронизированно с игрой — ${report.manual.length}\n` +
				`Страница ${page + 1}/${pages.length}. Проверено <t:${Math.floor(now() / 1000)}:R>.\n` +
				(failed ? `⚠️ Не удалось автоматически кикнуть: ${failed}. Проверьте права и журнал бота.\n` : '') +
				(members.length ? `### ${reason}\n${members.map((member: D.GuildMember) => `- <@${member.id}>`).join('\n')}` : 'Список пуст.')
			const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
			container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
				...['kick', 'roles'].map(action => new ButtonBuilder().setCustomId(`${PREFIX}open_${action}_${page}`)
					.setLabel(action === 'kick' ? 'Выбрать для кика' : 'Выбрать для снятия ролей')
					.setStyle(action === 'kick' ? ButtonStyle.Danger : ButtonStyle.Secondary).setDisabled(!members.length)),
				new ButtonBuilder().setCustomId(`${PREFIX}copy_${CATEGORIES.indexOf(reason || '')}`)
					.setLabel('Скопировать список').setStyle(ButtonStyle.Secondary).setDisabled(!members.length)))
			const payload = { components: [container], flags: MessageFlags.IsComponentsV2 as const, allowedMentions: { parse: [] } }
			if (existing[page]) await existing[page].edit(payload)
			else await channel.send(payload)
		}
		for (const message of existing.slice(pages.length)) await message.delete()
	}
	async function refresh(guild: D.Guild) {
		const report = await load(guild)
		let failed = 0
		for (const member of report.automatic) {
			if (!await change(guild, member.id, 'kick', { id: 'family-auto', name: 'Проверка состава семьи' })) failed++
		}
		await publish(guild, report, failed)
	}
	async function exclusive<R>(work: () => Promise<R>): Promise<R> {
		if (busy) throw new Error('Проверка состава уже выполняется. Повторите позже.')
		busy = true
		try { return await work() } finally { busy = false }
	}
	async function tick() {
		if (stopped) return
		try {
			if (store.ready && env.MAJESTIC_SESSION_ID && env.MAJESTIC_SERVER && env.MAJESTIC_CHARACTER_ID) {
				active = exclusive(async () => refresh(await client.guilds.fetch(env.GUILD_ID!)))
				await active
			}
		} catch (caught) {
			const error = getError(caught)
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
		async refresh(guild: D.Guild) { return exclusive(() => refresh(guild)) },
		async handle(interaction: D.ButtonInteraction<'cached'> | D.StringSelectMenuInteraction<'cached'>) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral })
			try {
				await exclusive(async () => {
					const guild = interaction.guild
					if (guild.id !== env.GUILD_ID || interaction.channelId !== CHANNEL_ID) throw new Error('Действие доступно только в канале списка семьи.')
					const actor = await guild.members.fetch({ user: interaction.user.id, force: true })
					const copy = /^family_cleanup_copy_([0-2])$/.exec(interaction.customId)
					if (copy) {
						const report = await load(guild)
						const reason = CATEGORIES[Number(copy[1])]
						const mentions = report.manual.filter((member: D.GuildMember) => report.reasons.get(member.id) === reason)
							.map((member: D.GuildMember) => `<@${member.id}>`)
						const chunks = ['']
						for (const mention of mentions) {
							const last = chunks.length - 1
							if (chunks[last].length + mention.length + 2 > 1900) chunks.push(mention)
							else chunks[last] += (chunks[last] ? ', ' : '') + mention
						}
						for (let index = 0; index < chunks.length; index++) {
							const payload = {
								content: '```\n' + (chunks[index] || 'Список пуст.') + '\n```',
								allowedMentions: { parse: [] }
							}
							if (index === 0) await interaction.editReply(payload)
							else await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral })
						}
						return
					}
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
						const members = reportPages(report)[Number(match[2])]?.members || []
						if (!members.length) throw new Error('На этой странице больше нет участников. Дождитесь обновления списка.')
						const id = randomUUID()
						sessions.set(id, { action, actorId: actor.id, guildId: guild.id, source: report.source, ids: members.map((member: D.GuildMember) => member.id), createdAt: now() })
						const select = new StringSelectMenuBuilder().setCustomId(PREFIX + 'apply_' + id)
							.setPlaceholder(action === 'kick' ? 'Кикнуть выбранных участников' : 'Снять все роли у выбранных')
							.setMinValues(1).setMaxValues(members.length).addOptions(members.map((member: D.GuildMember) => ({
								label: String(member.displayName || member.id).slice(0, 100), value: member.id, description: member.id
							})))
						return interaction.editReply({ content: 'Выберите участников. Действие выполнится сразу после отправки выбора.', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)] })
					}
					if (!session || session.actorId !== actor.id || session.guildId !== guild.id || session.source !== report.source) throw new Error('Окно выбора недействительно. Откройте его заново.')
					if (token) sessions.delete(token)
					const ids = 'values' in interaction ? interaction.values : []
					if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || ids.some(id => !session.ids.includes(id))) throw new Error('Некорректный выбор участников.')
					const eligible = new Set(report.manual.map((member: D.GuildMember) => member.id))
					let applied = 0
					for (const id of ids) if (eligible.has(id) && await change(guild, id, action, { id: actor.id, name: actor.displayName })) applied++
					let content = `Выполнено: ${applied}. Пропущено или ошибка: ${ids.length - applied}.`
					try { await refresh(guild) }
					catch (caught) {
			const error = getError(caught)
						logger.error('[Family] Не удалось обновить список после действия:', error.message)
						content += ' Не удалось обновить список; он обновится при следующей проверке.'
					}
					await interaction.editReply({ content, components: [] })
				})
			} catch (caught) {
			const error = getError(caught)
				logger.error('[Family] Ошибка обработки списка:', error.message)
				await interaction.editReply({ content: error.status === 502 ? 'Не удалось получить полный состав семьи. Действия остановлены.' : error.message, components: [] })
			}
		}
	}
}

export { createFamilyMembership, classify, isMembershipMessage, CHANNEL_ID, FRIEND_ROLE_ID, INTERVAL_MS }
