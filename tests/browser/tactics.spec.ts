import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import type { Board, ClientMessage, ServerMessage } from '../../shared/tactics'

test('Activity отображает общую доску, размещает фигуры и ники и включает режим просмотра', async ({ page, isMobile }) => {
	const appId = '100000000000000001'
	const map = { id: randomUUID(), name: 'Порт', width: 800, height: 600, archived: false }
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
		if (relative === 'api/maps') return route.fulfill({ json: { maps: [map], next: null } })
		if (relative.endsWith('/tactics')) return route.fulfill({ json: [] })
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
			const message = JSON.parse(raw.toString())
			outgoing.push(message)
			if (message.type === 'auth') emit({ type: 'snapshot', board, players, canEdit: true })
			if (message.type === 'save')
				emit({ type: 'saved', revision: board.revision, mapId: map.id, tactic: { id: randomUUID(), name: message.name } })
		})
	})
	await page.goto('/activity/?frame_id=test&instance_id=room-a&guild_id=1&channel_id=2&platform=desktop')
	await expect(page.getByText('Редактирование', { exact: true })).toBeVisible()
	const canvas = page.getByRole('img', { name: 'Порт' }).locator('..').locator('canvas')
	await expect(canvas).toBeVisible()
	if (isMobile) await page.getByRole('button', { name: 'Карты', exact: true }).click()
	await page.getByRole('button', { name: 'Большая кисть' }).click()
	await page.getByLabel('Произвольный цвет').fill('#123abc')
	await canvas.click()
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'stroke', width: 12, color: '#123abc' })
	await page.getByRole('button', { name: 'Фигуры' }).click()
	const triangle = page.getByRole('button', { name: 'Треугольник' })
	if (isMobile) {
		await triangle.click()
		await canvas.tap()
	} else await triangle.dragTo(canvas)
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'shape', shape: 'triangle' })
	await expect(triangle).toBeVisible()
	if (isMobile) {
		await page.getByRole('button', { name: 'Состав' }).click()
		await page.getByRole('button', { name: 'Тактик', exact: true }).click()
		await canvas.tap()
	} else await page.getByRole('button', { name: 'Тактик', exact: true }).dragTo(canvas)
	await expect.poll(() => outgoing.at(-1)).toMatchObject({ type: 'player', userId: players[0].id })
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
})
