import type { Config, Resources, Drafts, Setter, PageServices } from '../types'
import React, { useState } from 'react'
import { ArrowUpRight, Link, Pencil, RefreshCw, RotateCcw, Save, Send, Unlink } from 'lucide-react'
import { Button, Field, IconButton, Panel, useModal } from '../components/ui'
import { EditorWorkspace, MarkdownEditor } from '../components/Editor'
import { TemplatePreview } from '../components/DiscordPreview'
import { changedValues, dirtyGroup, editorFields, fieldValues, permanentGroups, replaceExamples, syncNotice } from '../lib/templates'

function BindingEditor({ kind, config, resources, onPublish, onBind, onSync }: { kind: string; config: Config; resources: Resources; onPublish(channel: string): void; onBind(link: string, remove?: boolean): void; onSync(): void }) {
	const [channel, setChannel] = useState(config.bindings?.[kind]?.link.split('/')[5] || '')
	const [link, setLink] = useState(config.bindings?.[kind]?.link || '')
	const channels = resources.channels.filter(channel => [0, 5].includes(channel.type) && channel.canSend)
	return <div className="mt-5 grid gap-5">
		<p className="text-sm text-muted">В том же канале бот обновит привязанное сообщение. При смене канала прежняя копия останется без дальнейшей синхронизации.</p>
		<form className="grid gap-3" noValidate onSubmit={event => { event.preventDefault(); onPublish(channel) }}><Field label="Канал публикации"><select value={channel} onChange={event => setChannel(event.target.value)} required><option value="">Выбери канал</option>{channels.map(item => <option key={item.id} value={item.id}># {item.name}</option>)}</select></Field><Button type="submit" icon={Send}>Опубликовать / обновить</Button></form>
		<div className="border-t border-line pt-5"><form className="grid gap-3" noValidate onSubmit={event => { event.preventDefault(); onBind(link.trim()) }}><Field label="Ссылка на существующее сообщение" hint="Укажи сообщение этого бота на настроенном сервере."><input type="url" value={link} onChange={event => setLink(event.target.value)} placeholder="https://discord.com/channels/…/…/…" required /></Field><div className="flex flex-wrap gap-2"><Button type="submit" icon={Link}>Привязать</Button>{config.bindings?.[kind] && <IconButton icon={Unlink} label="Удалить привязку" onClick={() => onBind('', true)} />}</div></form></div>
		{config.bindings?.[kind] && <div className="flex flex-wrap gap-2"><a className="button button-secondary" href={config.bindings[kind].link} target="_blank" rel="noopener noreferrer"><ArrowUpRight aria-hidden="true" />Открыть в Discord</a><Button icon={RefreshCw} onClick={onSync}>Повторить обновление</Button></div>}
	</div>
}

export function Templates({ config, setConfig, resources, drafts, setDrafts, api, run, notify }: PageServices & { config: Config; setConfig: Setter<Config | null>; resources: Resources; drafts: Drafts; setDrafts: Setter<Drafts> }) {
	const groups = [...new Set(config.templates.map(field => field.group))]
	const [selectedGroup, setSelectedGroup] = useState(groups[0])
	const [generation, setGeneration] = useState(0)
	const modal = useModal()
	const group = groups.includes(selectedGroup) ? selectedGroup : groups[0]
	const fields = editorFields(config, group)
	const values = { ...fieldValues(fields), ...drafts[group] }
	const kind = Object.keys(permanentGroups).find(key => permanentGroups[key] === group)
	const binding = kind ? config.bindings?.[kind] : undefined
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
		modal({ title: `${group} · постоянное сообщение`, content: ({ close }) => <BindingEditor kind={kind} config={config} resources={resources}
			onPublish={channel => { close(); publish(channel) }} onBind={(link, remove) => { close(); bind(link, remove) }} onSync={() => { close(); run(async () => result(await api('permanent-message/sync', { kind }), 'Сообщение обновлено.')) }} /> })
	}
	async function save(event: React.SyntheticEvent) {
		event.preventDefault()
		const changes = changedValues(fields, values)
		if (!Object.keys(changes).length) return notify('Нет изменений для сохранения.')
		run(async () => { const next = await api('templates', { revision: config.revision, values: changes }); clearDraft(group); result(next, 'Шаблон сохранён. Привязанные сообщения обновлены.') })
	}
	async function reset() {
		if (!await modal({ title: 'Восстановить исходный шаблон?', message: `Все изменения раздела «${group}» будут сброшены. Привязанные сообщения обновятся в Discord.`, confirm: 'Восстановить', danger: true })) return
		run(async () => { const next = await api('templates', { revision: config.revision, values: Object.fromEntries(config.templates.filter(field => field.group === group).map(field => [field.key, null])) }); clearDraft(group); result(next, 'Исходный шаблон восстановлен.') })
	}
	const footer = <div className="editor-footer"><span className="text-xs text-muted" aria-live="polite">{dirtyGroup(config, drafts, group) ? 'Есть несохранённые изменения' : 'Сохранённая версия'}</span><div className="flex gap-2"><IconButton icon={RotateCcw} label="Восстановить исходный шаблон" onClick={reset} /><Button variant="primary" icon={Save} onClick={save}>Сохранить шаблон</Button></div></div>
	return <div className="grid gap-6">
		<div className="flex flex-wrap items-center justify-between gap-4"><Field label="Раздел шаблона" className="w-full sm:w-72"><select value={group} onChange={event => setSelectedGroup(event.target.value)}>{groups.map(name => <option key={name}>{name}</option>)}</select></Field><span className="eyebrow">СООБЩЕНИЯ / ШАБЛОНЫ</span></div>
		{kind && <div className="binding-strip"><div className="binding-icon"><Link aria-hidden="true" /></div><div className="min-w-0 flex-1"><h2 className="text-sm font-medium">Постоянное сообщение</h2><p className="mt-1 text-xs text-muted">{binding ? 'Обновляется в Discord при сохранении шаблона' : 'Выбери канал или привяжи существующую публикацию'}</p></div>{binding && <span className="badge hidden sm:inline-flex"># {bindingChannel?.name || 'Канал привязан'}</span>}<IconButton icon={Pencil} label="Настроить постоянное сообщение" onClick={openBinding} /></div>}
		<EditorWorkspace resetKey={group + generation} footer={footer} renderPreview={() => {
			for (const field of fields) if (field.type === 'text' && field.components !== false) window.componentMarkdown.parse(replaceExamples(values[field.key]))
			return <TemplatePreview key={group + generation} config={structuredClone(config)} group={group} fields={structuredClone(fields)} values={{ ...values }} channel={bindingChannel?.name || 'предпросмотр'} />
		}}>
			<Panel title="Содержимое сообщения" action={<span className="text-xs text-muted">Markdown</span>}>
				<form onSubmit={save} noValidate>
					<div className="grid gap-6 p-5 sm:p-6">{fields.map(field => <Field key={field.key} label={field.label || 'Текст сообщения'} hint={field.variables?.length ? 'Сохрани переменные: ' + field.variables.map(name => '{' + name + '}').join(', ') : undefined}>
						{field.type === 'text' ? <MarkdownEditor key={field.key + generation} value={values[field.key]} maxLength={field.maxLength || 16000} components={field.components !== false} resources={resources} onChange={value => setDrafts(previous => ({ ...previous, [group]: { ...values, [field.key]: value } }))} />
							: <input type={field.type === 'url' && !values[field.key].startsWith('attachment://') ? 'url' : 'text'} value={values[field.key]} maxLength={field.maxLength || 16000} onChange={event => setDrafts(previous => ({ ...previous, [group]: { ...values, [field.key]: event.target.value } }))} />}
					</Field>)}</div>
				</form>
			</Panel>
		</EditorWorkspace>
		{group === 'Навигация' && <div className="binding-strip"><div className="min-w-0 flex-1"><h2 className="text-sm font-medium">Навигация в архивах</h2><p className="mt-1 text-xs text-muted">Обновление всех копий с сохранением приветствия и кнопки поиска.</p></div><IconButton icon={RefreshCw} label="Обновить навигацию во всех архивах" onClick={() => {
			if (dirtyGroup(config, drafts, group)) return notify('Сначала сохрани изменения навигации.', true)
			run(async () => { notify('Обновляется навигация в архивах…'); const next = await api('navigation/sync', {}); result(next, 'Навигация обновлена. Сообщений: ' + (next.syncResults?.[0]?.updated || 0) + '.') })
		}} /></div>}
	</div>
}
