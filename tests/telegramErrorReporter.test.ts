import assert from 'node:assert/strict'
import { test } from 'node:test'
import { installTelegramErrorReporter } from '../src/services/telegramErrorReporter'

test('groups transient connection failures across workers and preserves other alerts', async t => {
	t.mock.timers.enable({ apis: ['Date'] })
	const errorLog = t.mock.fn<Console['error']>()
	const logger = { error: errorLog }
	const sent: string[] = []
	const reporter = installTelegramErrorReporter({
		env: { TG_NOTIFICATION_BOT_TOKEN: 'token', TG_NOTIFICATION_CHAT_ID: 'chat' },
		logger,
		request: async (_url, init) => {
			sent.push(JSON.parse(String(init?.body)).text)
			return Response.json({ ok: true })
		}
	})
	logger.error('[Capture expiry]', new Error('Connection terminated due to connection timeout'))
	await reporter.flush()
	logger.error('[Telegram capture queue]', Object.assign(new Error('authentication timeout'), { code: '08006' }))
	logger.error('[Telegram broadcast] Получение команд:', { name: 'TimeoutError', pool: { idle: 0 } })
	logger.error('[Telegram broadcast] Получение команд:', { causeCode: 'ECONNRESET', pool: { idle: 2 } })
	logger.error('[AutoDelete]', Object.assign(new Error('Unknown interaction'), { code: 10062 }))
	logger.error('[CaptureResults]', new Error('Family Wars HTTP 401'))
	logger.error('[Startup]', new Error('Connection terminated unexpectedly'))
	await reporter.flush()
	assert.equal(sent.length, 4)
	assert.match(sent[1], /Telegram broadcast/)
	assert.match(sent[2], /Family Wars HTTP 401/)
	assert.match(sent[3], /Startup/)
	assert.equal(errorLog.mock.callCount(), 7)

	t.mock.timers.tick(15 * 60000)
	logger.error('[Invite channel cleanup]', new Error('timeout exceeded when trying to connect'))
	await reporter.flush()
	assert.equal(sent.length, 5)
	assert.match(sent[4], /Повторов: 2\./)
})
