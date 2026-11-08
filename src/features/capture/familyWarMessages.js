const { ContainerBuilder } = require('../../services/markdownContainer')
const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextDisplayBuilder, SeparatorBuilder, escapeMarkdown } = require('discord.js')
const { PAGE_SIZE, queueRows, moscowDay } = require('./familyWarData')

const text = value => escapeMarkdown(String(value ?? '')).replace(/@/g, '＠')
const timestamp = time => `<t:${Math.floor(time / 1000)}:F>`
const suffix = war => `RU8_${war.apiId}`
const textBlock = value => new TextDisplayBuilder().setContent(value)

function announcement(war, registrationUrl, now = Date.now()) {
	const closed = war.closed || war.neutral || moscowDay(war.startAt) < moscowDay(now)
	const button = new ButtonBuilder().setStyle(war.attack ? ButtonStyle.Success : ButtonStyle.Primary)
		.setCustomId(`capt_api_${suffix(war)}`).setDisabled(closed)
		.setLabel(war.attack ? '⚔️ Создать регу на АТАКУ' : '🛡️ Создать регу на ЗАЩИТУ')
	const container = new ContainerBuilder().setAccentColor(war.attack ? 0x57f287 : 0x5865f2)
		.addTextDisplayComponents(textBlock(war.attack ? '# ⚔️ КАПТ АТАКА' : '# 🛡️ КАПТ ЗАЩИТА'))
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(textBlock(`Против: **${text(war.enemy)}**\nНачало: ${timestamp(war.startAt)}\nКвадрат: ${text(war.map)} (${text(war.zone)})\nСтатус API: ${text(war.status || 'не указан')}${war.neutral ? ' · Нейтральная территория' : ''}${registrationUrl ? '\n[Открыть регистрацию](' + registrationUrl + ')' : ''}`))
		.addActionRowComponents(new ActionRowBuilder().addComponents(button))
	return { flags: MessageFlags.IsComponentsV2, components: [container], allowedMentions: { parse: [] } }
}

function registrationMessage(war, registration, guild, decisions, store, now = Date.now()) {
	const rows = queueRows(war, registration, guild.members.cache, decisions, store.roleIds('PRIORITY_ROLES'), now)
	const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
	const page = Math.min(Math.max(registration.page || 0, 0), pages - 1)
	const confirmed = rows.filter(row => row.confirmed).length
	const content = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((row, index) => {
		const label = row.userId ? `<@${row.userId}>` : `${text(row.name)} | ${row.static}`
		return `${page * PAGE_SIZE + index + 1}. ${row.confirmed ? '✅' : '⏳'} ${label}${row.declined ? ' — отказ в Discord' : ''}${row.conflict ? ' — ⚠️ проверьте привязку static' : ''}`
	}).join('\n') || 'Пока пусто'
	const closed = war.closed || war.neutral || moscowDay(war.startAt) < moscowDay(now)
	const freshness = (war.rosterFresh ? '' : '\n⚠️ API не передал состав. ' + (war.rosterUpdatedAt ? 'Показан последний известный.' : 'Подтверждённый состав пока неизвестен.')) +
		(war.rosterUpdatedAt ? `\nСостав получен: <t:${Math.floor(war.rosterUpdatedAt / 1000)}:R>` : '')
	const container = new ContainerBuilder()
		.addTextDisplayComponents(textBlock(store.text('capture.title', { target: `капт против ${text(war.enemy)}` })),
			textBlock(store.text('capture.time', { time: timestamp(war.startAt) })),
			textBlock(`Карта: ${text(war.map)} (${text(war.zone)}) · Статус API: ${text(war.status || 'не указан')}\n✅ — состав игры · ⏳ — ожидание. Время и состав обновляются автоматически.${freshness}`))
		.addSeparatorComponents(new SeparatorBuilder())
		.addTextDisplayComponents(textBlock(`### В игре: ${confirmed} · Ожидание: ${rows.length - confirmed}\nСортировка ${registration.sortMode === 'time' ? 'по времени записи' : 'по роли и времени записи'} · Страница ${page + 1}/${pages}\n${content}`))
	const controls = new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`war_join_${suffix(war)}`).setLabel(store.text('capture.2')).setStyle(ButtonStyle.Success).setDisabled(closed),
		new ButtonBuilder().setCustomId(`war_leave_${suffix(war)}`).setLabel(store.text('capture.3')).setStyle(ButtonStyle.Danger).setDisabled(closed),
		new ButtonBuilder().setCustomId(`war_sort_${suffix(war)}`).setLabel(registration.sortMode === 'time' ? 'Сортировать по приоритету' : 'Сортировать по времени').setStyle(ButtonStyle.Secondary)
	)
	container.addActionRowComponents(controls)
	if (pages > 1) container.addActionRowComponents(new ActionRowBuilder().addComponents(
		new ButtonBuilder().setCustomId(`war_page_${suffix(war)}_${page - 1}`).setLabel(store.text('capture.5')).setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
		new ButtonBuilder().setCustomId(`war_page_${suffix(war)}_${page + 1}`).setLabel(store.text('capture.6')).setStyle(ButtonStyle.Secondary).setDisabled(page === pages - 1)
	))
	return { flags: MessageFlags.IsComponentsV2, components: [store.decorate('capture', container)], allowedMentions: { parse: [] } }
}

module.exports = { announcement, registrationMessage }
