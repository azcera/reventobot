import { test, expect, type Page } from '@playwright/test'

async function setup(page: Page, hash: string, source = 'Начало [ссылка](https://example.com) конец', templateVariables: Record<string, Record<string, string>> = {}) {
	const config = { revision: 3, bindings: {}, templateVariables, templates: [{ key: 'promotion.document', group: 'Система повышения', label: 'Текст', type: 'text', components: true, maxLength: 16000, value: source, variables: [] }], settings: [{ key: 'INVITE_CATEGORY_ID', label: 'Категория заявок', type: 'channel', channelTypes: [4], value: '' }, { key: 'MAJESTIC_AUTO_KICK', label: 'Автоматическое исключение', type: 'boolean', value: true }] }
	const preset = { id: '12345678-1234-1234-1234-123456789012', command: 'test', target: 'Сбор', channelId: 'parent', accessRoleId: 'one', maxMain: 10 }
	let curators = [{ roleId: 'one', managedRoleIds: ['one'] }]
	const requests: { path: string; body: any }[] = []
	await page.route('**/api/**', async route => {
		const path = new URL(route.request().url()).pathname.slice(5)
		const body = route.request().postDataJSON()
		requests.push({ path, body })
		if (path === 'role-curators' && body?.curators) curators = body.curators
		if (path === 'settings' && body?.values) {
			for (const field of config.settings) if (Object.hasOwn(body.values, field.key)) field.value = body.values[field.key]
			config.revision++
		}
		if (path === 'template-variables' && body?.values) {
			Object.assign(config, { templateVariables: { [body.group]: body.values }, templateVariableLabels: { [body.group]: body.labels } })
			config.revision++
		}
		const data: Record<string, unknown> = { overview: { ready: true, ping: 42, database: true, uptime: 3600, history: [] }, history: [], session: { csrf: 'test', guild: { id: 'g', name: 'Guild' }, user: { id: 'u', name: 'User' } }, config, resources: { roles: [{ id: 'one', name: 'Первая' }, { id: 'two', name: 'Вторая' }], channels: [{ id: 'parent', name: 'общий', type: 0, canSend: true }] }, 'capture-presets': { revision: 3, presets: body?.presets || [preset] }, 'role-curators': { revision: 3, curators }, 'channel-threads/parent': [{ id: 'thread', name: 'Ветка', type: 11 }], 'permanent-message/publish': config, templates: config, 'template-variables': { ...config, revision: 4, templateVariables: { 'Система повышения': body?.values } } }
		await route.fulfill({ json: ['settings', 'template-variables'].includes(path) ? config : data[path] ?? {} })
	})
	await page.goto('/#' + hash)
	await expect(page.getByRole('heading', { name: ({ overview: 'Обзор', settings: 'Настройки', variables: 'Переменные шаблонов', templates: 'Шаблоны сообщений', captures: 'Управление сборами', curators: 'Кураторы ролей' } as Record<string, string>)[hash], exact: true })).toBeVisible()
	return requests
}

test('variable history shows changed variable names instead of the internal action', async ({ page }) => {
	await setup(page, 'settings')
	const group = 'Система повышения'
	await page.route('**/api/history', route => route.fulfill({ json: [
		{ id: 1, action: 'templateVariables', target: group, actor: 'u', created_at: '2026-01-01T12:00:00Z', details: { fields: { [group]: { before: { price: '100', unchanged: 'same' }, after: { price: '200', unchanged: 'same' } }, [group + '.labels']: { after: { price: 'Цена пулемёта' } } } } },
		{ id: 2, action: 'templateVariables', target: group, actor: 'u', created_at: '2026-01-01T12:00:00Z', details: JSON.stringify({ fields: { [group]: { before: { removed: '100' }, after: {} } } }) },
		{ id: 3, action: 'templateVariables', target: group, actor: 'u', created_at: '2026-01-01T12:00:00Z', details: { fields: { [group + '.labels']: { before: { price: 'Цена' }, after: { price: 'Новая цена' } } } } }
	] }))
	await page.goto('/#history')
	await expect(page.getByRole('heading', { name: 'Изменение переменной · Цена пулемёта', exact: true })).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Изменение переменной · removed', exact: true })).toBeVisible()
	await expect(page.getByRole('heading', { name: 'Изменение переменной · Новая цена', exact: true })).toBeVisible()
	await expect(page.locator('.history-row').filter({ hasText: /templateVariables|unchanged/ })).toHaveCount(0)
})

test('settings categories start collapsed and search opens matches', async ({ page }) => {
	await setup(page, 'settings')
	const category = page.locator('details').filter({ hasText: 'Заявки и принятие' })
	await expect(category).not.toHaveAttribute('open', '')
	await page.getByRole('searchbox', { name: 'Поиск настроек' }).fill('Категория заявок')
	await expect(category).toHaveAttribute('open', '')
	await expect(page.getByLabel('Категория заявок')).toBeVisible()
})

test('missing DB settings can be opened, saved and remain configured after reload', async ({ page }) => {
	const requests = await setup(page, 'settings')
	await expect(page.getByText('Не заполнено в БД:', { exact: false })).toBeVisible()
	await page.getByRole('button', { name: 'Категория заявок', exact: true }).click()
	await expect(page.getByLabel('Категория заявок')).toBeVisible()
	// The fixture supplies a text channel; make it an allowed category for this test.
	await page.route('**/api/resources', route => route.fulfill({ json: { roles: [], channels: [{ id: 'category', name: 'Заявки', type: 4 }] } }))
	await page.reload()
	await page.getByRole('button', { name: 'Категория заявок', exact: true }).click()
	await page.getByLabel('Категория заявок').selectOption('category')
	await page.getByRole('button', { name: 'Сохранить настройки', exact: true }).click()
	await expect.poll(() => requests.find(r => r.path === 'settings')?.body).toEqual({ revision: 3, values: { INVITE_CATEGORY_ID: 'category' } })
	await expect(page.getByText('Не заполнено в БД:', { exact: false })).toHaveCount(0)
	await page.reload()
	await expect(page.getByText('Не заполнено в БД:', { exact: false })).toHaveCount(0)
})

test('thread picker loads lazily and publishes selected thread', async ({ page }) => {
	const requests = await setup(page, 'templates')
	await expect.poll(() => requests.filter(r => r.path.startsWith('channel-threads')).length).toBe(0)
	await page.getByRole('button', { name: 'Настроить постоянное сообщение' }).click()
	await page.getByRole('button', { name: 'Ветки', exact: true }).click()
	await page.getByLabel('Ветка', { exact: true }).check()
	await page.getByRole('button', { name: 'Опубликовать / обновить' }).click()
	await page.getByRole('button', { name: 'Опубликовать', exact: true }).click()
	await expect.poll(() => requests.find(r => r.path === 'permanent-message/publish')?.body).toEqual({ kind: 'promotion', channelId: 'thread', revision: 3 })
})

test('variable changes save', async ({ page }) => {
	const source = '<section buttonLabel="Открыть" buttonLink="https://example.com">Цена {цена-пулик}</section>'
	const requests = await setup(page, 'templates', source)
	await page.getByRole('button', { name: 'Добавить переменную' }).click()
	await page.getByLabel('Название переменной', { exact: true }).fill('Цена пулемёта')
	await page.getByLabel('Ключ', { exact: true }).fill('цена-пулик')
	await page.getByLabel('Значение', { exact: true }).fill('100')
	await page.getByRole('button', { name: 'Сохранить переменные' }).click()
	await expect.poll(() => requests.find(r => r.path === 'template-variables')?.body).toEqual({ group: 'Система повышения', values: { 'цена-пулик': '100' }, labels: { 'цена-пулик': 'Цена пулемёта' }, revision: 3 })
	await expect(page.getByText('Переменные сохранены. Публикации обновлены.')).toBeVisible()
	await page.reload()
	await expect(page.getByRole('textbox', { name: 'Название переменной', exact: true })).toHaveValue('Цена пулемёта')
	await page.goto('/#variables')
	await page.getByRole('searchbox', { name: 'Поиск переменных' }).fill('пулемёта')
	await expect(page.getByRole('textbox', { name: 'Название переменной', exact: true })).toHaveValue('Цена пулемёта')
	await page.goto('/#templates')
	await expect(page.getByRole('textbox', { name: 'Название переменной', exact: true })).toHaveValue('Цена пулемёта')
	await page.getByRole('tab', { name: 'Просмотр' }).click()
	await expect(page.getByLabel('Предпросмотр сообщения в Discord')).toContainText('Цена 100')
	await expect(page.getByLabel('Предпросмотр сообщения в Discord')).not.toContainText('{цена-пулик}')
})

test('variable without saved label displays its existing key', async ({ page }) => {
	await setup(page, 'variables', undefined, { 'Система повышения': { old_key: 'old value' } })
	await expect(page.getByRole('textbox', { name: 'Название переменной', exact: true })).toHaveValue('old_key')
	await expect(page.getByRole('textbox', { name: 'Значение', exact: true })).toHaveValue('old value')
})

test('channel mentions display names in editors and preserve source through copy, deletion and undo', async ({ page }) => {
	const channel = '<#1570143084304539740>'
	const requests = await setup(page, 'templates', `Начало ${channel}`)
	await page.route('**/api/resources', route => route.fulfill({ json: { roles: [], channels: [{ id: '1570143084304539740', name: 'общий', type: 0 }] } }))
	await page.reload()
	const editor = page.getByRole('textbox', { name: 'Текст сообщения' })
	const mention = editor.locator('.discord-mention')
	await expect(mention).toHaveText('#общий')
	await expect(mention).toHaveCSS('background-color', 'rgba(88, 101, 242, 0.3)')
	await editor.focus()
	const copied = await editor.evaluate(element => {
		const range = document.createRange(); range.selectNodeContents(element)
		window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
		const clipboardData = new DataTransfer()
		element.dispatchEvent(new ClipboardEvent('copy', { clipboardData, bubbles: true, cancelable: true }))
		return clipboardData.getData('text/plain')
	})
	expect(copied).toBe(`Начало ${channel}`)
	await page.keyboard.press('End')
	await page.keyboard.press('Backspace')
	await expect(mention).toHaveCount(0)
	await page.keyboard.press('Control+z')
	await expect(mention).toHaveText('#общий')
	await page.keyboard.press('End')
	await page.keyboard.type(' #общ')
	await page.getByRole('option', { name: '#общий' }).click()
	await expect(mention).toHaveCount(2)
	await page.getByRole('tab', { name: 'Просмотр' }).click()
	await expect(page.getByLabel('Предпросмотр сообщения в Discord').locator('.discord-mention')).toHaveText(['#общий', '#общий'])
	await page.getByRole('button', { name: 'Сохранить шаблон' }).click()
	await expect.poll(() => requests.find(r => r.path === 'templates')?.body?.values?.['promotion.document']).toBe(`Начало ${channel} ${channel} `)
})

test('section text uses channel mention styling and preserves its ID', async ({ page }) => {
	const channel = '<#1570143084304539740>'
	const requests = await setup(page, 'templates', `<section buttonLabel="Открыть" buttonLink="https://example.com">${channel}</section>`)
	await page.route('**/api/resources', route => route.fulfill({ json: { roles: [], channels: [{ id: '1570143084304539740', name: 'общий', type: 0 }] } }))
	await page.reload()
	await page.getByRole('button', { name: 'Редактировать: Секция:' }).click()
	const editor = page.getByRole('textbox', { name: 'Текст секции' })
	await expect(editor.locator('.discord-mention')).toHaveText('#общий')
	await editor.focus(); await page.keyboard.press('End'); await page.keyboard.type(' текст')
	await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
	await page.getByRole('button', { name: 'Сохранить шаблон' }).click()
	await expect.poll(() => requests.find(r => r.path === 'templates')?.body?.values?.['promotion.document']).toContain(`${channel} текст</section>`)
})

test('link dialog cancel, edit and undo preserve Markdown source', async ({ page }) => {
	const requests = await setup(page, 'templates')
	const chip = page.getByRole('button', { name: 'Редактировать: Ссылка: ссылка' })
	await chip.click()
	await page.getByLabel('Адрес ссылки').fill('https://changed.example')
	await page.getByRole('button', { name: 'Отмена' }).click()
	await chip.click()
	await expect(page.getByLabel('Адрес ссылки')).toHaveValue('https://example.com')
	await page.getByLabel('Адрес ссылки').fill('https://changed.example')
	await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
	const editor = page.getByRole('textbox', { name: 'Текст сообщения' })
	await editor.focus()
	await page.keyboard.press('Control+z')
	await chip.click()
	await expect(page.getByLabel('Адрес ссылки')).toHaveValue('https://example.com')
	await page.getByRole('button', { name: 'Отмена' }).click()
	await editor.focus()
	await page.keyboard.press('Control+y')
	await page.getByRole('button', { name: 'Сохранить шаблон' }).click()
	await expect.poll(() => requests.find(r => r.path === 'templates')?.body?.values?.['promotion.document']).toBe('Начало [ссылка](https://changed.example) конец')
})

test('typing and Cyrillic undo keep visible caret and toolbar stable', async ({ page }) => {
	const source = Array.from({ length: 120 }, (_, i) => `Строка ${i} содержимое`).join('\n')
	await setup(page, 'templates', source)
	const editor = page.getByRole('textbox', { name: 'Текст сообщения' })
	await editor.evaluate(element => {
		const node = element.firstChild!, range = document.createRange(), selection = window.getSelection()!
		range.setStart(node, node.textContent!.indexOf('Строка 60')); range.collapse(true)
		selection.removeAllRanges(); selection.addRange(range)
		element.focus({ preventScroll: true })
		const rect = range.getBoundingClientRect(); window.scrollBy(0, rect.top - window.innerHeight / 2)
	})
	await expect(page.getByRole('toolbar', { name: 'Форматирование Markdown' })).toBeInViewport()
	const scroll = await page.evaluate(() => window.scrollY)
	await page.keyboard.type('abc')
	expect(Math.abs(await page.evaluate(() => window.scrollY) - scroll)).toBeLessThan(3)
	await page.keyboard.press('Enter')
	await editor.dispatchEvent('keydown', { key: 'я', code: 'KeyZ', ctrlKey: true, bubbles: true })
	await expect(editor).toContainText('abcСтрока 60')
	await editor.dispatchEvent('keydown', { key: 'я', code: 'KeyZ', ctrlKey: true, bubbles: true })
	await expect(editor).toContainText('abСтрока 60')
})

test('image and section dialogs keep independent fields and source when edited or deleted', async ({ page }) => {
	const requests = await setup(page, 'templates', 'Текст')
	if (await page.getByRole('button', { name: 'Инструменты форматирования' }).isVisible()) await page.getByRole('button', { name: 'Инструменты форматирования' }).click()
	const editor = page.getByRole('textbox', { name: 'Текст сообщения' })
	await editor.click(); await page.keyboard.press('End')
	await page.getByRole('button', { name: 'Изображение', exact: true }).click()
	await page.getByLabel('Ссылка на изображение').fill('https://example.com/one.png')
	await page.getByRole('button', { name: 'Добавить', exact: true }).click()
	await page.getByRole('button', { name: 'Редактировать: Изображение' }).click()
	await page.getByLabel('Ссылка на изображение').fill('https://example.com/two.png')
	await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
	await page.getByRole('button', { name: 'Секция с кнопкой справа' }).click()
	await page.getByLabel('Текст секции').fill('Тело секции')
	await page.getByLabel('Название кнопки').fill('Кнопка')
	await page.getByLabel('Ссылка кнопки').fill('https://example.com/go')
	await page.getByRole('button', { name: 'Добавить', exact: true }).click()
	await page.getByRole('button', { name: 'Редактировать: Изображение' }).click()
	await expect(page.getByLabel('Ссылка на изображение')).toHaveValue('https://example.com/two.png')
	await page.getByRole('button', { name: 'Удалить', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Редактировать: Изображение' })).toHaveCount(0)
	await page.getByRole('button', { name: /Редактировать: Секция/ }).click()
	await expect(page.getByLabel('Текст секции')).toHaveText('Тело секции')
	await expect(page.getByLabel('Название кнопки')).toHaveValue('Кнопка')
	await expect(page.getByLabel('Ссылка кнопки')).toHaveValue('https://example.com/go')
	await page.getByRole('button', { name: 'Отмена' }).click()
	await page.getByRole('button', { name: 'Изображение', exact: true }).click()
	await page.getByLabel('Ссылка на изображение').fill('https://example.com/two.png')
	await page.getByRole('button', { name: 'Добавить', exact: true }).click()
	await page.getByRole('button', { name: 'Сохранить шаблон' }).click()
	await expect.poll(() => requests.find(r => r.path === 'templates')?.body?.values?.['promotion.document']).toContain('Тело секции')
	const saved: string = requests.find(r => r.path === 'templates')!.body.values['promotion.document']
	expect(saved).toContain('<img'); expect(saved).toContain('https://example.com/two.png'); expect(saved).toContain('Кнопка'); expect(saved).toContain('https://example.com/go')
})

test('multiple access roles are sent for captures', async ({ page }) => {
	const captures = await setup(page, 'captures')
	await page.getByRole('combobox', { name: 'Роль доступа к команде' }).fill('Вторая')
	await page.getByRole('option', { name: 'Вторая', exact: true }).click()
	await page.getByRole('button', { name: 'Сохранить сборы' }).click()
	await expect.poll(() => captures.find(r => r.path === 'capture-presets' && r.body)?.body.presets[0].accessRoleId).toBe('one,two')
})

test('role curators configure managed roles, persist after reload and can be removed', async ({ page }) => {
	const requests = await setup(page, 'curators')
	await expect(page.getByRole('link', { name: 'Списки', exact: true })).toHaveCount(0)
	await page.getByRole('combobox', { name: 'Доступные для управления роли' }).fill('Вторая')
	await page.getByRole('option', { name: 'Вторая', exact: true }).click()
	await page.getByRole('button', { name: 'Сохранить кураторов' }).click()
	await expect.poll(() => requests.find(r => r.path === 'role-curators' && r.body)?.body.curators).toEqual([{ roleId: 'one', managedRoleIds: ['one', 'two'] }])
	await page.reload()
	await expect(page.getByRole('button', { name: /^Убрать роль / })).toHaveCount(2)
	await page.getByRole('button', { name: 'Добавить куратора' }).click()
	await page.getByRole('combobox', { name: 'Роль куратора', exact: true }).nth(1).selectOption('two')
	await page.getByRole('combobox', { name: 'Доступные для управления роли' }).nth(1).fill('Первая')
	await page.getByRole('option', { name: 'Первая', exact: true }).click()
	await page.getByRole('button', { name: 'Сохранить кураторов' }).click()
	await expect.poll(() => requests.filter(r => r.path === 'role-curators' && r.body).at(-1)?.body.curators).toHaveLength(2)
	await page.getByRole('button', { name: 'Удалить куратора', exact: true }).nth(1).click()
	await page.getByRole('button', { name: 'Удалить', exact: true }).click()
	await page.getByRole('button', { name: 'Сохранить кураторов' }).click()
	await expect.poll(() => requests.filter(r => r.path === 'role-curators' && r.body).at(-1)?.body.curators).toHaveLength(1)
})


test('appearance follows system, persists choices and keeps Discord colors', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'light' })
	await setup(page, 'templates')
	const theme = page.getByRole('group', { name: 'Тема оформления' })
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
	await page.emulateMedia({ colorScheme: 'dark' })
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
	await theme.getByRole('radio', { name: 'Светлая', exact: true }).check()
	await page.reload()
	await expect(theme.getByRole('radio', { name: 'Светлая', exact: true })).toBeChecked()
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
	await page.getByRole('tab', { name: 'Просмотр', exact: true }).click()
	await expect(page.locator('.discord-preview')).toHaveCSS('background-color', 'rgb(49, 51, 56)')
	await theme.getByRole('radio', { name: 'Тёмная', exact: true }).check()
	await expect(page.locator('.discord-preview')).toHaveCSS('background-color', 'rgb(49, 51, 56)')
	await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0c0d16')
	await theme.getByRole('radio', { name: 'Системная', exact: true }).check()
	await page.emulateMedia({ colorScheme: 'light' })
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('effects persist and respect reduced motion and touch', async ({ page }, testInfo) => {
	await setup(page, 'settings')
	const effects = page.getByRole('button', { name: 'Декоративные эффекты' })
	const toggle = () => testInfo.project.name === 'mobile' ? effects.tap() : effects.click()
	await toggle()
	await page.reload()
	await expect(effects).toHaveAttribute('aria-pressed', 'false')
	await expect(page.locator('html')).toHaveAttribute('data-effects', 'off')
	await toggle()
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await expect(page.locator('html')).toHaveAttribute('data-effects', 'off')
	await page.emulateMedia({ reducedMotion: 'no-preference' })
	await expect(page.locator('html')).toHaveAttribute('data-effects', testInfo.project.name === 'mobile' ? 'off' : 'on')
	if (testInfo.project.name === 'desktop') {
		await page.mouse.move(650, 300)
		await expect(page.locator('html')).toHaveAttribute('data-cursor', 'on')
		await toggle()
		await expect(page.locator('html')).toHaveAttribute('data-cursor', 'off')
		await expect.poll(() => page.locator('html').evaluate(el => el.style.getPropertyValue('--drift-x'))).toBe('')
	}
})

test('appearance works with unavailable storage and on login', async ({ page }, testInfo) => {
	await page.addInitScript(() => {
		Storage.prototype.getItem = () => { throw new Error('Unavailable') }
		Storage.prototype.setItem = () => { throw new Error('Unavailable') }
	})
	await page.emulateMedia({ colorScheme: 'light' })
	await page.route('**/api/session', route => route.fulfill({ status: 401, json: { error: 'Войди' } }))
	await page.goto('/')
	await expect(page.getByRole('link', { name: 'Войти через Discord' })).toBeVisible()
	await page.screenshot({ path: `output/dashboard-review/redesign/${testInfo.project.name}-light-login.png`, fullPage: true, animations: 'disabled' })
	await page.getByRole('radio', { name: 'Тёмная', exact: true }).check()
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
	await page.getByRole('button', { name: 'Декоративные эффекты' }).click()
	await expect(page.locator('html')).toHaveAttribute('data-effects', 'off')
	await page.screenshot({ path: `output/dashboard-review/redesign/${testInfo.project.name}-dark-login.png`, fullPage: true, animations: 'disabled' })
})

test('editor modes preserve draft, undo and do not send requests', async ({ page }) => {
	const requests = await setup(page, 'templates', 'Исходный текст')
	const editor = page.getByRole('textbox', { name: 'Текст сообщения', exact: true })
	await editor.focus(); await page.keyboard.press('End'); await page.keyboard.type(' новый')
	const draft = await editor.innerText()
	await page.getByRole('tab', { name: 'Просмотр', exact: true }).click()
	await expect(editor).toBeHidden()
	await expect(page.getByLabel('Предпросмотр сообщения в Discord')).toContainText(draft)
	await page.getByRole('tab', { name: 'Редактирование', exact: true }).click()
	await expect(page.getByLabel('Предпросмотр сообщения в Discord')).toHaveCount(0)
	await expect(editor).toHaveText(draft)
	await editor.focus(); await page.keyboard.press('Control+z')
	await expect(editor).not.toHaveText(draft)
	await page.keyboard.press('Control+Shift+z')
	await expect(editor).toHaveText(draft)
	expect(requests.filter(request => request.body)).toHaveLength(0)
})

test('mobile navigation traps focus, closes on Escape and follows links', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'mobile')
	await setup(page, 'settings')
	const open = page.getByRole('button', { name: 'Открыть меню' })
	await open.click()
	await expect(page.getByRole('link', { name: 'Настройки', exact: true })).toBeFocused()
	await page.keyboard.press('Escape')
	await expect(open).toBeFocused()
	await open.click()
	const close = page.locator('.sidebar-close')
	await close.focus(); await page.keyboard.press('Shift+Tab')
	await expect(page.getByRole('button', { name: 'Выйти из аккаунта' })).toBeFocused()
	await page.getByRole('link', { name: 'Шаблоны', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Шаблоны сообщений', exact: true })).toBeVisible()
	await expect(page.locator('.sidebar')).not.toHaveClass(/sidebar-open/)
})

test('all sections fit both themes and capture review images', async ({ page }, testInfo) => {
	test.setTimeout(60000)
	const errors: string[] = []
	page.on('pageerror', error => errors.push(error.message))
	await setup(page, 'templates', 'Текст сообщения')
	await page.route('**/api/overview', route => route.fulfill({ json: { ready: true, ping: 42, database: true, uptime: 3600, history: [] } }))
	await page.route('**/api/history', route => route.fulfill({ json: [] }))
	await page.route('**/api/majestic', route => route.fulfill({ json: { configured: true, busy: false, decisions: {}, rankRoles: {}, preview: null, run: null } }))
	for (const theme of ['light', 'dark']) {
		await page.getByRole('radio', { name: theme === 'light' ? 'Светлая' : 'Тёмная', exact: true }).check()
		for (const section of ['overview', 'templates', 'variables', 'captures', 'curators', 'access', 'majestic', 'settings', 'history']) {
			await page.goto('/#' + section)
			await expect(page.locator(`.sidebar nav a[href="#${section}"]`)).toHaveAttribute('aria-current', 'page')
			await expect(page.locator('.page-heading h1')).toBeVisible()
			await page.waitForLoadState('networkidle')
			await page.locator('.page-view:not([hidden])').evaluate(async el => {
				await Promise.all(el.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
			})
			await expect(page.locator('.page-view:not([hidden])')).toHaveCSS('opacity', '1')
			await page.evaluate(() => scrollTo(0, 0))
			if (section === 'templates') {
				const actions = await page.locator('.editor-footer').boundingBox()
				const editor = await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).boundingBox()
				expect(actions!.y + actions!.height).toBeLessThanOrEqual(editor!.y)
			}
			await expect(page.getByRole('dialog')).toHaveCount(0)
			await expect(page.locator('body')).toHaveCSS('color', theme === 'light' ? 'rgb(37, 40, 61)' : 'rgb(243, 242, 250)')
			await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
			await page.screenshot({ path: `output/dashboard-review/redesign/${testInfo.project.name}-${theme}-${section}.png`, fullPage: true, animations: 'disabled' })
		}
		await page.goto('/#templates')
		await page.getByRole('button', { name: 'Восстановить исходный шаблон' }).click()
		await expect(page.getByRole('dialog')).toBeVisible()
		await page.screenshot({ path: `output/dashboard-review/redesign/${testInfo.project.name}-${theme}-dialog.png`, fullPage: true, animations: 'disabled' })
		await page.getByRole('button', { name: 'Отмена', exact: true }).click()
	}
	expect(errors).toEqual([])
})


test('save conflict keeps draft and retry cannot submit twice', async ({ page }) => {
	await setup(page, 'templates', 'Исходный текст')
	const editor = page.getByRole('textbox', { name: 'Текст сообщения', exact: true })
	await editor.fill('Мой черновик')
	await page.route('**/api/templates', route => route.fulfill({ status: 409, json: { error: 'Версия изменилась. Обнови данные.' } }))
	await page.getByRole('button', { name: 'Сохранить шаблон', exact: true }).click()
	await expect(page.getByRole('dialog')).toContainText('Версия изменилась')
	await page.getByRole('button', { name: 'Понятно', exact: true }).click()
	await expect(editor).toHaveText('Мой черновик')
	let count = 0
	let release!: () => void
	const pending = new Promise<void>(resolve => { release = resolve })
	await page.route('**/api/templates', async route => {
		count++
		await pending
		await route.fulfill({ status: 500, json: { error: 'Повтори сохранение' } })
	})
	const save = page.getByRole('button', { name: 'Сохранить шаблон', exact: true })
	await save.click()
	await expect(save).toBeDisabled()
	expect(count).toBe(1)
	release()
	await expect(page.getByRole('dialog')).toContainText('Повтори сохранение')
	await page.getByRole('button', { name: 'Понятно', exact: true }).click()
	await expect(editor).toHaveText('Мой черновик')
})


test('invalid variable key shows an inline error and preserves input', async ({ page }) => {
	const requests = await setup(page, 'templates')
	await page.getByRole('button', { name: 'Добавить переменную' }).click()
	const key = page.getByRole('textbox', { name: 'Ключ', exact: true })
	await key.fill('123 неверный')
	await page.getByRole('button', { name: 'Сохранить переменные', exact: true }).click()
	await expect(key).toHaveAttribute('aria-invalid', 'true')
	await expect(key).toHaveValue('123 неверный')
	await expect(page.getByText('Ключ: до 64 букв, цифр, дефисов и подчёркиваний; начинается с буквы.')).toBeVisible()
	expect(requests.filter(request => request.path === 'template-variables')).toHaveLength(0)
	await key.fill('правильный-ключ')
	await expect(key).toHaveAttribute('aria-invalid', 'false')
})


test('cursor produces a visible perspective tilt and resets it', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop')
	await setup(page, 'overview')
	const card = page.locator('.metric').first()
	await expect(card).toBeVisible()
	const bounds = await card.boundingBox()
	await page.mouse.move(bounds!.x + bounds!.width * .85, bounds!.y + bounds!.height * .8)
	await expect(card).toHaveClass(/is-lit/)
	await expect.poll(() => card.evaluate(el => Math.abs(parseFloat(el.style.getPropertyValue('--tilt-y'))))).toBeGreaterThan(1)
	await expect.poll(() => card.evaluate(el => Math.abs(parseFloat(el.style.getPropertyValue('--tilt-y'))))).toBeLessThanOrEqual(4)
	await expect(card).toHaveCSS('transform', /matrix3d/)
	await page.screenshot({ path: `output/dashboard-review/motion/${testInfo.project.name}-perspective.png` })
	for (const [dx, dy] of [[6, 6], [bounds!.width - 6, 6], [bounds!.width - 6, bounds!.height - 6], [6, bounds!.height - 6]]) {
		for (let step = 0; step < 3; step++) await page.mouse.move(bounds!.x + dx + step, bounds!.y + dy)
		await expect(card).toHaveClass(/is-lit/)
		await expect.poll(() => card.evaluate(el => Math.abs(parseFloat(el.style.getPropertyValue('--tilt-y'))))).toBeLessThanOrEqual(4)
	}
	await page.mouse.move(900, 35)
	await expect(card).not.toHaveClass(/is-lit/)
	await expect.poll(() => card.evaluate(el => el.style.getPropertyValue('--tilt-y'))).toBe('')
	await page.getByRole('button', { name: 'Декоративные эффекты' }).click()
	await page.mouse.move(bounds!.x + bounds!.width * .8, bounds!.y + bounds!.height * .8)
	await expect(card).not.toHaveClass(/is-lit/)
	await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
})

test('glass panels track light without moving the editor', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop')
	await setup(page, 'templates')
	const panel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Содержимое сообщения', exact: true }) })
	await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).hover({ position: { x: 180, y: 100 } })
	await expect(panel).toHaveClass(/is-lit/)
	await expect.poll(() => panel.evaluate(el => parseFloat(el.style.getPropertyValue('--light-x')))).toBeGreaterThan(0)
	await expect(panel).toHaveCSS('backdrop-filter', /blur/)
	await expect(panel).toHaveCSS('transform', 'none')
	await expect.poll(() => panel.evaluate(el => getComputedStyle(el, '::before').opacity)).toBe('1')
})

test('settings category hover scales the container with its heading', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop')
	await setup(page, 'settings')
	const panel = page.locator('.page-view:not([hidden]) details.panel').first()
	await panel.locator('summary').hover()
	await expect(panel).toHaveCSS('scale', '1.008')
	await expect(panel.locator('summary')).toHaveCSS('scale', 'none')
})

test('smooth scrolling is progressive and stops with reduced motion', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop')
	await setup(page, 'templates', Array.from({ length: 120 }, (_, i) => `Строка ${i}`).join('\n'))
	await expect(page.locator('html')).toHaveClass(/lenis/)
	await page.evaluate(() => {
		;(window as any).__scrollPositions = []
		;(window as any).__recordScroll = () => (window as any).__scrollPositions.push(scrollY)
		window.addEventListener('scroll', (window as any).__recordScroll)
	})
	const editor = await page.getByRole('textbox', { name: 'Текст сообщения', exact: true }).boundingBox()
	await page.mouse.move(editor!.x + editor!.width / 2, editor!.y + 24)
	await page.mouse.wheel(0, 700)
	await expect.poll(() => page.evaluate(() => new Set((window as any).__scrollPositions as number[]).size)).toBeGreaterThan(4)
	const positions = await page.evaluate(() => { window.removeEventListener('scroll', (window as any).__recordScroll); return (window as any).__scrollPositions as number[] })
	expect(positions.at(-1)!).toBeGreaterThan(positions[0])
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await expect(page.locator('html')).not.toHaveClass(/lenis/)
	await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
})

test('page and editor transitions preserve drafts and respect motion preference', async ({ page }) => {
	await setup(page, 'templates')
	const editor = page.getByRole('textbox', { name: 'Текст сообщения', exact: true })
	await editor.fill('Сохранённый в памяти черновик')
	await page.evaluate(() => { location.hash = 'settings' })
	await expect(page.locator('.page-view:not([hidden])')).toHaveCSS('animation-name', 'panel-enter')
	await page.evaluate(() => { location.hash = 'templates' })
	await expect(editor).toHaveText('Сохранённый в памяти черновик')
	await page.getByRole('tab', { name: 'Просмотр', exact: true }).click()
	await expect(page.getByRole('tabpanel')).toHaveCSS('animation-name', 'panel-enter')
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await expect(page.getByRole('tabpanel')).toHaveCSS('animation-name', 'none')
	await page.getByRole('tab', { name: 'Редактирование', exact: true }).click()
	await expect(editor).toHaveText('Сохранённый в памяти черновик')
})

test('custom role picker supports search, keyboard, chips and explicit save', async ({ page }) => {
	const requests = await setup(page, 'curators')
	const picker = page.getByRole('combobox', { name: 'Доступные для управления роли' })
	await picker.fill('Вторая')
	await expect(page.getByRole('option', { name: 'Вторая', exact: true })).toBeVisible()
	await picker.press('Escape')
	await expect(picker).toHaveAttribute('aria-expanded', 'false')
	await picker.press('ArrowDown'); await picker.press('Enter')
	await expect(page.getByRole('button', { name: 'Убрать роль Вторая', exact: true })).toBeVisible()
	expect(requests.filter(request => request.path === 'role-curators' && request.body)).toHaveLength(0)
	await page.getByRole('button', { name: 'Убрать роль Вторая', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Убрать роль Вторая', exact: true })).toHaveCount(0)
	await picker.fill('Нет такой роли')
	await expect(page.getByText('Роли не найдены', { exact: true })).toBeVisible()
	await picker.press('Escape')
})


test('glass transmits the scene and actually blurs the backdrop', async ({ page }) => {
	await setup(page, 'templates')
	const panel = page.locator('.panel').filter({ has: page.getByRole('heading', { name: 'Содержимое сообщения', exact: true }) })
	for (const theme of ['Тёмная', 'Светлая']) {
		await page.getByRole('radio', { name: theme, exact: true }).check()
		const alpha = await panel.evaluate(el => { const color = getComputedStyle(el).backgroundColor; return color.startsWith('rgba') ? Number(color.match(/([.\d]+)\)$/)?.[1]) : 1 })
		if (theme === 'Тёмная') { expect(alpha).toBeGreaterThan(.35); expect(alpha).toBeLessThan(.65) }
		else expect(alpha).toBeLessThan(.25)
		await page.locator('.ambient-scene').evaluate(el => {
			el.style.backgroundImage = 'repeating-linear-gradient(90deg, #21324f 0 12px, #b6c0d8 12px 24px)'
			for (const child of Array.from(el.children)) (child as HTMLElement).style.visibility = 'hidden'
		})
		const frosted = await panel.screenshot({ animations: 'disabled' })
		await panel.evaluate(el => { el.style.backdropFilter = 'none' })
		const clear = await panel.screenshot({ animations: 'disabled' })
		expect(frosted.equals(clear)).toBe(false)
		await panel.evaluate(el => { el.style.removeProperty('backdrop-filter') })
	}
})

test('glass reflections follow the pointer while its aura stays subtle', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop')
	await setup(page, 'templates')
	const editor = page.getByRole('textbox', { name: 'Текст сообщения', exact: true })
	const panel = page.locator('.panel').filter({ has: editor })
	await editor.scrollIntoViewIfNeeded()
	await page.evaluate(() => new Promise(requestAnimationFrame))
	await editor.hover({ position: { x: 50, y: 100 } })
	await expect(panel).toHaveClass(/is-lit/)
	const editorBounds = await editor.boundingBox()
	const panelBounds = await panel.boundingBox()
	const target = editorBounds!.x + 50 - panelBounds!.x
	await page.mouse.move(editorBounds!.x + 50, editorBounds!.y + 100)
	await expect.poll(() => panel.evaluate((el, expected) => Math.abs(parseFloat(el.style.getPropertyValue('--light-x')) - expected), target)).toBeLessThan(2)
	await expect.poll(() => panel.evaluate(el => parseFloat(el.style.getPropertyValue('--light-angle')))).toBeGreaterThan(0)
	const angle = await panel.evaluate(el => parseFloat(el.style.getPropertyValue('--light-angle')))
	await page.mouse.move(editorBounds!.x + 300, editorBounds!.y + 100)
	await expect.poll(() => panel.evaluate(el => parseFloat(el.style.getPropertyValue('--light-angle')))).toBeGreaterThan(angle + 2)
	await expect(panel).toHaveCSS('transform', 'none')
	await expect.poll(() => page.locator('.cursor-aura').evaluate(el => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0)
	const opacity = await page.locator('.cursor-aura').evaluate(el => Number(getComputedStyle(el).opacity))
	expect(opacity).toBeLessThanOrEqual(.2)
	await page.getByRole('button', { name: 'Декоративные эффекты' }).click()
	await expect(panel).not.toHaveClass(/is-lit/)
	await expect.poll(() => panel.evaluate(el => el.style.getPropertyValue('--light-angle'))).toBe('')
})


test('theme bootstrap works under production CSP before the app loads', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem('revento-theme', 'dark')
		;(window as any).__cspViolations = []
		document.addEventListener('securitypolicyviolation', event => (window as any).__cspViolations.push(event.blockedURI))
	})
	let release!: () => void
	const gate = new Promise<void>(resolve => { release = resolve })
	await page.route(/\/dashboard\/assets\/.*\.js$/, async route => { await gate; await route.continue() })
	try {
		await page.goto('/', { waitUntil: 'commit' })
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
		expect(await page.evaluate(() => (window as any).__cspViolations)).toEqual([])
	} finally { release() }
})

test('a real mouse enables effects when primary pointer media reports touch', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop')
	await page.addInitScript(() => {
		const original = window.matchMedia.bind(window)
		window.matchMedia = query => {
			const result = original(query)
			if (query.includes('pointer: fine') || query.includes('hover: hover')) Object.defineProperty(result, 'matches', { value: false })
			return result
		}
	})
	await setup(page, 'overview')
	const card = page.locator('.metric').first()
	await card.scrollIntoViewIfNeeded()
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
	await card.hover({ position: { x: 35, y: 40 } })
	await expect(card).toHaveClass(/is-lit/)
	await expect(page.locator('html')).toHaveAttribute('data-effects', 'on')
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await card.hover({ position: { x: 70, y: 60 } })
	await expect(card).not.toHaveClass(/is-lit/)
})

test('effects do not keep rendering or changing root styles while idle', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop')
	await page.addInitScript(() => {
		;(window as any).__motionFrames = 0
		;(window as any).__rootStyleWrites = 0
		new MutationObserver(records => { (window as any).__rootStyleWrites += records.filter(record => record.target === document.documentElement).length }).observe(document, { subtree: true, attributes: true, attributeFilter: ['style'] })
		const original = window.requestAnimationFrame.bind(window)
		window.requestAnimationFrame = callback => original(time => { (window as any).__motionFrames++; callback(time) })
	})
	await setup(page, 'overview')
	await page.mouse.move(900, 35)
	await page.waitForTimeout(1500)
	const client = page.context().browser()?.browserType().name() === 'chromium' ? await page.context().newCDPSession(page) : null
	await client?.send('Performance.enable')
	const beforeCpu = client ? (await client.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'TaskDuration')!.value : 0
	const before = await page.evaluate(() => ({ frames: (window as any).__motionFrames as number, rootWrites: (window as any).__rootStyleWrites as number }))
	await page.waitForTimeout(1000)
	const after = await page.evaluate(() => ({ frames: (window as any).__motionFrames as number, rootWrites: (window as any).__rootStyleWrites as number }))
	const taskMs = client ? ((await client.send('Performance.getMetrics')).metrics.find(metric => metric.name === 'TaskDuration')!.value - beforeCpu) * 1000 : null
	console.log(JSON.stringify({ idleFrames: after.frames - before.frames, idleRootStyleWrites: after.rootWrites - before.rootWrites, idleTaskMs: taskMs === null ? null : Math.round(taskMs) }))
	expect(after.frames - before.frames).toBeLessThanOrEqual(1)
	expect(after.rootWrites - before.rootWrites).toBe(0)
	expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity).length)).toBe(0)
	await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
	await expect(page.locator('html')).toHaveAttribute('data-motion', 'off')
	await expect(page.locator('html')).not.toHaveClass(/lenis/)

})


test('pointer paints stay local and are capped at 30 Hz', async ({ page }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop')
	await setup(page, 'overview')
	const sample = await page.locator('.metric').first().evaluate(async card => {
		const rect = card.getBoundingClientRect()
		const original = CSSStyleDeclaration.prototype.setProperty
		let paints = 0, rootWrites = 0
		const observer = new MutationObserver(records => { rootWrites += records.length })
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
		CSSStyleDeclaration.prototype.setProperty = function(property, value, priority) {
			if (this === card.style && property === '--light-x') paints++
			return original.call(this, property, value, priority)
		}
		const start = performance.now()
		try {
			await new Promise<void>(resolve => {
				let frame = 0
				const move = () => {
					card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', clientX: rect.left + 20 + frame, clientY: rect.top + 30 }))
					if (++frame === 30) resolve(); else requestAnimationFrame(move)
				}
				requestAnimationFrame(move)
			})
			return { paints, rootWrites, duration: performance.now() - start }
		} finally { CSSStyleDeclaration.prototype.setProperty = original; observer.disconnect() }
	})
	expect(sample.paints).toBeGreaterThan(0)
	expect(sample.paints).toBeLessThanOrEqual(Math.ceil(sample.duration * 30 / 1000) + 1)
	expect(sample.rootWrites).toBe(0)
})


test('dashboard shortcuts, compact tools and centered saving work', async ({ page }, testInfo) => {
	await setup(page, 'overview')
	await expect(page.getByRole('heading', { name: 'Центр управления', exact: true })).toBeVisible()
	await page.keyboard.down('Alt')
	await expect(page.locator('.nav-shortcut').first()).toHaveCSS('opacity', '1')
	await page.keyboard.press('Digit2')
	await page.keyboard.up('Alt')
	await expect(page.getByRole('heading', { name: 'Шаблоны сообщений', exact: true })).toBeVisible()
	if (testInfo.project.name === 'mobile') await expect(page.getByRole('button', { name: 'Изображение', exact: true })).toBeHidden()
	else await expect(page.getByRole('button', { name: 'Инструменты форматирования' })).toBeHidden()
	if (await page.getByRole('button', { name: 'Инструменты форматирования' }).isVisible()) await page.getByRole('button', { name: 'Инструменты форматирования' }).click()
	await expect(page.getByRole('button', { name: 'Изображение', exact: true })).toBeVisible()
	await page.keyboard.press('Alt+KeyQ')
	await expect(page.getByRole('tab', { name: 'Просмотр', exact: true })).toHaveAttribute('aria-selected', 'true')
	await expect(page.locator('.editor-footer button')).toHaveCount(1)
	const button = await page.getByRole('button', { name: 'Сохранить шаблон' }).boundingBox()
	const workspace = await page.locator('.page-view:not([hidden]) .editor-workspace').boundingBox()
	expect(Math.abs(button!.x + button!.width / 2 - workspace!.x - workspace!.width / 2)).toBeLessThan(2)
	await page.keyboard.press('Alt+KeyQ')
	await expect(page.getByRole('textbox', { name: 'Текст сообщения' })).toBeVisible()
})

test('scroll controls return early and textarea grows without manual resize', async ({ page }, testInfo) => {
	await setup(page, 'templates', Array.from({ length: 100 }, (_, i) => `Строка ${i}`).join('\n'), { 'Система повышения': { price: '100' } })
	await page.evaluate(() => window.scrollTo({ top: 900, behavior: 'instant' }))
	await expect(page.getByRole('button', { name: 'Наверх', exact: true })).toBeVisible()
	await expect(page.locator('.topbar')).not.toHaveClass(/topbar-visible/)
	await page.evaluate(() => window.scrollBy({ top: -80, behavior: 'instant' }))
	await expect(page.locator('.topbar')).toHaveClass(/topbar-visible/)
	await page.screenshot({ path: `output/dashboard-review/${testInfo.project.name}-compact-editor.png` })
	await page.getByRole('button', { name: 'Наверх', exact: true }).click()
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(5)
	await page.keyboard.press('Alt+Digit3')
	await expect(page.getByRole('heading', { name: 'Переменные шаблонов', exact: true })).toBeVisible()
	const textarea = page.locator('.page-view:not([hidden])').getByLabel('Значение', { exact: true })
	await textarea.fill(Array.from({ length: 15 }, () => 'Длинное значение').join('\n'))
	await expect(textarea).toHaveCSS('resize', 'none')
	await expect(textarea).toHaveCSS('box-shadow', 'none')
	await expect(textarea).toHaveCSS('outline-width', '1px')
	expect(await textarea.evaluate(el => el.clientHeight >= el.scrollHeight)).toBe(true)
	await page.screenshot({ path: `output/dashboard-review/${testInfo.project.name}-variables.png` })
})

test('tooltips stay inside viewport and logout does not overflow', async ({ page }, testInfo) => {
	await setup(page, 'overview')
	if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: 'Открыть меню', exact: true }).click()
	const logout = page.getByRole('button', { name: 'Выйти из аккаунта', exact: true })
	await logout.hover()
	await expect(page.getByRole('tooltip', { name: 'Выйти из аккаунта' })).toBeVisible()
	const tooltip = await page.getByRole('tooltip', { name: 'Выйти из аккаунта' }).boundingBox()
	const viewport = page.viewportSize()!
	expect(tooltip!.x).toBeGreaterThanOrEqual(0)
	expect(tooltip!.x + tooltip!.width).toBeLessThanOrEqual(viewport.width)
	expect(tooltip!.y + tooltip!.height).toBeLessThanOrEqual(viewport.height)
	expect(await page.locator('.sidebar').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
})


test('saving joins the sticky toolbar only while editing', async ({ page }, testInfo) => {
	const requests = await setup(page, 'templates', Array.from({ length: 140 }, (_, i) => `Строка ${i}`).join('\n'))
	await page.getByRole('radio', { name: 'Тёмная', exact: true }).check()
	const toolbar = page.getByRole('toolbar', { name: 'Форматирование Markdown' })
	const save = page.getByRole('button', { name: 'Сохранить шаблон', exact: true })
	const home = page.locator('.page-view:not([hidden]) .editor-save-home')
	await expect(home.getByRole('button', { name: 'Сохранить шаблон' })).toBeVisible()
	if (testInfo.project.name === 'desktop') {
		await expect(toolbar.getByRole('button', { name: 'Изображение', exact: true })).toBeVisible()
		await expect(toolbar.getByRole('button', { name: 'Инструменты форматирования' })).toBeHidden()
	}
	await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'instant' }))
	await expect(toolbar.getByRole('button', { name: 'Сохранить шаблон' })).toBeVisible()
	await expect(save).toHaveCount(1)
	await expect(toolbar).toHaveCSS('border-radius', '0px')
	await expect.poll(async () => (await toolbar.boundingBox())!.y).toBeLessThan(2)
	await page.screenshot({ path: `output/dashboard-review/${testInfo.project.name}-joined-toolbar.png` })
	await page.evaluate(() => window.scrollBy({ top: -80, behavior: 'instant' }))
	await expect(page.locator('.topbar')).toHaveClass(/topbar-visible/)
	await expect.poll(async () => (await toolbar.boundingBox())!.y).toBeGreaterThanOrEqual(71)
	await page.keyboard.press('Alt+KeyQ')
	await expect(page.getByRole('tab', { name: 'Просмотр', exact: true })).toHaveAttribute('aria-selected', 'true')
	await expect(home.getByRole('button', { name: 'Сохранить шаблон' })).toBeVisible()
	const button = await save.boundingBox(), workspace = await page.locator('.page-view:not([hidden]) .editor-workspace').boundingBox()
	expect(Math.abs(button!.x + button!.width / 2 - workspace!.x - workspace!.width / 2)).toBeLessThan(2)
	await page.screenshot({ path: `output/dashboard-review/${testInfo.project.name}-preview-save.png` })
	await page.keyboard.press('Alt+KeyQ')
	await expect(toolbar.getByRole('button', { name: 'Сохранить шаблон' })).toBeVisible()
	await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
	await expect(home.getByRole('button', { name: 'Сохранить шаблон' })).toBeVisible()
	const editor = page.getByRole('textbox', { name: 'Текст сообщения', exact: true })
	await editor.focus()
	await page.keyboard.press('Control+Home')
	await page.keyboard.type('Правка ')
	await page.evaluate(() => window.scrollTo({ top: 1000, behavior: 'instant' }))
	await expect(toolbar.getByRole('button', { name: 'Сохранить шаблон' })).toBeVisible()
	await save.click()
	await expect.poll(() => requests.find(request => request.path === 'templates')?.body?.values?.['promotion.document']).toContain('Правка ')
})
