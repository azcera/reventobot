let majesticState
let majesticTimer
let majesticPending = false
let majesticSignature
const majesticSelected = new Set()
const majesticLabels = { change: 'Изменение', unchanged: 'Без изменений', conflict: 'Конфликт',
	blocked: 'Нет доступа', skipped: 'Пропущен', excluded: 'Исключён', running: 'Выполняется',
	completed: 'Завершено', completed_with_errors: 'Завершено с ошибками', stopped: 'Остановлено', failed: 'Ошибка', interrupted: 'Прервано перезапуском',
	applied: 'Применено', applying: 'Отправляется в Discord' }

async function loadMajestic() {
	clearTimeout(majesticTimer)
	const data = await api('majestic')
	if (majesticState?.preview?.id !== data.preview?.id) majesticSelected.clear()
	majesticState = data
	const signature = JSON.stringify(data)
	if (signature !== majesticSignature) { majesticSignature = signature; renderMajestic() }
	else renderMajesticControls()
	if (data.busy && location.hash === '#majestic') majesticTimer = setTimeout(() => {
		if (!majesticPending) loadMajestic().catch(error => notice(error.message, true))
	}, 2000)
}

async function majesticAction(operation, body = {}) {
	if (majesticPending) return
	majesticPending = true
	renderMajesticControls()
	try {
		await api('majestic/' + operation, body)
		majesticSignature = null
		await loadMajestic()
	} catch (error) { notice(error.message, true) }
	finally {
		majesticPending = false
		renderMajesticControls()
		if (majesticState?.busy) {
			clearTimeout(majesticTimer)
			majesticTimer = setTimeout(() => loadMajestic().catch(error => notice(error.message, true)), 2000)
		}
	}
}

function majesticPreviewIssue() {
	const report = majesticState?.preview
	if (!report) return 'Нажми «Получить предпросмотр» или «Обновить данные», чтобы загрузить участников.'
	if (report.invalidated) return 'Предпросмотр использован или привязки изменены. Нажми «Обновить данные» для нового выбора.'
	if (Date.now() - report.generatedAt > 15 * 60 * 1000) return 'Предпросмотру больше 15 минут. Нажми «Обновить данные».'
	if (!report.rows.some(row => row.status === 'change')) return 'Нет доступных изменений. Проверь конфликты и строки «Нет доступа».'
	return ''
}

function renderMajesticControls() {
	const locked = majesticPending || majesticState?.busy
	const issue = majesticPreviewIssue()
	for (const id of majesticSelected) {
		if (issue || !majesticState.preview.rows.some(row => row.discordId === id && row.status === 'change')) majesticSelected.delete(id)
	}
	$('majesticPreview').disabled = Boolean(locked)
	$('majesticRefresh').disabled = majesticPending
	$('majesticRefresh').textContent = majesticState?.busy ? 'Обновить статус' : 'Обновить данные'
	$('majesticStop').disabled = Boolean(majesticPending || !majesticState?.busy || majesticState?.run?.stopRequested)
	$('majesticSelect').disabled = Boolean(locked || issue)
	$('majesticApply').disabled = Boolean(locked || issue || !majesticSelected.size)
	$('majesticApply').textContent = `Применить выбранные (${majesticSelected.size})`
	$('majesticSelectionHint').textContent = locked ? 'Дождись завершения операции. Статус обновляется автоматически.' :
		issue || 'Отметь участников флажками или нажми «Выбрать все изменения».'
	for (const control of $('majesticRows').querySelectorAll('button, input, select')) {
		control.disabled = Boolean(locked || (control.type === 'checkbox' && issue))
		if (control.type === 'checkbox' && issue) control.checked = false
	}
}

function renderMajestic() {
	const data = majesticState
	if (!data) return
	const report = data.preview
	const status = $('majesticStatus')
	status.replaceChildren()
	if (!data.configured) status.append(node('p', 'Задай MAJESTIC_SESSION_ID, MAJESTIC_SERVER и MAJESTIC_CHARACTER_ID в окружении бота или .env.majestic.local.', 'error'))
	if (data.run) {
		const kind = { apply: 'Применение', preview: 'Предпросмотр', nicknames: 'Автообновление ников', sync: 'Автосинхронизация ников и рангов' }[data.run.kind] || data.run.kind
		status.append(node('p', `${kind}: ${majesticLabels[data.run.status] || data.run.status} · ${data.run.completed}/${data.run.total}`))
		if (data.run.stopRequested) status.append(node('p', 'Запрошена остановка. Текущий запрос Discord может завершиться.'))
		if (data.run.error) status.append(node('p', data.run.error, 'error'))
	}
	if (report) {
		status.append(node('p', `В семье: ${report.familyTotal}. Получено: ${new Date(report.generatedAt).toLocaleString('ru-RU')}.`))
		status.append(node('p', Object.entries(report.summary).map(([key, count]) => `${majesticLabels[key] || key}: ${count}`).join(' · ')))
		if (report.invalidated) status.append(node('p', 'Предпросмотр использован или решения изменены. Получи новый перед применением.', 'error'))
	} else status.append(node('p', 'Получите предпросмотр, чтобы увидеть состав и конфликты.'))
	const roleName = id => resources?.roles.find(role => role.id === id)?.name || id
	const root = $('majesticRows')
	root.replaceChildren()
	const filter = $('majesticFilter').value
	for (const row of report?.rows || []) {
		if (filter === 'issues' ? !['change', 'conflict', 'blocked'].includes(row.status) : filter !== 'all' && row.status !== filter) continue
		const card = node('article', null, 'card majestic-row')
		const heading = node('div', null, 'majestic-heading')
		if (row.status === 'change') {
			const label = node('label', null, 'majestic-choice')
			const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.checked = majesticSelected.has(row.discordId)
			checkbox.addEventListener('change', () => {
				if (majesticPending || majesticState?.busy || majesticPreviewIssue()) { renderMajesticControls(); return }
				if (checkbox.checked) majesticSelected.add(row.discordId); else majesticSelected.delete(row.discordId)
				renderMajesticControls()
			})
			label.append(checkbox, node('span', 'Применить')); heading.append(label)
		}
		heading.append(node('strong', row.currentNickname || row.discordId), node('span', majesticLabels[row.status] || row.status, 'badge'))
		card.append(heading, node('p', `Discord ID: ${row.discordId}${row.static ? ' · Static: ' + row.static : ''}${row.gameRank ? ' · В игре: ' + row.gameRank : ''}`, 'muted'))
		const decision = data.decisions[row.discordId]
		if (decision?.static) card.append(node('p', 'Подтверждённая привязка: ' + decision.static))
		if (row.nickname) card.append(node('p', 'Новый ник: ' + row.nickname))
		if (row.addRoles?.length) card.append(node('p', 'Выдать: ' + row.addRoles.map(roleName).join(', ')))
		if (row.removeRoles?.length) card.append(node('p', 'Снять: ' + row.removeRoles.map(roleName).join(', ')))
		if (row.preservedTier) card.append(node('p', 'Tier-роль сохраняется.'))
		if (row.reason || row.roleNote) card.append(node('p', row.reason || row.roleNote))
		const details = node('div', null, 'majestic-actions')
		details.append(node('h4', 'Действия участника'))
		const controls = node('div', null, 'majestic-resolution')
		const staticLabel = node('label', 'Static персонажа')
		const staticInput = node('input'); staticInput.inputMode = 'numeric'; staticInput.value = decision?.static || row.static || ''; staticLabel.append(staticInput)
		const bind = node('button', 'Подтвердить привязку', 'quiet')
		bind.addEventListener('click', () => majesticAction('resolve', { discordId: row.discordId, static: staticInput.value.trim(), excluded: false }))
		controls.append(staticLabel, bind)
		const ownedTiers = Object.entries(data.rankRoles).filter(([rank, id]) => rank.startsWith('Tier ') && row.currentRoleIds?.includes(id))
		if (ownedTiers.length > 1) {
			const tierLabel = node('label', 'Оставить Tier')
			const select = node('select')
			for (const [rank, id] of ownedTiers) select.add(new Option(rank, id))
			if (decision?.tierRoleId) select.value = decision.tierRoleId
			tierLabel.append(select)
			const saveTier = node('button', 'Сохранить выбор Tier', 'quiet')
			saveTier.addEventListener('click', () => majesticAction('resolve', { discordId: row.discordId, tierRoleId: select.value }))
			controls.append(tierLabel, saveTier)
		}
		const exclude = node('button', row.status === 'excluded' ? 'Вернуть в синхронизацию' : 'Исключить из синхронизации', 'quiet')
		exclude.addEventListener('click', () => majesticAction('resolve', { discordId: row.discordId, excluded: row.status !== 'excluded' }))
		controls.append(exclude)
		if (decision) {
			const reset = node('button', 'Сбросить решение', 'quiet')
			reset.addEventListener('click', () => majesticAction('resolve', { discordId: row.discordId, reset: true }))
			controls.append(reset)
		}
		details.append(controls)
		if (row.reason?.includes('нескольких участников')) details.append(node('p', 'Подтверди правильный static для каждого аккаунта или исключи лишний аккаунт.'))
		card.append(details); root.append(card)
	}
	if (!root.children.length) root.append(node('p', 'Нет участников для выбранного фильтра.', 'empty'))
	const results = $('majesticResults')
	results.replaceChildren(node('h3', 'Результат последней операции'))
	for (const result of data.run?.results || []) results.append(node('p', `${result.before || result.discordId}: ${majesticLabels[result.status] || result.status}${result.error ? ' · ' + result.error : ''}`))
	renderMajesticControls()
}

function initMajestic() {
	$('majesticPreview').addEventListener('click', () => majesticAction('preview'))
	$('majesticRefresh').addEventListener('click', async () => {
		if (majesticPending) return
		if (!majesticState?.busy) return majesticAction('preview')
		try { await loadMajestic(); notice('Статус операции обновлён.') }
		catch (error) { notice(error.message, true) }
	})
	$('majesticStop').addEventListener('click', () => majesticAction('stop'))
	$('majesticFilter').addEventListener('change', renderMajestic)
	$('majesticSelect').addEventListener('click', () => {
		if (majesticPending || majesticState?.busy || majesticPreviewIssue()) return
		const rows = majesticState?.preview?.rows.filter(row => row.status === 'change') || []
		const allSelected = rows.every(row => majesticSelected.has(row.discordId))
		majesticSelected.clear()
		if (!allSelected) for (const row of rows) majesticSelected.add(row.discordId)
		renderMajestic()
	})
	$('majesticApply').addEventListener('click', () => {
		const issue = majesticPreviewIssue()
		if (issue || !majesticSelected.size) return notice(issue || 'Выбери участников для применения.', true)
		return majesticAction('apply', { previewId: majesticState.preview.id, discordIds: [...majesticSelected] })
	})
}
