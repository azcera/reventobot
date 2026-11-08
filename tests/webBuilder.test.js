const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createStore } = require('../src/dashboard/store')

test('React template field model preserves full documents, order and isolated group drafts', async () => {
	const { editorFields, fieldValues, changedValues, dirtyGroup } = await import('../frontend/src/lib/templates.mjs')
	const config = createStore().snapshot()
	for (const group of new Set(config.templates.map(field => field.group))) {
		const fields = editorFields(config, group)
		assert.ok(fields.length, group)
		for (const field of fields.filter(field => field.type === 'text')) assert.doesNotMatch(field.value, /^###### /m)
	}
	assert.deepEqual(editorFields(config, 'Приглашение').map(field => field.key), ['invite.document', 'invite.3', 'invite.4'])
	const rules = editorFields(config, 'Правила')
	assert.deepEqual(rules.map(field => field.key), ['rules.document'])
	const drafts = { 'Правила': { ...fieldValues(rules), 'rules.document': '## Несохранённые правила' } }
	assert.equal(dirtyGroup(config, drafts, 'Правила'), true)
	assert.equal(dirtyGroup(config, drafts, 'Заявка'), false)
	assert.deepEqual(changedValues(rules, drafts['Правила']), { 'rules.document': '## Несохранённые правила' })
})

test('Majestic selection excludes non-changes and stale previews regardless of visible filters', async () => {
	const { applicableSelection, visibleRows, previewIssue } = await import('../frontend/src/lib/majestic.mjs')
	const state = { decisions: { conflict: { static: '987654' } }, preview: { id: 'preview', generatedAt: Date.now(), rows: [
		{ discordId: 'user', currentNickname: '<script> | 1', nickname: 'Maya | 1', static: '1', status: 'change' },
		{ discordId: 'conflict', currentNickname: 'Other | 2', status: 'conflict' }
	] } }
	assert.deepEqual(applicableSelection(state, new Set(['user', 'conflict', 'missing'])), ['user'])
	for (const query of [' SCRIPT ', 'mAyA', 'user', '1', '987654']) assert.equal(visibleRows(state, query, 'issues').length, 1)
	assert.equal(visibleRows(state, 'Maya', 'conflict').length, 0)
	assert.equal(visibleRows(state, '', 'all').length, 2)
	state.preview.invalidated = true
	assert.deepEqual(applicableSelection(state, new Set(['user'])), [])
	assert.match(previewIssue(state), /использован/)
	state.preview.invalidated = false; state.preview.generatedAt = Date.now() - 16 * 60 * 1000
	assert.deepEqual(applicableSelection(state, new Set(['user'])), [])
	assert.match(previewIssue(state), /15 минут/)
})
