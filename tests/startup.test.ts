import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { gzipSync } from 'node:zlib'

test('startup serves 503 until required dependencies are ready and exits on initialization failure', { timeout: 10000 }, async t => {
	const fixture = `
		require('dotenv').config = () => ({ parsed: {} })
		const pool = require('./dist/src/services/database')
		pool.initDb = () => new Promise((_, reject) => process.once('message', () => reject(new Error('fixture DDL failure'))))
		const discord = require('discord.js')
		discord.Client.prototype.login = () => { process.send('unexpected-login'); return Promise.resolve() }
		const express = require('express')
		const listen = express.application.listen
		express.application.listen = function(port, callback) {
			const server = listen.call(this, port, '127.0.0.1', callback)
			server.once('listening', () => process.send(server.address().port))
			return server
		}
		require('./dist/index')
	`
	const child = fork('', [], {
		execArgv: ['-e', fixture], stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
		env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TOKEN: 'fixture', GUILD_ID: 'fixture', PORT: '0' }
	})
	t.after(() => { if (child.exitCode === null) child.kill() })
	const messages: unknown[] = []
	child.on('message', message => messages.push(message))
	const [port] = await once(child, 'message')
	assert.equal(typeof port, 'number')
	const origin = 'http://127.0.0.1:' + port
	assert.equal((await fetch(origin + '/readyz')).status, 503)
	const compressed = gzipSync(JSON.stringify({ example: true }))
	assert.equal((await fetch(origin + '/api/send-container', {
		method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
		body: new Uint8Array(compressed)
	})).status, 415)
	const exit = once(child, 'exit')
	child.send('fail')
	assert.deepEqual(await exit, [1, null])
	assert.deepEqual(messages, [port])
})

test('an uncaught exception exits the process with a failing code', { timeout: 10000 }, async t => {
	const fixture = `
		require('dotenv').config = () => ({ parsed: {} })
		require('./dist/src/services/database').initDb = () => new Promise(() => {})
		require('./dist/index')
		setImmediate(() => { throw new Error('fixture uncaught error') })
	`
	const child = fork('', [], {
		execArgv: ['-e', fixture], stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
		env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TOKEN: 'fixture', GUILD_ID: 'fixture', PORT: '0' }
	})
	t.after(() => { if (child.exitCode === null) child.kill() })
	let stderr = ''
	child.stderr?.on('data', data => { stderr += data })
	assert.deepEqual(await once(child, 'exit'), [1, null])
	assert.match(stderr, /\[Uncaught exception\] Error: fixture uncaught error/)
})
