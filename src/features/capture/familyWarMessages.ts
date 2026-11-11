import type { BindingMember, Decisions, Registration, War, WarPlayer, QueueRow } from './familyWarTypes'
import { templateText, type TemplateText } from '../../dashboard/templateText'
import type { Store } from '../../types'
import { ContainerBuilder } from '../../services/markdownContainer'
import {
	MessageFlags,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	TextDisplayBuilder,
	SeparatorBuilder,
	escapeMarkdown
} from 'discord.js'
import {
	queueRows,
	registrationClosed,
	battleSummary,
	bindingIndex
} from './familyWarData'

const text = (value: unknown) => escapeMarkdown(String(value ?? '')).replace(/@/g, '＠')
const timestamp = (time: number) => `<t:${Math.floor(time / 1000)}:F>`
const suffix = (war: War) => `RU8_${war.apiId}`
const textBlock = (value: string) => new TextDisplayBuilder().setContent(value)

function announcement(
	war: War,
	registrationUrl: string | null,
	now = Date.now(),
	members: Iterable<BindingMember> = [],
	decisions: Decisions = {},
	banner = '',
	render: TemplateText = templateText
) {
	const closed = registrationClosed(war, now)
	const battle = battleSummary(war)
	const icon = war.attack ? '⚔️' : '🛡️'
	const title = war.attack ? 'АТАКА' : 'ЗАЩИТА'
	const enemyId = war.attack ? war.raw.defendersId : war.raw.attackersId
	const enemies = war.raw.players?.[enemyId]
	const code = (value: unknown) => '`' + text(value).replace(/`/g, 'ˋ') + '`'
	const startTime = new Intl.DateTimeFormat('ru-RU', {
		timeZone: 'Europe/Moscow',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	})
		.format(war.startAt)
		.replace(',', '')
	const button = new ButtonBuilder()
		.setStyle(war.attack ? ButtonStyle.Success : ButtonStyle.Primary)
		.setCustomId(`capt_api_${suffix(war)}`)
		.setDisabled(closed)
		.setLabel(
			render('announcement.button', { icon, target: war.attack ? 'АТАКУ' : 'ЗАЩИТУ' })
		)
	const container = new ContainerBuilder()
		.setAccentColor(war.attack ? 0x57f287 : 0x5865f2)
	if (banner) container.addTextDisplayComponents(textBlock(banner))
	container
		.addTextDisplayComponents(textBlock(render('announcement.title', { icon, title })))
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(
			textBlock(
				[render('announcement.details', { enemy: code(war.enemy), time: code(startTime), zone: code(war.zone ?? 'Неопределён'), count: code(Array.isArray(enemies) ? enemies.length : 'Неопределено') }),
				render('announcement.game', { map: code(war.map), resultIcon: battle.result === 'Победа' ? '🏆' : battle.result === 'Поражение' ? '❌' : '❔', result: code(battle.result), status: code(war.status || 'не указан') + (war.neutral ? ' · Нейтральная территория' : ''), registration: registrationUrl ? '\n[Открыть регистрацию](' + registrationUrl + ')' : '' })].join('\n')
			)
		)
		.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(button))
	if (war.status === 'finished') {
		const bindings = bindingIndex(members, decisions)
		const label = (player: WarPlayer | null, field: 'damage' | 'kills') => {
			if (!player) return 'Неопределено'
			const ids = bindings.get(String(player.id)) || []
			const identity =
				ids.length === 1
					? `<@${ids[0]}>`
					: `${code(player.name || 'Неизвестный игрок')} / ${code(player.id)}`
			return `${identity} — **${player[field]}**`
		}
		container
			.addSeparatorComponents(new SeparatorBuilder())
			.addTextDisplayComponents(
				textBlock(
					render('announcement.mvp', { damage: label(battle.damageMvp, 'damage'), kills: label(battle.killsMvp, 'kills') })
				)
			)
	}
	return {
		flags: MessageFlags.IsComponentsV2 as const,
		components: [container],
		allowedMentions: { parse: [] } as import('discord.js').MessageMentionOptions
	}
}

function registrationMessage(
	war: War,
	registration: Registration,
	guild: import('discord.js').Guild,
	decisions: Decisions,
	store: Store,
	now = Date.now()
) {
	const rows = queueRows(
		war,
		registration,
		guild.members.cache,
		decisions,
		store.roleIds('PRIORITY_ROLES'),
		now
	)
	const confirmed = rows.filter(row => row.confirmed)
	const waiting = rows.filter(row => !row.confirmed)
	const list = (entries: QueueRow[]) =>
		entries
			.map((row, index) => {
				const label = row.userId
					? `<@${row.userId}>`
					: `${text(row.name)} | ${row.static}`
				const marker = row.confirmed
					? (row.userId && registration.joins?.[row.userId]) && !row.declined
						? '✅'
						: '🎮'
					: '⏳'
				return `${index + 1}. ${marker} ${label}${row.declined ? ' — отказ в Discord' : ''}${row.conflict ? ' — ⚠️ проверьте привязку static' : ''}`
			})
			.join('\n') || 'Пока пусто'
	const closed = registrationClosed(war, now) || Boolean(registration.closedAt)
	const freshness =
		(war.rosterFresh
			? ''
			: '\n⚠️ API не передал состав. ' +
				(war.rosterUpdatedAt
					? 'Показан последний известный.'
					: 'Подтверждённый состав пока неизвестен.')) +
		(war.rosterUpdatedAt
			? `\nСостав получен: <t:${Math.floor(war.rosterUpdatedAt / 1000)}:R>`
			: '')
	const container = new ContainerBuilder()
		.addTextDisplayComponents(
			textBlock(
				store.text('capture.title', {
					target: `капт против ${text(war.enemy)}`
				})
			),
			textBlock(store.text('capture.time', { time: timestamp(war.startAt) })),
			textBlock(
				store.text('capture.info', {
					map: text(war.map),
					zone: text(war.zone),
					status: text(war.status || 'не указан'),
					registrationStatus: closed
						? 'Регистрация закрыта. Обновление остановлено.'
						: 'Время и состав обновляются автоматически.',
					freshness
				})
			)
		)
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(
			textBlock(
				store.text('capture.sort', {
					mode:
						registration.sortMode === 'time'
							? 'по времени записи'
							: 'по роли и времени записи'
				})
			),
			textBlock(
				store.text('capture.confirmed', {
					count: confirmed.length,
					players: list(confirmed)
				})
			)
		)
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(
			textBlock(
				store.text('capture.waiting', {
					count: waiting.length,
					players: list(waiting)
				})
			)
		)
	if (war.testSource)
		container.addTextDisplayComponents(
			textBlock(
				`🧪 Тестовая регистрация. Снимок капта №${war.testSource.apiId} от ${timestamp(war.testSource.startAt)}. Состав зафиксирован; кнопки активны до конца текущего дня по Москве.`
			)
		)
	const controls = new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`war_join_${suffix(war)}`)
			.setLabel(store.text('capture.2'))
			.setStyle(ButtonStyle.Success)
			.setDisabled(closed),
		new ButtonBuilder()
			.setCustomId(`war_leave_${suffix(war)}`)
			.setLabel(store.text('capture.3'))
			.setStyle(ButtonStyle.Danger)
			.setDisabled(closed),
		new ButtonBuilder()
			.setCustomId(`war_sort_${suffix(war)}`)
			.setLabel(
				store.text(
					registration.sortMode === 'time'
						? 'capture.sortPriority'
						: 'capture.sortTime'
				)
			)
			.setStyle(ButtonStyle.Secondary)
			.setDisabled(closed)
	)
	container.addActionRowComponents(controls)
	return {
		flags: MessageFlags.IsComponentsV2 as const,
		components: [store.decorate('capture', container)],
		allowedMentions: { parse: [] } as import('discord.js').MessageMentionOptions
	}
}

export { announcement, registrationMessage }
