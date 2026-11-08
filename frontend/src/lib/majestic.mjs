export const majesticLabels = { change: 'Изменение', unchanged: 'Без изменений', conflict: 'Конфликт', blocked: 'Нет доступа', skipped: 'Пропущен', excluded: 'Исключён', running: 'Выполняется', completed: 'Завершено', completed_with_errors: 'Завершено с ошибками', stopped: 'Остановлено', failed: 'Ошибка', interrupted: 'Прервано перезапуском', applied: 'Применено', applying: 'Отправляется в Discord' }

export function previewIssue(state, now = Date.now()) {
	const report = state?.preview
	if (!report) return 'Получи предпросмотр, чтобы загрузить участников.'
	if (report.invalidated) return 'Предпросмотр использован или привязки изменены. Обнови его перед применением.'
	if (now - report.generatedAt > 15 * 60 * 1000) return 'Предпросмотру больше 15 минут. Получи новый.'
	if (!report.rows.some(row => row.status === 'change')) return 'Нет доступных изменений. Проверь конфликты и строки «Нет доступа».'
	return ''
}

export function visibleRows(state, search, filter) {
	const query = search.trim().toLowerCase()
	return (state?.preview?.rows || []).filter(row => {
		if (filter === 'issues' ? !['change', 'conflict', 'blocked'].includes(row.status) : filter !== 'all' && row.status !== filter) return false
		return !query || [row.currentNickname, row.nickname, row.discordId, row.static, state.decisions?.[row.discordId]?.static].some(value => String(value ?? '').toLowerCase().includes(query))
	})
}

export function applicableSelection(state, selected, now) {
	if (previewIssue(state, now)) return []
	return [...selected].filter(id => state.preview.rows.some(row => row.discordId === id && row.status === 'change'))
}
