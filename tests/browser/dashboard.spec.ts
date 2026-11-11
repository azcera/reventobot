import { test, expect, type Page, type Route } from '@playwright/test'
import assert from 'node:assert/strict'
import type { Config, Decision, MajesticState, SettingValue } from '../../frontend/src/types'
const { createStore } = require('../../dist/src/dashboard/store.js') as { createStore(): { snapshot(): Config } }

interface RequestBody extends Decision { values: Record<string, SettingValue | null>; discordId: string; ids?: string[]; link?: string; name?: string; kind?: string }
interface RecordedCall { path: string; body: RequestBody; headers: Record<string, string> }
interface ResponseContext { route: Route; path: string; body: RequestBody; config: Config; majestic: MajesticState }
interface SetupOptions { respond?(context: ResponseContext): Promise<boolean | void> }

const channelId = '222222222222222222'
const messageLink = `https://discord.com/channels/111111111111111111/${channelId}/444444444444444444`
const resources = { channels: [{ id: channelId, name: 'набор', type: 0, canSend: true }, { id: '555555555555555555', name: 'архив', type: 0, canSend: true }], roles: [{ id: '666666666666666666', name: 'Модератор' }, { id: '777777777777777777', name: 'Участник' }] }
const imported = { url: messageLink, revision: 'revision-1', channelId, canEdit: true }

async function setup(page: Page, options: SetupOptions = {}) {
	const config = createStore().snapshot()
	const calls: RecordedCall[] = [], errors: string[] = []
	page.on('pageerror', error => errors.push(error.message))
	const majestic: MajesticState & { preview: NonNullable<MajesticState['preview']> } = { configured: true, busy: false, decisions: {}, rankRoles: {}, run: null, preview: { id: 'preview-1', generatedAt: Date.now(), familyTotal: 2, summary: { change: 1, conflict: 1 }, rows: [{ discordId: 'user', currentNickname: '<script> | 1', nickname: 'Maya | 1', static: '1', status: 'change', addRoles: [resources.roles[1].id], removeRoles: [], currentRoleIds: [] }, { discordId: 'conflict', currentNickname: 'Other | 2', static: '2', status: 'conflict', reason: 'Конфликт', currentRoleIds: [] }] } }
	await page.route('**/api/**', async route => {
		const request = route.request()
		const path = new URL(request.url()).pathname.slice('/api/'.length)
		const body = request.postDataJSON() as RequestBody
		calls.push({ path, body, headers: request.headers() })
		if (options.respond && await options.respond({ route, path, body, config, majestic })) return
		let data: unknown = {}
		if (path === 'session') data = { user: { id: 'admin', name: 'Администратор' }, guild: { id: '111111111111111111', name: 'REVENTO' }, csrf: 'test-csrf' }
		else if (path === 'config') data = config
		else if (path === 'resources') data = resources
		else if (path === 'overview') data = { ready: true, database: true, ping: 42, uptime: 3600, history: [] }
		else if (path === 'history') data = [{ id: 1, action: 'templates', target: 'invite.document', actor: 'admin', created_at: new Date().toISOString(), details: { actorName: 'Администратор', fields: { 'invite.document': { label: 'Приглашение', before: 'Было', after: 'Стало' } } } }]
		else if (path === 'templates/create') {
			const kind = 'custom-11111111-1111-4111-8111-111111111111'
			const field = { key: 'permanent.' + kind + '.document', group: body.name!, label: 'Текст сообщения', type: 'text', components: true, default: '# Новое сообщение', value: '# Новое сообщение' }
			config.templates.push(field); config.bindings[kind] = { link: '', fields: [field] }; config.revision++; data = config
		}
		else if (path === 'templates') { for (const [key, value] of Object.entries(body.values)) { const field = config.templates.find(field => field.key === key); if (field) field.value = value == null ? field.default ?? '' : String(value) } config.revision++; data = config }
		else if (path === 'settings') { for (const [key, value] of Object.entries(body.values)) config.settings.find(field => field.key === key)!.value = value ?? ''; config.revision++; data = config }
		else if (path === 'container-message') data = { success: true, source: imported, items: [{ type: 'text', value: '## Загруженный контейнер' }] }
		else if (path === 'send-container') data = { success: true }
		else if (path === 'edit-container') data = { success: true, source: { ...imported, revision: 'revision-2' } }
		else if (path === 'majestic') data = majestic
		else if (path === 'majestic/resolve') { majestic.decisions[body.discordId] = body; majestic.preview.invalidated = true; data = majestic }
		else if (path.startsWith('majestic/')) data = majestic
		else if (path.startsWith('permanent-message')) { config.revision++; config.bindings[body.kind || 'invite'] = { ...config.bindings[body.kind || 'invite'], link: messageLink }; data = config }
		else if (path === 'role-prefixes/sync') data = { updated: 1, unchanged: 0, skipped: 0, failed: 0 }
		await route.fulfill({ json: data })
	})
	return { config, calls, errors, majestic }
}

async function navigate(page: Page, key: string, mobile: boolean) {
	if (mobile) await page.getByRole('button', { name: 'Открыть меню', exact: true }).click()
	await page.getByRole('navigation').getByRole('link', { name: key, exact: true }).click()
}

test('shell keeps the palette, removes the standalone message editor and fits the viewport', async ({ page, isMobile }) => {
	const { errors } = await setup(page)
	await page.goto('/')
	await expect(page.getByRole('heading', { name: 'Центр управления Revento' })).toBeVisible()
	await navigate(page, 'Шаблоны', isMobile)
	await expect(page.getByRole('heading', { name: 'Шаблоны сообщений' })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Сообщения в Discord' })).toHaveCount(0)
	expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(11, 10, 16)')
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
	expect(errors).toEqual([])
	await page.screenshot({ path: `output/dashboard-review/${isMobile ? 'mobile' : 'desktop'}-templates.png`, fullPage: true })
})

test('preview is explicit, freezes a snapshot and saves template changes with CSRF', async ({ page }) => {
	const { calls, errors } = await setup(page)
	await page.goto('/#templates')
	await page.getByLabel('Раздел шаблона').selectOption('Памятка рекрута')
	const editor = page.getByRole('textbox', { name: 'Текст сообщения (Markdown)', exact: true })
	await editor.fill('## Проверка предпросмотра\n**Жирный** и ||секрет||')
	await expect(page.locator('.discord-preview:visible')).toHaveCount(0)
	await page.getByRole('tab', { name: 'Предпросмотр', exact: true }).click()
	await expect(page.locator('.discord-preview h2')).toHaveText('Проверка предпросмотра')
	await page.locator('.discord-spoiler').click()
	await expect(page.locator('.discord-spoiler')).toHaveAttribute('aria-expanded', 'true')
	await page.getByRole('tab', { name: 'Редактировать', exact: true }).click()
	await editor.fill('## Новая версия')
	await page.getByRole('tab', { name: 'Предпросмотр', exact: true }).click()
	await expect(page.locator('.discord-preview h2')).toHaveText('Новая версия')
	await page.screenshot({ path: `output/dashboard-review/${test.info().project.name}-discord-preview.png`, fullPage: true })
	await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
	await expect(page.getByRole('status').filter({ hasText: 'Шаблон сохранён' })).toBeVisible()
	const saved = calls.find(call => call.path === 'templates')
	assert.ok(saved)
	expect(saved.body.values).toEqual({ 'recruit.document': '## Новая версия' })
	expect(saved.headers['x-csrf-token']).toBe('test-csrf')
	expect(errors).toEqual([])
})

test('drafts, formatting history and mentions survive ordinary navigation', async ({ page, isMobile }) => {
	const { errors } = await setup(page)
	await page.goto('/#templates')
	await page.getByLabel('Раздел шаблона').selectOption('Памятка рекрута')
	const editor = page.getByRole('textbox', { name: 'Текст сообщения (Markdown)', exact: true })
	await editor.fill('Черновик')
	await editor.selectText()
	await page.getByRole('button', { name: 'Полужирный', exact: true }).click()
	await expect(editor).toHaveValue('**Черновик**')
	await page.getByRole('button', { name: 'Отменить (Ctrl+Z)', exact: true }).click()
	await expect(editor).toHaveValue('Черновик')
	await editor.fill('Привет @Мод')
	await page.getByRole('option', { name: /@Модератор/ }).click()
	await expect(editor).toHaveValue('Привет <@&666666666666666666> ')
	await page.getByLabel('Раздел шаблона').selectOption('Заявка')
	await page.getByLabel('Раздел шаблона').selectOption('Памятка рекрута')
	await expect(editor).toHaveValue('Привет <@&666666666666666666> ')
	await navigate(page, 'Настройки', isMobile)
	await navigate(page, 'Шаблоны', isMobile)
	await expect(editor).toHaveValue('Привет <@&666666666666666666> ')
	expect(errors).toEqual([])
})

test('errors, guides and discard confirmations are accessible modal dialogs', async ({ page }) => {
	const { errors } = await setup(page, { respond: async ({ route, path }) => {
		if (path === 'templates') { await route.fulfill({ status: 403, json: { error: 'Боту не хватает прав для отправки.' } }); return true }
	} })
	await page.goto('/#templates')
	await page.getByLabel('Раздел шаблона').selectOption('Памятка рекрута')
	await page.getByRole('textbox', { name: 'Текст сообщения (Markdown)', exact: true }).fill('Проверка')
	await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
	await expect(page.getByRole('dialog')).toContainText('Боту не хватает прав')
	await page.keyboard.press('Escape')
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await page.getByRole('button', { name: 'Руководство по разделу' }).click()
	await expect(page.getByRole('dialog')).toContainText('Как работать с шаблонами')
	await page.screenshot({ path: `output/dashboard-review/${test.info().project.name}-guide.png`, fullPage: true })
	await page.keyboard.press('Escape')
	await page.getByRole('button', { name: 'Обновить данные', exact: true }).click()
	await expect(page.getByRole('dialog')).toContainText('Несохранённые правки')
	await page.getByRole('button', { name: 'Отмена', exact: true }).click()
	await expect(page.getByRole('textbox', { name: 'Текст сообщения (Markdown)', exact: true })).toHaveValue('Проверка')
	expect(errors).toEqual([])
})

test('modal keeps its close tooltip inside and locks background scrolling', async ({ page, isMobile }) => {
	await setup(page)
	await page.goto('/#templates')
	await page.getByLabel('Раздел шаблона').selectOption('Памятка рекрута')
	await page.evaluate(() => { document.body.style.minHeight = '300vh'; window.scrollTo(0, 200) })
	await page.getByRole('button', { name: 'Руководство по разделу' }).click()
	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	const close = dialog.getByRole('button', { name: 'Закрыть окно' })
	if (isMobile) { await page.keyboard.press('Tab'); await close.focus() }
	else await close.hover()
	const tooltip = close.getByRole('tooltip')
	await expect(tooltip).toBeVisible()
	const bounds = await dialog.boundingBox()
	const tip = await tooltip.boundingBox()
	assert.ok(bounds && tip)
	expect(tip.x).toBeGreaterThanOrEqual(bounds.x)
	expect(tip.y).toBeGreaterThanOrEqual(bounds.y)
	expect(tip.x + tip.width).toBeLessThanOrEqual(bounds.x + bounds.width)
	expect(tip.y + tip.height).toBeLessThanOrEqual(bounds.y + bounds.height)
	expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
	expect(await page.evaluate(() => [document.documentElement, document.body].map(element => getComputedStyle(element).overflowY))).toEqual(['hidden', 'hidden'])
	const scrollY = await page.evaluate(() => window.scrollY)
	await page.mouse.move(2, 2)
	await page.mouse.wheel(0, 500)
	await page.keyboard.press('PageDown')
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY)
	await dialog.evaluate(element => { element.scrollTop = element.scrollHeight })
	if (await dialog.evaluate(element => element.scrollHeight > element.clientHeight)) {
		expect(await dialog.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
	}
	await page.keyboard.press('Escape')
	await expect(dialog).toHaveCount(0)
	expect(await page.evaluate(() => [document.documentElement, document.body].every(element => getComputedStyle(element).overflowY !== 'hidden'))).toBe(true)
	await page.evaluate(() => window.scrollBy(0, 100))
	expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollY)
})

test('new template is created on the templates page and publishes with a persistent binding', async ({ page }) => {
	const { calls, errors } = await setup(page)
	await page.goto('/#templates')
	await expect(page.getByRole('navigation').getByRole('link', { name: 'Конструктор v2' })).toHaveCount(0)
	await page.getByRole('button', { name: 'Новый шаблон', exact: true }).click()
	await page.getByLabel('Название шаблона').fill('Моё сообщение')
	await page.getByRole('button', { name: 'Создать шаблон', exact: true }).click()
	await expect(page.getByLabel('Раздел шаблона')).toHaveValue('Моё сообщение')
	const editor = page.getByRole('textbox', { name: 'Текст сообщения', exact: true })
	await editor.fill('## Мой текст')
	await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
	await expect(page.getByRole('status').filter({ hasText: 'Шаблон сохранён' })).toBeVisible()
	await page.getByRole('button', { name: 'Настроить постоянное сообщение', exact: true }).click()
	await page.getByLabel('Канал публикации', { exact: true }).selectOption(channelId)
	await page.getByRole('button', { name: 'Опубликовать / обновить', exact: true }).click()
	await page.getByRole('button', { name: 'Опубликовать', exact: true }).click()
	await expect(page.getByRole('status').filter({ hasText: 'Сообщение опубликовано' })).toBeVisible()
	expect(calls.find(call => call.path === 'templates/create')!.headers['x-csrf-token']).toBe('test-csrf')
	expect(calls.find(call => call.path === 'permanent-message/publish')!.body).toMatchObject({ channelId, kind: 'custom-11111111-1111-4111-8111-111111111111' })
	expect(errors).toEqual([])
})

test('Majestic applies only selected participants and invalidation disables applying', async ({ page }) => {
	const { calls, errors, majestic } = await setup(page)
	await page.goto('/#majestic')
	const apply = page.getByRole('button', { name: 'Применить выбранные', exact: true })
	await expect(apply).toBeDisabled()
	await page.getByRole('checkbox', { name: 'Применить изменения: <script> | 1', exact: true }).check()
	await expect(apply).toBeEnabled()
	await apply.click()
	await expect.poll(() => calls.filter(call => call.path === 'majestic/apply').length).toBe(1)
	expect(calls.find(call => call.path === 'majestic/apply')!.body).toEqual({ previewId: 'preview-1', discordIds: ['user'] })
	await page.getByLabel('Поиск участника').fill('Other')
	await expect(page.locator('.participant-card:visible')).toHaveCount(1)
	await page.getByRole('button', { name: 'Действия участника: Other | 2', exact: true }).click()
	await page.getByLabel('Static персонажа').fill('987654')
	await page.getByRole('button', { name: 'Подтвердить привязку', exact: true }).click()
	await expect.poll(() => calls.filter(call => call.path === 'majestic/resolve').length).toBe(1)
	await expect(apply).toBeDisabled()
	expect(majestic.preview.invalidated).toBe(true)
	expect(errors).toEqual([])
})

test('permanent message modal completes its action without trapping a second confirmation', async ({ page }) => {
	const { calls, errors } = await setup(page)
	await page.goto('/#templates')
	await page.getByLabel('Раздел шаблона').selectOption('Приглашение')
	await page.getByRole('button', { name: 'Настроить постоянное сообщение' }).click()
	await page.getByRole('dialog').getByLabel('Канал публикации').selectOption(channelId)
	await page.getByRole('button', { name: 'Опубликовать / обновить', exact: true }).click()
	await expect(page.getByRole('dialog')).toContainText('Опубликовать шаблон?')
	await page.getByRole('dialog').getByRole('button', { name: 'Опубликовать', exact: true }).click()
	await expect.poll(() => calls.filter(call => call.path === 'permanent-message/publish').length).toBe(1)
	await expect(page.getByRole('dialog')).toHaveCount(0)
	expect(errors).toEqual([])
})

test('settings preserve ordered roles, switches, prefixes and saved payloads', async ({ page }) => {
	const { calls, errors } = await setup(page)
	await page.goto('/#settings')
	await page.getByLabel('Роли модераторов бота (не дают доступ в дашборд)').selectOption(resources.roles[0].id)
	await page.getByLabel('Роли модераторов бота (не дают доступ в дашборд)').selectOption(resources.roles[1].id)
	const section = page.getByRole('heading', { name: 'Роли и приоритеты', exact: true }).locator('..').locator('..')
	const first = section.locator('.ordered-row').first()
	await first.getByRole('button', { name: 'Понизить приоритет', exact: true }).click()
	const toggle = page.getByRole('switch', { name: 'Доставка массовой Telegram-рассылки', exact: true })
	await toggle.uncheck()
	await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click()
	await expect.poll(() => calls.filter(call => call.path === 'settings').length).toBe(1)
	expect(calls.find(call => call.path === 'settings')!.body.values).toMatchObject({ ADMIN_ROLES: resources.roles[1].id + ',' + resources.roles[0].id, TELEGRAM_BROADCAST_ENABLED: false })
	expect(errors).toEqual([])
})

test('application and direct-message previews keep their states separate and preserve edits', async ({ page }) => {
	const { errors } = await setup(page)
	await page.goto('/#templates')
	await page.getByLabel('Раздел шаблона').selectOption('Заявка')
	const pending = page.getByRole('textbox', { name: 'На рассмотрении', exact: true })
	await pending.fill('## Проверка анкеты\n{name}\n\n---\nНа рассмотрении')
	await page.getByRole('tab', { name: 'Предпросмотр', exact: true }).click()
	const preview = page.locator('.discord-preview:visible')
	await expect(preview).toContainText('Проверка анкеты')
	await expect(preview).toContainText('Tony | 132961')
	await expect(preview).toContainText('Принять')
	for (const state of ['accepted', 'rejected', 'interview']) {
		await page.getByLabel('Состояние заявки в предпросмотре').selectOption(state)
		await expect(preview).not.toContainText('Проверка анкеты')
		await expect(preview).not.toContainText('На рассмотрении')
		await expect(preview).not.toContainText('{name}')
	}
	await page.getByLabel('Раздел шаблона').selectOption('Личные сообщения заявок')
	await page.getByRole('tab', { name: 'Предпросмотр', exact: true }).click()
	for (const state of ['accepted', 'rejected', 'interview']) {
		await page.getByLabel('Состояние заявки в предпросмотре').selectOption(state)
		await expect(preview).toContainText('REVENTO')
		await expect(preview).not.toContainText('{server}')
		await expect(preview).not.toContainText('<t:')
	}
	await page.getByLabel('Раздел шаблона').selectOption('Заявка')
	await expect(pending).toHaveValue('## Проверка анкеты\n{name}\n\n---\nНа рассмотрении')
	expect(errors).toEqual([])
})

test('invalid component syntax opens an error and keeps the editable draft intact', async ({ page }) => {
	const { errors } = await setup(page)
	await page.goto('/#templates')
	await page.getByLabel('Раздел шаблона').selectOption('Памятка рекрута')
	const editor = page.getByRole('textbox', { name: 'Текст сообщения (Markdown)', exact: true })
	await editor.fill('<img src="javascript:alert(1)" />')
	await page.getByRole('tab', { name: 'Предпросмотр', exact: true }).click()
	await expect(page.getByRole('dialog')).toContainText('Не удалось открыть предпросмотр')
	await page.keyboard.press('Escape')
	await expect(editor).toBeVisible()
	await expect(editor).toHaveValue('<img src="javascript:alert(1)" />')
	await expect(page.locator('.discord-preview:visible')).toHaveCount(0)
	expect(errors).toEqual([])
})

test('long documents resize when the editor becomes visible; undo restores a multiline selection', async ({ page, isMobile }) => {
	const { errors } = await setup(page)
	await page.goto('/')
	await navigate(page, 'Шаблоны', isMobile)
	await page.getByLabel('Раздел шаблона').selectOption('Памятка рекрута')
	const editor = page.getByRole('textbox', { name: 'Текст сообщения (Markdown)', exact: true })
	const text = Array.from({ length: 25 }, (_, index) => 'Строка ' + (index + 1)).join('\n')
	await editor.fill(text)
	expect(await editor.evaluate(input => input.clientHeight >= input.scrollHeight)).toBe(true)
	await editor.selectText()
	await page.getByRole('button', { name: 'Цитата', exact: true }).click()
	await expect(editor).toHaveValue(text.split('\n').map(line => '> ' + line).join('\n') + '\n')
	await page.keyboard.press('Control+z')
	await expect(editor).toHaveValue(text)
	const selection = await editor.evaluate(input => [(input as HTMLTextAreaElement).selectionStart, (input as HTMLTextAreaElement).selectionEnd])
	expect(selection).toEqual([0, text.length])
	await navigate(page, 'Настройки', isMobile)
	await navigate(page, 'Шаблоны', isMobile)
	await page.getByLabel('Раздел шаблона').selectOption('Памятка рекрута')
	expect(await editor.evaluate(input => input.clientHeight >= input.scrollHeight)).toBe(true)
	expect(errors).toEqual([])
})

test('history shows changed fields in a modal and login failures use the same error dialog', async ({ page, isMobile }) => {
	const { errors } = await setup(page)
	await page.goto('/#history')
	await page.getByRole('button', { name: 'Подробности изменения', exact: true }).click()
	await expect(page.getByRole('dialog')).toContainText('Было:\nБыло\n\nСтало:\nСтало')
	await page.keyboard.press('Escape')
	await navigate(page, 'Обзор', isMobile)
	await page.screenshot({ path: `output/dashboard-review/${test.info().project.name}-overview.png`, fullPage: true })
	await page.route('**/api/session', route => route.fulfill({ status: 401, json: { error: 'Войдите через Discord.' } }))
	await page.goto('/?error=' + encodeURIComponent('Вход отменён в Discord.'))
	await expect(page.getByRole('dialog')).toContainText('Вход отменён в Discord.')
	await page.keyboard.press('Escape')
	await expect(page.getByRole('link', { name: 'Войти через Discord' })).toBeVisible()
	expect(errors).toEqual([])
})

test('history uses readable operation and server names in both views', async ({ page, isMobile }) => {
	const entries = [
		['majestic.sync.request', 'Запуск автосинхронизации Majestic'],
		['majestic.sync.result', 'Результат автосинхронизации Majestic'],
		['majestic.preview.request', 'Запуск проверки состава Majestic'],
		['majestic.preview.result', 'Результат проверки состава Majestic'],
		['majestic.apply.request', 'Запрос применения изменений Majestic'],
		['majestic.apply.result', 'Результат применения изменений Majestic'],
		['majestic.member.request', 'Запрос обновления участника Majestic'],
		['majestic.member.result', 'Результат обновления участника Majestic'],
		['majestic.bind.auto', 'Автоматическая привязка участника Majestic'],
		['majestic.resolve', 'Решение по участнику Majestic'],
		['majestic.stop', 'Остановка синхронизации Majestic'],
		['family.kick.request', 'Запрос исключения участника с сервера'],
		['family.kick.result', 'Участник исключён с сервера'],
		['family.roles.request', 'Запрос снятия ролей участника'],
		['family.roles.result', 'Роли участника сняты'],
		['role-prefixes.sync.request', 'Запрос обновления префиксов']
	]
	const history = entries.map(([action], id) => ({ id, action, target: '111111111111111111', actor: 'admin', created_at: new Date().toISOString(), details: { actorName: 'Администратор' } }))
	const { errors } = await setup(page, { respond: async ({ route, path }) => {
		if (path === 'history') { await route.fulfill({ json: history }); return true }
		if (path === 'overview') { await route.fulfill({ json: { ready: true, database: true, ping: 42, uptime: 3600, history: history.slice(0, 2) } }); return true }
	} })
	await page.goto('/')
	const recent = page.locator('.history-row:visible')
	await expect(recent).toHaveCount(2)
	await expect(recent.first()).toContainText('Запуск автосинхронизации Majestic')
	await expect(recent.first()).toContainText('REVENTO')
	await expect(recent.first()).not.toContainText('111111111111111111')
	await navigate(page, 'История изменений', isMobile)
	const rows = page.locator('.history-row:visible')
	await expect(rows).toHaveCount(entries.length)
	for (const [index, [action, title]] of entries.entries()) {
		await expect(rows.nth(index).getByRole('heading')).toHaveText(title)
		await expect(rows.nth(index)).not.toContainText(action)
	}
	await rows.first().getByRole('button', { name: 'Подробности изменения' }).click()
	await expect(page.getByRole('dialog')).toContainText(entries[0][1])
	expect(errors).toEqual([])
})

test('Discord components retain their layout and fit a narrow screen', async ({ page, isMobile }) => {
	const { errors } = await setup(page)
	await page.goto('/#templates')
	await page.getByLabel('Раздел шаблона').selectOption('Памятка рекрута')
	const source = '## Стань частью Revento\nПривет, <@&666666666666666666>!\n**Жирный** и __подчёркнутый__ текст.\n\n---\n\n> Ознакомься с правилами семьи.\n\n- Первый пункт\n- Второй пункт\n\n***\n\n<section buttonLabel="Открыть правила" buttonLink="https://example.com">## Правила\nВсё, что нужно знать перед вступлением.</section>\n\n---\n\n||Скрытая подсказка||';
	await page.getByRole('textbox', { name: 'Текст сообщения (Markdown)', exact: true }).fill(source)
	await page.getByRole('tab', { name: 'Предпросмотр', exact: true }).click()
	const preview = page.locator('.discord-preview:visible')
	await expect(preview).toContainText('@Модератор')
	await expect(preview.locator('.discord-section')).toContainText('Открыть правила')
	await expect(preview.locator('.discord-button-secondary')).toHaveCSS('background-color', 'rgb(78, 80, 88)')
	await expect(preview.locator('.discord-divider-large')).toHaveCount(1)
	await page.screenshot({ path: `output/dashboard-review/${test.info().project.name}-discord-components.png`, fullPage: true })
	if (!isMobile) {
		await page.setViewportSize({ width: 320, height: 850 })
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
		await page.getByRole('button', { name: 'Руководство по разделу' }).click()
		await expect(page.getByRole('dialog')).toBeVisible()
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
	}
	expect(errors).toEqual([])
})
