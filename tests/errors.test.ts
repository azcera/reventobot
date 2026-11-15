import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getError } from '../src/utils/errors'

test('native timeout and abort errors retain their read-only code', () => {
	for (const name of ['TimeoutError', 'AbortError']) {
		const error = new DOMException('Request interrupted', name)
		assert.equal(getError(error), error)
		assert.equal(getError(error).name, name)
	}
})

test('existing errors are preserved without rewriting diagnostic fields', () => {
	const error = Object.freeze(Object.assign(new Error('Connection reset'), {
		code: 'ECONNRESET', status: 502, data: { retry_after: 5 }
	}))
	assert.equal(getError(error), error)
})

test('plain thrown objects retain supported diagnostic fields', () => {
	const error = getError({ code: 'ECONNRESET', status: 502, data: { retry_after: 5, other: 'ignored' } })
	assert.ok(error instanceof Error)
	assert.equal(error.code, 'ECONNRESET')
	assert.equal(error.status, 502)
	assert.deepEqual(error.data, { retry_after: 5, opcode: undefined })
})
