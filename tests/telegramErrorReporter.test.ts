export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
const { installTelegramErrorReporter }: typeof import("../src/services/telegramErrorReporter") = require('../src/services/telegramErrorReporter')
type NotificationPayload = { chat_id: string; text: string }
type TestLogger = { error(...args: unknown[]): unknown }
type RequestOptions = RequestInit

const env = { TG_NOTIFICATION_BOT_TOKEN: 'test-token', TG_NOTIFICATION_CHAT_ID: 'owner', TOKEN: 'discord-secret' }

test('forwards console errors with stack and objects to notification chat, preserving local logs and hiding secrets', async () => {
	const local: unknown[][] = [], sent: NotificationPayload[] = []
	const logger: TestLogger = { error: (...args) => local.push(args) }
	const reporter = installTelegramErrorReporter({ env, logger, request: async (url: unknown, options: RequestOptions = {}) => {
		assert.equal(url, 'https://api.telegram.org/bottest-token/sendMessage')
		assert.ok(options.signal instanceof AbortSignal)
		sent.push(JSON.parse(String(options.body)))
		return Response.json({ ok: true })
	} })
	const error = new Error('failed discord-secret test-token')
	logger.error('[Discord]', error, { code: 500 })
	await reporter.flush()
	assert.equal(local[0][1], error)
	assert.equal(sent[0].chat_id, 'owner')
	assert.match(sent[0].text, /\[Discord\].*Error: failed/)
	assert.match(sent[0].text, /telegramErrorReporter.test.js/)
	assert.match(sent[0].text, /code: 500/)
	assert.doesNotMatch(sent[0].text, /discord-secret|test-token/)
})

test('splits long errors and preserves delivery order', async () => {
	const sent: string[] = []
	const logger: TestLogger = { error() {} }
	const reporter = installTelegramErrorReporter({ env, logger, request: async (_url: unknown, options: RequestOptions = {}) => {
		sent.push(JSON.parse(String(options.body)).text)
		return Response.json({ ok: true })
	} })
	const longError = 'x'.repeat(3951) + '😀'.repeat(3000)
	logger.error(longError)
	logger.error('next error')
	await reporter.flush()
	assert.equal(sent.length, 4)
	assert.ok(sent.every(text => text.length <= 4000))
	assert.ok(sent.slice(0, 3).join('').endsWith(longError))
	assert.ok(sent.every(text => !/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(text)))
	assert.match(sent[3], /next error/)
})

test('network and API failures stay local without recursion and later errors are still delivered', async () => {
	let calls = 0
	const local: unknown[][] = []
	const logger: TestLogger = { error: (...args) => local.push(args) }
	const reporter = installTelegramErrorReporter({ env, logger, request: async () => {
		calls++
		if (calls === 1) throw new Error('network test-token')
		if (calls === 2) return new Response(null, { status: 500 })
		return Response.json({ ok: calls !== 3, error_code: 429 })
	} })
	for (let index = 0; index < 4; index++) logger.error('failure', index)
	await reporter.flush()
	assert.equal(calls, 4)
	assert.equal(local.length, 7)
	assert.ok(local.slice(4).every(args => args[0] === '[Telegram] Не удалось отправить ошибку бота'))
})

test('missing credentials leave console untouched', async () => {
	for (const config of [{}, { TG_NOTIFICATION_BOT_TOKEN: 'test-token' }, { TG_NOTIFICATION_CHAT_ID: 'owner' }]) {
		const logger = { error() {} }
		const original = logger.error
		const reporter = installTelegramErrorReporter({ env: config, logger, request: () => assert.fail('unexpected request') })
		assert.equal(logger.error, original)
		await reporter.flush()
	}
})
