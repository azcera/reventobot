import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { Board, ClientMessage, ServerMessage } from '../../shared/tactics'

test('Activity отображает общую доску, размещает фигуры и ники и включает режим просмотра', async ({ page, isMobile }) => {
	const appId = '100000000000000001'
	const categories = [{ id: randomUUID(), name: 'Капт' }, { id: randomUUID(), name: 'Другие' }]
	const map = { id: randomUUID(), name: 'Порт', width: 800, height: 600, categoryId: categories[0].id }
	const other = { ...map, id: randomUUID(), name: 'Аэропорт', categoryId: categories[1].id }
	const tactic = { id: randomUUID(), name: 'Старая тактика' }
	const board: Board = { map, epoch: 1, revision: 0, dirty: false, objects: [] }
	const players = [{ id: '100000000000000002', name: 'Тактик' }]
	const outgoing: (ClientMessage | { type: 'auth' })[] = []
	let emit: (message: ServerMessage) => void = () => {}
	await page.addInitScript(({ appId }) => {
		window.postMessage = (data: [number, { cmd?: string; nonce?: string }]) => {
			const [opcode, command] = data
			let payload: object
			if (opcode === 0) payload = {
				cmd: 'DISPATCH', evt: 'READY', nonce: null,
				data: { v: 1, config: { api_endpoint: 'discord.com', environment: 'test' } }
			}
			else if (command.cmd === 'AUTHORIZE') payload = {
				cmd: command.cmd, nonce: command.nonce, evt: null, data: { code: 'fixture-code' }
			}
			else if (command.cmd === 'AUTHENTICATE') payload = {
				cmd: command.cmd, nonce: command.nonce, evt: null,
				data: {
					access_token: 'fixture-access', user: { username: 'fixture', id: '1', discriminator: '0', public_flags: 0 },
					scopes: ['identify'], expires: '', application: { id: appId, name: 'Revento', description: '' }
				}
			}
			else return
			queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
				origin: location.origin, data: [1, payload]
			})))
		}
	}, { appId })
	await page.route('**/activity/**', async route => {
		const url = new URL(route.request().url())
		const relative = url.pathname.slice('/activity/'.length)
		if (relative === 'api/config') return route.fulfill({ json: { appId } })
		if (relative === 'api/token') return route.fulfill({ json: { accessToken: 'fixture-access' } })
		if (relative === 'api/session') {
			expect(route.request().headers().authorization).toBe('Bearer fixture-access')
			return route.fulfill({ json: { sessionToken: 'fixture-session' } })
		}
		if (relative === 'api/categories') return route.fulfill({ json: categories })
		if (relative === 'api/maps') return route.fulfill({ json: {
			maps: [map, other].filter(item => item.categoryId === url.searchParams.get('categoryId')), next: null
		} })
		if (relative.endsWith('/tactics')) return route.fulfill({ json: [tactic] })
		if (relative.endsWith('/image')) return route.fulfill({
			contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#355846"/></svg>'
		})
		if (!relative || /^assets\/[\w.-]+$/.test(relative))
			return route.fulfill({ path: path.resolve('public/activity', relative || 'index.html') })
		await route.abort()
	})
	await page.routeWebSocket('**/activity/socket', socket => {
		emit = message => socket.send(JSON.stringify(message))
		socket.onMessage(raw => {
			const message = JSON.parse(raw.toString()) as ClientMessage | { type: 'auth' }
			outgoing.push(message)
			if (message.type === 'auth') emit({ type: 'snapshot', board, players, canEdit: true,
				moderation: [{ id: players[0].id, restricted: false }] })
			if (message.type === 'player') emit({ type: 'change', epoch: board.epoch, revision: ++board.revision,
				change: { type: 'put', object: { ...message, label: players[0].name } } })
			if (message.type === 'save')
				emit({ type: 'saved', revision: board.revision, mapId: map.id, tactic: { id: randomUUID(), name: message.name } })
		})
	})
	await page.goto('/activity/?frame_id=test&instance_id=room-a&guild_id=1&channel_id=2&platform=desktop')
	await expect(page.getByText('Редактирование', { exact: true })).toBeVisible()
	const canvas = page.getByRole('img', { name: 'Порт' }).locator('..').locator('canvas')
	await expect(canvas).toBeVisible()
	const help = page.getByRole('button', { name: 'Руководство' })
	await help.click()
	const guide = page.getByRole('dialog', { name: 'Как пользоваться доской' })
	await expect(guide).toContainText('Режим «Редактирование»')
	await guide.getByRole('button', { name: 'Закрыть' }).click()
	const toggle = page.getByRole('button', { name: 'Курсоры редакторов' })
	await expect(toggle).toHaveAttribute('aria-pressed', 'false')
	emit({ type: 'cursor', epoch: 1, cursor: { id: 'remote', name: 'Редактор карты', at: [.2, .2] } })
	const cursor = page.locator('.editor-cursor').getByText('Редактор карты')
	await expect(cursor).toHaveCount(0)
	emit({ type: 'access', canEdit: true, isAdmin: true, moderation: [{ id: players[0].id, restricted: false }] })
	await expect(cursor).toBeVisible()
	emit({ type: 'cursor', epoch: 1, cursor: { id: 'remote', name: 'Редактор карты', at: [.3, .4] } })
	await expect(page.locator('.editor-cursor')).toHaveAttribute('style', 'left: 30%; top: 40%;')
	await toggle.click()
	await expect(cursor).toHaveCount(0)
	await expect(page.getByPlaceholder('Найти карту')).toHaveCount(0)
	await page.getByLabel('Категория карт').selectOption(categories[1].id)
	await expect(page.getByRole('button', { name: 'Аэропорт', exact: true })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Порт', exact: true })).toHaveCount(0)
	await page.getByLabel('Категория карт').selectOption(categories[0].id)
	if (isMobile) await page.getByRole('button', { name: 'Карты', exact: true }).click()
	await page.getByLabel('Загрузка тактики').selectOption(tactic.id)
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'load', id: tactic.id })
	const viewport = page.locator('.viewport')
	await page.getByRole('button', { name: 'Приблизить', exact: true }).click()
	await expect(page.getByText('125%')).toBeVisible()
	await viewport.hover()
	await page.mouse.wheel(0, -120)
	await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
	await expect(page.getByText('148%')).toBeVisible()
	const scrollBeforeDrag = await viewport.evaluate(element => element.scrollLeft)
	await page.mouse.down({ button: 'middle' })
	await expect(canvas).toHaveCSS('cursor', 'grabbing')
	const view = (await viewport.boundingBox())!
	await page.mouse.move(view.x + view.width / 2 + 80, view.y + view.height / 2)
	await page.mouse.up({ button: 'middle' })
	await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeLessThan(scrollBeforeDrag)
	await page.getByRole('button', { name: 'Сбросить масштаб' }).click()
	await page.getByRole('button', { name: 'Большая кисть' }).click()
	await page.getByLabel('Произвольный цвет').fill('#123abc')
	await canvas.click()
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'stroke', width: 12, color: '#123abc' })
	const viewportSize = await viewport.boundingBox()
	await page.getByRole('button', { name: 'Фигуры' }).click()
	expect(await viewport.boundingBox()).toEqual(viewportSize)
	const triangle = page.getByRole('button', { name: 'Треугольник' })
	if (isMobile) {
		await triangle.click()
		await canvas.tap()
	} else await triangle.dragTo(canvas)
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'shape', shape: 'triangle' })
	await expect(triangle).toBeVisible()
	if (isMobile) await page.getByRole('button', { name: 'Состав' }).click()
	const restrict = page.getByRole('button', { name: /Запретить рисовать.*Тактик/ })
	await restrict.click()
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'restrict', userId: players[0].id, restricted: true })
	const slider = page.getByRole('slider', { name: /Размер ников/ })
	await expect(slider).toHaveAttribute('min', '5')
	await expect(slider).toHaveAttribute('max', '20')
	await slider.fill('20')
	if (isMobile) {
		await page.getByRole('button', { name: 'Тактик', exact: true }).click()
		await canvas.tap()
	} else {
		await page.getByRole('button', { name: 'Тактик', exact: true }).dragTo(canvas)
	}
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'player', userId: players[0].id, color: '#123abc' })
	const marker = outgoing.find(message => message.type === 'player')!
	if (marker.type !== 'player') throw new Error('Ник не размещён')
	await page.getByRole('button', { name: 'Цвет #4ade80' }).click()
	const target = (await canvas.boundingBox())!
	await canvas.click({ position: { x: target.width * marker.at[0], y: target.height * marker.at[1] } })
	await expect(page.getByLabel('Произвольный цвет')).toHaveValue('#123abc')
	await page.getByRole('button', { name: 'Цвет #4ade80' }).click()
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'playerColor', id: marker.id, color: '#4ade80' })
	await page.getByRole('button', { name: 'Стрелка', exact: true }).click()
	const bounds = (await canvas.boundingBox())!
	await page.mouse.move(bounds.x + bounds.width * .35, bounds.y + bounds.height * .35)
	await page.mouse.down()
	await page.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .65, { steps: 5 })
	await page.mouse.up()
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'arrow', width: 12 })
	emit({ type: 'history', undo: true, redo: false })
	await expect(page.getByRole('button', { name: 'Отменить действие' })).toBeEnabled()
	await page.keyboard.press('Control+z')
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'undo' })
	emit({ type: 'history', undo: false, redo: true })
	await expect(page.getByRole('button', { name: 'Повторить действие' })).toBeEnabled()
	await page.keyboard.press('Control+Shift+z')
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'redo' })
	await page.getByRole('button', { name: 'Сохранить тактику' }).click()
	await page.getByLabel('Название тактики').fill('Обход')
	await page.getByRole('button', { name: 'Сохранить', exact: true }).click()
	await expect(page.getByRole('status')).toContainText('Тактика «Обход» сохранена.')
	emit({ type: 'access', canEdit: false })
	await expect(page.getByText('Просмотр', { exact: true })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Кисть', exact: true })).toHaveCount(0)
	await expect(canvas).toBeVisible()
	await help.click()
	await expect(guide).toContainText('Режим «Просмотр»')
	await expect(guide).not.toContainText('Слева доступны кисть')
})
