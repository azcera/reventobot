import { browserScript } from './helpers/browserScript'
import type { TemplateField } from '../frontend/src/types'
import type { RawComponent } from '../src/types'
type StoredField = TemplateField & { path: string }
type SyncResult = { kind: string; ok: boolean }
import { moduleStub } from './helpers/moduleStub'
export {}
import { test } from 'node:test'
import assert = require('node:assert/strict')
import { readFileSync } from 'node:fs'
import vm = require('node:vm')
const { store, createStore }: typeof import("../src/dashboard/store") = require('../src/dashboard/store')
const { createFixture } = require('./helpers/dashboardFixture')
const { rememberSent }: typeof import("../src/dashboard/permanentMessages") = require('../src/dashboard/permanentMessages')
const { buildWebContainer }: typeof import("../src/services/containerService") = require('../src/services/containerService')

const databasePath = require.resolve('../src/services/database')
require.cache[databasePath] = moduleStub({ id: databasePath, filename: databasePath, loaded: true, exports: { query: async () => ({ rows: [] }) } })

test('imported permanent message fields persist and saving or resetting templates edits Discord in place', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const original = structuredClone(f.message.components)
	let response = await f.request('/api/permanent-message', { body: { kind: 'recruit', link: f.message.url, revision: 0 } })
	assert.equal(response.status, 200)
	let config = await response.json()
	const field = config.templates.find((field: StoredField) => field.group === 'Памятка рекрута' && field.path.endsWith('.content'))
	assert.ok(field)
	const restarted = createStore(); await restarted.init(f.pool)
	assert.equal(restarted.bindings.recruit.link, f.message.url)
	assert.equal(restarted.text(field.key), field.value)
	response = await f.request('/api/templates', { body: { revision: config.revision, values: { [field.key]: '# Новая памятка\n**Важно** <@&444444444444444444>' } } })
	config = await response.json()
	assert.equal(response.status, 200); assert.deepEqual(config.syncResults.map(({ kind, ok }: SyncResult) => ({ kind, ok })), [{ kind: 'recruit', ok: true }])
	assert.equal(f.message.components[0].components[0].content, '# Новая памятка\n**Важно** <@&444444444444444444>')
	assert.deepEqual(f.message.components[0].components.slice(1), original[0].components.slice(1))
	assert.equal(f.message.attachments.size, 1)
	assert.deepEqual(f.message.lastPayload.allowedMentions, { parse: ['roles'], repliedUser: false })
	response = await f.request('/api/templates', { body: { revision: config.revision, values: { [field.key]: null } } })
	assert.equal(response.status, 200)
	assert.equal(f.message.components[0].components[0].content, field.default)
})

test('Discord failures preserve saved templates and can be retried without a new revision', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	let config = await (await f.request('/api/permanent-message', { body: { kind: 'promotion', link: f.message.url, revision: 0 } })).json()
	const field = config.templates.find((field: TemplateField) => field.group === 'Система повышения')
	const edit = f.message.edit
	f.message.edit = async () => { throw new Error('unavailable') }
	config = await (await f.request('/api/templates', { body: { revision: config.revision, values: { [field.key]: '## Новые условия' } } })).json()
	assert.equal(config.syncResults[0].ok, false); assert.equal(store.text(field.key), '## Новые условия')
	const revision = config.revision
	f.message.edit = edit
	config = await (await f.request('/api/permanent-message/sync', { body: { kind: 'promotion' } })).json()
	assert.equal(config.syncResults[0].ok, true); assert.equal(config.revision, revision)
	assert.equal(f.message.components[0].components[0].content, '## Новые условия')
	// A changed component structure requires an explicit rebind instead of moving text to another block.
	f.message.components[0].components.unshift({ type: 14, divider: true })
	config = await (await f.request('/api/permanent-message/sync', { body: { kind: 'promotion' } })).json()
	assert.equal(config.syncResults[0].ok, false)
	assert.match(config.syncResults[0].error, /Структура/)
})

test('rules and invite sync reuse command builders, images and working buttons', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	for (const kind of ['rules', 'invite']) {
		await store.init(f.pool)
		f.message.attachments.set(kind, { id: kind, name: kind === 'rules' ? 'rules.png' : 'invites.png', url: 'https://cdn.example.com/' + kind + '.png' })
		f.message.attachments.set('revento', { id: 'revento', name: 'revento.png', url: 'https://cdn.example.com/revento.png' })
		const bindings = store.bindings
		for (const other of Object.keys(bindings)) await store.save('bindings', { [other]: null }, store.revision, 'admin')
		let config = await (await f.request('/api/permanent-message', { body: { kind, link: f.message.url, revision: store.revision } })).json()
		const key = kind === 'rules' ? 'rules.heading.1' : 'invite.4'
		const value = (kind === 'rules' ? '## Новые правила' : 'Новая заявка') + ' <@&444444444444444444>'
		config = await (await f.request('/api/templates', { body: { revision: config.revision, values: { [key]: value } } })).json()
		assert.deepEqual(config.syncResults.map(({ kind, ok }: SyncResult) => ({ kind, ok })), [{ kind, ok: true }])
		assert.ok(JSON.stringify(f.message.components).includes(value))
		assert.deepEqual(f.message.lastPayload.allowedMentions, { parse: ['roles'], repliedUser: false })
		assert.equal(f.message.components[0].accent_color, null)
		assert.equal(f.message.lastPayload.files, undefined)
		if (kind === 'invite') {
			assert.equal(f.message.components[0].components.at(-1).accessory.custom_id, 'open_invite_modal')
			assert.ok(config.templates.some((field: TemplateField) => field.key === 'invite.document'))
		}
	}
})

test('rules sync uses only images specified in the document', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	await f.request('/api/permanent-message', { body: { kind: 'rules', link: f.message.url, revision: store.revision } })
	const command: typeof import("../src/commands/admin/rules") = require('../src/commands/admin/rules')
	f.message.attachments.set('rules', { name: 'rules.png', url: 'https://cdn.example.com/rules.png' })
	for (const [source, expected] of [
		['## Новые правила', ''],
		['<img src="attachment://rules.png" />\n\n## Правила с баннером', 'attachment://rules.png'],
		['<img src="https://example.com/custom.png" />\n\n## Свой баннер', 'https://example.com/custom.png']
	]) {
		const response = await f.request('/api/templates', { body: { revision: store.revision, values: { 'rules.document': source } } })
		assert.equal(response.status, 200)
		assert.equal((await response.json()).syncResults[0].ok, true)
		const media = (components: RawComponent[]): string[] => components.flatMap(component => [...(component.items || []).map(item => item.media.url), ...media(component.components || [])])
		assert.deepEqual(media(f.message.components), expected ? [expected === 'attachment://rules.png' ? 'https://cdn.example.com/rules.png' : expected] : [])
		assert.deepEqual(media((await command.buildPayload()).components.map((component: { toJSON(): RawComponent }) => component.toJSON())), expected ? [expected] : [])
		assert.equal(f.message.lastPayload.files, undefined)
	}
})

test('binding rejects wrong guild, author, duplicate, stale revision and dynamic messages', async t => {
	const f = await createFixture(); t.after(() => f.close()); await f.login()
	const bind = (body: Record<string, unknown>) => f.request('/api/permanent-message', { body: { kind: 'recruit', revision: store.revision, link: f.message.url, ...body } })
	assert.equal((await bind({ link: f.message.url.replace(f.guild.id, '999999999999999999') })).status, 403)
	f.message.author.id = 'other'; assert.equal((await bind({})).status, 403); f.message.author.id = 'bot'
	f.pool.dynamic.add(f.message.id); assert.equal((await bind({})).status, 409); f.pool.dynamic.clear()
	assert.equal((await bind({})).status, 200)
	assert.equal((await bind({ kind: 'promotion' })).status, 400)
	assert.equal((await bind({ revision: 0 })).status, 409)
	assert.equal((await bind({ link: '' })).status, 200)
	assert.equal(store.bindings.recruit, undefined)
	assert.equal(store.snapshot().templates.find((field: TemplateField) => field.key === 'recruit.document')!.value, '# Памятка рекрута')
})

test('new singleton command publications are remembered only in the configured guild', async t => {
	const f = await createFixture(); t.after(() => f.close())
	const previous = process.env.GUILD_ID; t.after(() => { if (previous === undefined) delete process.env.GUILD_ID; else process.env.GUILD_ID = previous })
	process.env.GUILD_ID = f.guild.id
	f.message.guildId = 'other'; await rememberSent('invite', f.message); assert.equal(store.bindings.invite, undefined)
	f.message.guildId = f.guild.id; await rememberSent('invite', f.message); const remembered = store.bindings; assert.equal(remembered.invite.link, f.message.url)
})

test('rules preview includes only images in the document', async () => {
	const { previewFields } = await import('../frontend/src/lib/templates.js')
	const parser: typeof import("../public/component-markdown") = require('../public/component-markdown')
	const config = { revision: 0, settings: [], bindings: {}, syncResults: [], templates: [{ key: 'rules.1', value: 'attachment://rules.png', type: 'text', group: 'Правила', label: 'Баннер' }] }
	for (const value of ['## Правила', '<img src="attachment://rules.png" />\n\n## Правила']) {
		const fields = previewFields(config, 'Правила', [{ key: 'rules.document', group: 'Правила', label: 'Правила', type: 'text', value }], {}, parser)
		const images = fields.flatMap(field => parser.parse(field.value)).filter((item: { type: string }) => item.type === 'image')
		assert.equal(images.length, value.includes('<img') ? 1 : 0)
		if (images.length) assert.equal(images[0].value, 'attachment://rules.png')
	}
})


test('shared preview renders Markdown safely, and dashboard controls cannot add container color', () => {
	const context = vm.createContext({})
	vm.runInContext(readFileSync(browserScript('markdown'), 'utf8'), context)
	const html = context.discordMarkdownToHtml('# Заголовок\n**Жирный** и __подчёркнутый__\n<img src=x onerror=alert(1)>')
	assert.match(html, /<h1>Заголовок<\/h1>/); assert.match(html, /<strong>Жирный<\/strong>/)
	assert.match(html, /<u>подчёркнутый<\/u>/); assert.doesNotMatch(html, /<img/)
	const payload = buildWebContainer({ accentColor: '#ff0000', noColor: false, items: [{ type: 'text', value: 'Текст' }] })
	assert.equal(payload.components[0].toJSON().accent_color ?? null, null)
	assert.equal(store.snapshot().templates.some((field: TemplateField) => field.type === 'color'), false)
	assert.equal(store.snapshot().settings.some(field => field.type === 'color'), false)
})
