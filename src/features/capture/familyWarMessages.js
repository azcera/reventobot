const { ContainerBuilder } = require('../../services/markdownContainer')
const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextDisplayBuilder, SeparatorBuilder, escapeMarkdown } = require('discord.js')
const { queueRows, registrationClosed, battleSummary } = require('./familyWarData')

const text = value => escapeMarkdown(String(value ?? '')).replace(/@/g, '＠')
const timestamp = time => `<t:${Math.floor(time / 1000)}:F>`
const suffix = war => `RU8_${war.apiId}`
const textBlock = value => new TextDisplayBuilder().setContent(value)

function announcement(war, registrationUrl, now = Date.now()) {
	const closed = registrationClosed(war, now)
	const battle = battleSummary(war)
	const score = battle.ours === null ? 'Неизвестен' : `${battle.ours}:${battle.theirs}${battle.estimated ? ' (расчёт по урону и убийствам)' : ''}`
	const button = new ButtonBuilder().setStyle(war.attack ? ButtonStyle.Success : ButtonStyle.Primary)
		.setCustomId(`capt_api_${suffix(war)}`).setDisabled(closed)
		.setLabel(war.attack ? '⚔️ Создать регу на АТАКУ' : '🛡️ Создать регу на ЗАЩИТУ')
	const container = new ContainerBuilder().setAccentColor(war.attack ? 0x57f287 : 0x5865f2)
		.addTextDisplayComponents(textBlock(war.attack ? '# ⚔️ КАПТ АТАКА' : '# 🛡️ КАПТ ЗАЩИТА'))
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(textBlock(`Против: **${text(war.enemy)}**\nНачало: ${timestamp(war.startAt)}\nКарта: ${text(war.map)} · Квадрат: ${text(war.zone)}\nОсталось (мы : противник): **${score}**\nРезультат: ${battle.result}\nСтатус API: ${text(war.status || 'не указан')}${war.neutral ? ' · Нейтральная территория' : ''}${registrationUrl ? '\n[Открыть регистрацию](' + registrationUrl + ')' : ''}`))
		.addActionRowComponents(new ActionRowBuilder().addComponents(button))
	return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { parse: [] } }
}

function registrationMessage(war, registration, guild, decisions, store, now = Date.now()) {
	const rows = queueRows(war, registration, guild.members.cache, decisions, store.roleIds('PRIORITY_ROLES'), now)
	const confirmed = rows.filter(row => row.confirmed)
	const waiting = rows.filter(row => !row.confirmed)
	const list = entries => entries.map((row, index) => {
		const label = row.userId ? `<@${row.userId}>` : `${text(row.name)} | ${row.static}`
		const marker = row.confirmed ? (registration.joins?.[row.userId] && !row.declined ? '✅' : '🎮') : '⏳'
		return `${index + 1}. ${marker} ${label}${row.declined ? ' — отказ в Discord' : ''}${row.conflict ? ' — ⚠️ проверьте привязку static' : ''}`
	}).join('\n') || 'Пока пусто'
	const closed = registrationClosed(war, now) || Boolean(registration.closedAt)
	const freshness = (war.rosterFresh ? '' : '\n⚠️ API не передал состав. ' + (war.rosterUpdatedAt ? 'Показан последний известный.' : 'Подтверждённый состав пока неизвестен.')) +
		(war.rosterUpdatedAt ? `\nСостав получен: <t:${Math.floor(war.rosterUpdatedAt / 1000)}:R>` : '')
	const container = new ContainerBuilder()
		.addTextDisplayComponents(textBlock(store.text('capture.title', { target: `капт против ${text(war.enemy)}` })),
			textBlock(store.text('capture.time', { time: timestamp(war.startAt) })),
			textBlock(`Карта: ${text(war.map)} (${text(war.zone)}) · Статус API: ${text(war.status || 'не указан')}\n🎮 — в игре без подтверждения в Discord · ✅ — в игре и нажал «Принять» · ⏳ — нажал «Принять», ожидает записи в игре. ${closed ? 'Регистрация закрыта. Обновление остановлено.' : 'Время и состав обновляются автоматически.'}${freshness}`))
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(textBlock(`Сортировка ${registration.sortMode === 'time' ? 'по времени записи' : 'по роли и времени записи'}`),
			textBlock(`### В игре: ${confirmed.length}\n${list(confirmed)}`))
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(textBlock(`### Ожидание: ${waiting.length}\n${list(waiting)}`))
	if (war.testSource) container.addTextDisplayComponents(textBlock(`🧪 Тестовая регистрация. Снимок капта №${war.testSource.apiId} от ${timestamp(war.testSource.startAt)}. Состав зафиксирован; кнопки активны до конца текущего дня по Москве.`))
	const controls = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`war_join_${suffix(war)}`).setLabel(store.text('capture.2')).setStyle(ButtonStyle.Success).setDisabled(closed),
		new ButtonBuilder().setCustomId(`war_leave_${suffix(war)}`).setLabel(store.text('capture.3')).setStyle(ButtonStyle.Danger).setDisabled(closed),
		new ButtonBuilder().setCustomId(`war_sort_${suffix(war)}`).setLabel(registration.sortMode === 'time' ? 'Сортировать по приоритету' : 'Сортировать по времени').setStyle(ButtonStyle.Secondary).setDisabled(closed)
	)
	container.addActionRowComponents(controls)
	return { flags: MessageFlags.IsComponentsV2, components: [store.decorate('capture', container)], allowedMentions: { parse: [] } }
}

module.exports = { announcement, registrationMessage }
