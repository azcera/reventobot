import { test, expect, type Page } from '@playwright/test'

async function setup(page: Page, hash: string, source = 'Начало [ссылка](https://example.com) конец') {
	const config = { revision: 3, bindings: {}, templateVariables: {}, templates: [{ key: 'promotion.document', group: 'Система повышения', label: 'Текст', type: 'text', components: true, maxLength: 16000, value: source, variables: [] }], settings: [{ key: 'INVITE_CATEGORY_ID', label: 'Категория заявок', type: 'channel', channelTypes: [4], value: '' }, { key: 'MAJESTIC_AUTO_KICK', label: 'Автоматическое исключение', type: 'boolean', value: true }] }
	const preset = { id: '12345678-1234-1234-1234-123456789012', command: 'test', target: 'Сбор', channelId: 'parent', accessRoleId: 'one', maxMain: 10 }
	const list = { id: preset.id, title: 'Список', channelId: 'parent', roleId: 'one', accessRoleId: 'one', addName: 'Добавить', removeName: 'Убрать' }
	const requests: { path: string; body: any }[] = []
	await page.route('**/api/**', async route => {
		const path = new URL(route.request().url()).pathname.slice(5)
		const body = route.request().postDataJSON()
		requests.push({ path, body })
		if (path === 'settings' && body?.values) {
			for (const field of config.settings) if (Object.hasOwn(body.values, field.key)) field.value = body.values[field.key]
			config.revision++
		}
		const data: Record<string, unknown> = { session: { csrf: 'test', guild: { id: 'g', name: 'Guild' }, user: { id: 'u', name: 'User' } }, config, resources: { roles: [{ id: 'one', name: 'Первая' }, { id: 'two', name: 'Вторая' }], channels: [{ id: 'parent', name: 'общий', type: 0, canSend: true }] }, 'capture-presets': { revision: 3, presets: body?.presets || [preset] }, 'mcl-lists': { revision: 3, lists: body?.lists || [list] }, 'channel-threads/parent': [{ id: 'thread', name: 'Ветка', type: 11 }], 'permanent-message/publish': config, templates: config, 'template-variables': { ...config, revision: 4, templateVariables: { 'Система повышения': body?.values } } }
		await route.fulfill({ json: path === 'settings' ? config : data[path] ?? {} })
	})
	await page.goto('/#' + hash)
	await expect(page.getByRole('heading', { name: ({ settings: 'Настройки', variables: 'Переменные шаблонов', templates: 'Шаблоны сообщений', captures: 'Управление сборами', mcl: 'Списки' } as Record<string, string>)[hash], exact: true })).toBeVisible()
	return requests
}

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
	const requests = await setup(page, 'variables')
	await page.getByRole('button', { name: 'Добавить переменную' }).click()
	await page.getByLabel('Имя переменной 1').fill('name')
	await page.getByLabel('Значение name').fill('Alice')
	await page.getByRole('button', { name: 'Сохранить переменные' }).click()
	await expect.poll(() => requests.find(r => r.path === 'template-variables')?.body).toEqual({ group: 'Система повышения', values: { name: 'Alice' }, revision: 3 })
	await expect(page.getByText('Переменные сохранены. Публикации обновлены.')).toBeVisible()
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
	await expect(page.getByLabel('Текст секции')).toHaveValue('Тело секции')
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

test('multiple access roles are sent for captures and lists', async ({ page }) => {
	const captures = await setup(page, 'captures')
	await page.getByRole('combobox', { name: 'Роль доступа к команде' }).selectOption('two')
	await page.getByRole('button', { name: 'Сохранить сборы' }).click()
	await expect.poll(() => captures.find(r => r.path === 'capture-presets' && r.body)?.body.presets[0].accessRoleId).toBe('one,two')
	await page.goto('/#mcl')
	await page.getByRole('combobox', { name: 'Дополнительная роль доступа' }).selectOption('two')
	await page.getByRole('button', { name: 'Сохранить и опубликовать' }).click()
	await expect.poll(() => captures.find(r => r.path === 'mcl-lists' && r.body)?.body.lists[0].accessRoleId).toBe('one,two')
})
