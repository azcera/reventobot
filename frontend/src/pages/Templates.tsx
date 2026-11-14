import { replaceTemplateVariables } from '../../../shared/templateVariables'
import type { Config, Resources, Drafts, Setter, PageServices } from '../types'
import React, { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Link, Pencil, Plus, RefreshCw, RotateCcw, Save, Send, Trash2, Unlink } from 'lucide-react'
import { Button, Field, IconButton, Panel, useModal } from '../components/ui'
import { TemplateVariables } from './Variables'
import { ChannelPicker } from '../components/ChannelPicker'
import { EditorWorkspace, MarkdownEditor } from '../components/Editor'
import { TemplatePreview } from '../components/DiscordPreview'
import { changedValues, dirtyGroup, editorFields, fieldValues, permanentGroups, replaceExamples, syncNotice } from '../lib/templates'

function BindingEditor({ kind, config, resources, onPublish, onBind, onSync, api, notify }: { kind: string; config: Config; resources: Resources; onPublish(channel: string): void; onBind(link: string, remove?: boolean): void; onSync(): void; api: PageServices['api']; notify: PageServices['notify'] }) {
	const [channel, setChannel] = useState(config.bindings?.[kind]?.link.split('/')[5] || '')
	const [link, setLink] = useState(config.bindings?.[kind]?.link || '')
	return <div className="mt-5 grid gap-5">
		<p className="text-sm text-muted">В том же канале бот обновит привязанное сообщение. При смене канала прежняя копия останется без дальнейшей синхронизации.</p>
		<form className="grid gap-3" noValidate onSubmit={event => { event.preventDefault(); onPublish(channel) }}><Field label="Канал публикации"><ChannelPicker value={channel} onChange={setChannel} resources={resources} api={api} notify={notify} /></Field><Button type="submit" icon={Send}>Опубликовать / обновить</Button></form>
		<div className="border-t border-line pt-5"><form className="grid gap-3" noValidate onSubmit={event => { event.preventDefault(); onBind(link.trim()) }}><Field label="Ссылка на существующее сообщение" hint="Укажи сообщение этого бота на настроенном сервере."><input type="url" value={link} onChange={event => setLink(event.target.value)} placeholder="https://discord.com/channels/…/…/…" required /></Field><div className="flex flex-wrap gap-2"><Button type="submit" icon={Link}>Привязать</Button>{config.bindings?.[kind]?.link && <IconButton icon={Unlink} label="Удалить привязку" onClick={() => onBind('', true)} />}</div></form></div>
		{config.bindings?.[kind]?.link && <div className="flex flex-wrap gap-2"><a className="button button-secondary" href={config.bindings[kind].link} target="_blank" rel="noopener noreferrer"><ArrowUpRight aria-hidden="true" />Открыть в Discord</a><Button icon={RefreshCw} onClick={onSync}>Повторить обновление</Button></div>}
	</div>
}

function NewTemplate({ create }: { create(name: string): void }) {
	const [name, setName] = useState('')
	return <form className="mt-5 grid gap-4" onSubmit={event => { event.preventDefault(); create(name) }}><Field label="Название шаблона"><input value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></Field><Button type="submit" icon={Plus}>Создать шаблон</Button></form>
}

export function Templates({ config, setConfig, resources, drafts, setDrafts, api, run, notify }: PageServices & { config: Config; setConfig: Setter<Config | null>; resources: Resources; drafts: Drafts; setDrafts: Setter<Drafts> }) {
	const groups = [...new Set(config.templates.map(field => field.group))]
	const [selectedGroup, setSelectedGroup] = useState(groups[0])
	const [generation, setGeneration] = useState(0)
	const [applicationState, setApplicationState] = useState('pending')
	const variablesRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		let frame = 0
		function openTarget() {
			cancelAnimationFrame(frame)
			const [page, query] = location.hash.slice(1).split('?')
			if (page !== 'templates') return
			const params = new URLSearchParams(query), target = params.get('group')
			if (!target) return
			setSelectedGroup(target)
			if (params.get('section') === 'variables') frame = requestAnimationFrame(() => variablesRef.current?.scrollIntoView({ block: 'start' }))
		}
		openTarget()
		window.addEventListener('hashchange', openTarget)
		return () => { window.removeEventListener('hashchange', openTarget); cancelAnimationFrame(frame) }
	}, [])
	const modal = useModal()
	const group = groups.includes(selectedGroup) ? selectedGroup : groups[0]
	const fields = editorFields(config, group)
	const application = ['Заявка', 'Личные сообщения заявок'].includes(group)
	const states = application ? fields.filter(field => field.key.includes('.document.')) : []
	const state = states.find(field => field.key.endsWith('.' + applicationState)) || states[0]
	const visibleFields = application ? fields.filter(field => field === state || group === 'Заявка' && state?.key.endsWith('.pending') && field.type === 'button') : fields
	const values = { ...fieldValues(fields), ...drafts[group] }
	const kind = Object.keys(permanentGroups).find(key => permanentGroups[key] === group) || Object.keys(config.bindings).find(key => key.startsWith('custom-') && config.bindings[key].fields?.[0]?.group === group)
	const binding = kind && config.bindings?.[kind]?.link ? config.bindings[kind] : undefined
	const bindingChannel = resources.channels.find(channel => channel.id === binding?.link.split('/')[5])
	function clearDraft(target: string) { setDrafts(previous => { const next = { ...previous }; delete next[target]; return next }); setGeneration(n => n + 1) }
	function result(next: Config, message: string) { setConfig(next); const notice = syncNotice(next, message); notify(notice.message, notice.error) }
	async function publish(channelId: string) {
		if (!channelId) return notify('Выбери канал публикации.', true)
		if (dirtyGroup(config, drafts, group)) return notify('Сначала сохрани изменения шаблона.', true)
		const accepted = await modal({ title: 'Опубликовать шаблон?', message: 'Бот отправит сохранённый шаблон в выбранный канал или обновит существующее сообщение.', confirm: 'Опубликовать' })
		if (!accepted) return
		run(async () => { const next = await api('permanent-message/publish', { kind, channelId, revision: config.revision }); clearDraft(group); result(next, 'Сообщение опубликовано и привязано к шаблону.') })
	}
	async function bind(link: string, remove = false) {
		if (!link && !remove) return notify('Вставь ссылку на сообщение этого бота.', true)
		if (!link && !await modal({ title: 'Удалить привязку?', message: 'Сообщение останется в Discord, но больше не будет обновляться вместе с шаблоном.', confirm: 'Удалить привязку', danger: true })) return
		if (dirtyGroup(config, drafts, group) && !await modal({ title: 'Изменить привязку?', message: 'Несохранённые правки этого раздела будут сброшены.', confirm: 'Продолжить' })) return
		run(async () => { const next = await api('permanent-message', { kind, link, revision: config.revision }); clearDraft(group); result(next, link ? 'Привязка сохранена.' : 'Привязка удалена.') })
	}
	function openBinding() {
		if (!kind) return
		modal({ title: `${group} · постоянное сообщение`, content: ({ close }) => <BindingEditor api={api} notify={notify} kind={kind} config={config} resources={resources}
			onPublish={channel => { close(); publish(channel) }} onBind={(link, remove) => { close(); bind(link, remove) }} onSync={() => { close(); run(async () => result(await api('permanent-message/sync', { kind }), 'Сообщение обновлено.')) }} /> })
	}
	async function save(event: React.SyntheticEvent) {
		event.preventDefault()
		const changes = changedValues(fields, values)
		if (!Object.keys(changes).length) return notify('Нет изменений для сохранения.')
		run(async () => { const next = await api('templates', { revision: config.revision, values: changes }); clearDraft(group); result(next, 'Шаблон сохранён. Привязанные сообщения обновлены.') })
	}
	async function remove() {
		if (!kind?.startsWith('custom-')) return
		if (!await modal({ title: 'Удалить шаблон?', message: 'Шаблон «' + group + '» и его несохранённые правки будут удалены. Опубликованное сообщение останется в Discord, но больше не будет синхронизироваться.', confirm: 'Удалить шаблон', danger: true })) return
		run(async () => {
			const next = await api('templates/delete', { kind, revision: config.revision })
			clearDraft(group); setConfig(next); setSelectedGroup(next.templates[0]?.group || ''); notify('Шаблон удалён.')
		})
	}
	async function reset() {
		if (!await modal({ title: 'Восстановить исходный шаблон?', message: `Все изменения раздела «${group}» будут сброшены. Привязанные сообщения обновятся в Discord.`, confirm: 'Восстановить', danger: true })) return
		run(async () => { const next = await api('templates', { revision: config.revision, values: Object.fromEntries(config.templates.filter(field => field.group === group).map(field => [field.key, null])) }); clearDraft(group); result(next, 'Исходный шаблон восстановлен.') })
	}
	const footer = <div className="editor-footer"><Button variant="primary" icon={Save} onClick={save}>Сохранить шаблон</Button></div>
	return <div className="grid gap-6">
		<div className="flex flex-wrap items-center justify-between gap-4"><Field label="Раздел шаблона" className="w-full sm:w-72"><select value={group} onChange={event => setSelectedGroup(event.target.value)}>{groups.map(name => <option key={name}>{name}</option>)}</select></Field><div className="flex flex-wrap gap-2">{kind?.startsWith('custom-') && <IconButton icon={Trash2} label="Удалить шаблон" onClick={remove} />}<IconButton icon={RotateCcw} label="Восстановить исходный шаблон" onClick={reset} /><Button icon={Plus} onClick={() => modal({ title: 'Новый шаблон', hideFooter: true, content: ({ close }) => <NewTemplate create={name => { if (!name.trim()) return; close(); run(async () => { const next = await api('templates/create', { name, revision: config.revision }); setConfig(next); setSelectedGroup(name.trim()); notify('Шаблон создан. Напиши сообщение и выбери канал публикации.'); }) }} /> })}>Новый шаблон</Button></div></div>
		{kind && <div className="binding-strip"><div className="binding-icon"><Link aria-hidden="true" /></div><div className="min-w-0 flex-1"><h2 className="text-sm font-medium">Постоянное сообщение</h2><p className="mt-1 text-xs text-muted">{binding ? 'Обновляется в Discord при сохранении шаблона' : 'Выбери канал или привяжи существующую публикацию'}</p></div>{binding && <span className="badge hidden sm:inline-flex"># {bindingChannel?.name || 'Канал привязан'}</span>}<IconButton icon={Pencil} label="Настроить постоянное сообщение" onClick={openBinding} /></div>}
		<EditorWorkspace resetKey={group + generation} footer={footer} renderPreview={() => {
			for (const field of fields) if (field.type === 'text' && field.components !== false) window.componentMarkdown.parse(replaceExamples(replaceTemplateVariables(values[field.key], config.templateVariables?.[group] || {})))
			return <TemplatePreview key={group + generation} config={structuredClone(config)} group={group} fields={structuredClone(fields)} values={Object.fromEntries(Object.entries(values).map(([key, value]) => [key, replaceTemplateVariables(value, config.templateVariables?.[group] || {})]))} channel={bindingChannel?.name || 'предпросмотр'} />
		}}>
			<Panel title="Содержимое сообщения" action={<span className="text-xs text-muted">Markdown</span>}>
				<form onSubmit={save} noValidate>
					<div className="grid gap-6 p-5 sm:p-6">
						{application && <Field label="Состояние заявки"><select value={state?.key || ''} onChange={event => setApplicationState(event.target.value.split('.').at(-1)!)}>{states.map(field => <option key={field.key} value={field.key}>{field.label}</option>)}</select></Field>}
						{visibleFields.map(field => <Field key={field.key} label={field.key.endsWith('.document') || fields.length === 1 && field.type === 'text' ? 'Текст сообщения' : field.label || 'Текст сообщения'} hint={field.variables?.length ? 'Сохрани переменные: ' + field.variables.map(name => '{' + name + '}').join(', ') : undefined}>
						{field.type === 'text' ? <MarkdownEditor key={field.key + generation} value={values[field.key]} maxLength={field.maxLength || 16000} components={field.components !== false} resources={resources} onChange={value => setDrafts(previous => ({ ...previous, [group]: { ...values, [field.key]: value } }))} />
							: <input type={field.type === 'url' && !values[field.key].startsWith('attachment://') ? 'url' : 'text'} value={values[field.key]} maxLength={field.maxLength || 16000} onChange={event => setDrafts(previous => ({ ...previous, [group]: { ...values, [field.key]: event.target.value } }))} />}
					</Field>)}</div>
				</form>
			</Panel>
		</EditorWorkspace>
		<div ref={variablesRef} className="scroll-mt-6"><TemplateVariables key={group} group={group} config={config} setConfig={setConfig} api={api} run={run} notify={notify} /></div>
		{group === 'Навигация' && <div className="binding-strip"><div className="min-w-0 flex-1"><h2 className="text-sm font-medium">Навигация в архивах</h2><p className="mt-1 text-xs text-muted">Обновление всех копий с сохранением приветствия и кнопки поиска.</p></div><IconButton icon={RefreshCw} label="Обновить навигацию во всех архивах" onClick={() => {
			if (dirtyGroup(config, drafts, group)) return notify('Сначала сохрани изменения навигации.', true)
			run(async () => { notify('Обновляется навигация в архивах…'); const next = await api('navigation/sync', {}); result(next, 'Навигация обновлена. Сообщений: ' + (next.syncResults?.[0]?.updated || 0) + '.') })
		}} /></div>}
	</div>
}
