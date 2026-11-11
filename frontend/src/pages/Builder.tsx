import type { Resources, PageServices, SourceMessage } from '../types'
import React, { useEffect, useId, useState } from 'react'
import { ArrowUpRight, Download, Link, Save, Send, Unlink } from 'lucide-react'
import { Button, Field, IconButton, Panel, useModal } from '../components/ui'
import { EditorWorkspace, MarkdownEditor } from '../components/Editor'
import { Components, DiscordPreview } from '../components/DiscordPreview'

function savedChannel() { try { return localStorage.getItem('reventobot_channelId') || '' } catch { return '' } }
function rememberChannel(value: string) { try { localStorage.setItem('reventobot_channelId', value) } catch { /* A blocked local store must not prevent publishing. */ } }

export function Builder({ resources, api, run, notify, onDirty }: PageServices & { resources: Resources; onDirty(value: boolean): void }) {
	const [source, setSource] = useState('')
	const [baseline, setBaseline] = useState('')
	const [channel, setChannel] = useState(savedChannel)
	const [link, setLink] = useState('')
	const [imported, setImported] = useState<SourceMessage | null>(null)
	const [generation, setGeneration] = useState(0)
	const modal = useModal()
	const id = useId()
	const channels = resources.channels.filter(item => [0, 5].includes(item.type) && item.canSend)
	useEffect(() => { onDirty(source !== baseline) }, [source, baseline, onDirty])
	async function load(event: React.FormEvent) {
		event.preventDefault()
		if (!link.trim()) return notify('Вставь ссылку на сообщение Discord.', true)
		if (source.trim() && !await modal({ title: 'Загрузить контейнер?', message: 'Содержимое редактора будет заменено загруженным сообщением.', confirm: 'Загрузить' })) return
		run(async () => {
			const data = await api('container-message?link=' + encodeURIComponent(link.trim()) as `container-message?${string}`)
			const text = window.componentMarkdown.stringify(data.items)
			setSource(text); setBaseline(text); setImported(data.source); setChannel(data.source.channelId); rememberChannel(data.source.channelId); setGeneration(n => n + 1)
			notify(data.source.canEdit ? 'Контейнер загружен. Можно сохранить оригинал или отправить копию.' : 'Сообщение другого бота или webhook. Доступна только отправка копии.')
		})
	}
	function publish(edit = false) {
		run(async () => {
			if (edit && !imported?.canEdit) throw new Error('Этот оригинал недоступен для редактирования.')
			if (!edit && !/^\d{17,20}$/.test(channel.trim())) throw new Error('Выбери текстовый канал или введи его Discord ID.')
			const items = window.componentMarkdown.parse(source)
			if (!items.length) throw new Error('Добавь хотя бы один элемент перед отправкой.')
			const result = await api(edit ? 'edit-container' : 'send-container', { channelId: channel.trim(), noColor: true, items, ...(edit ? { link: imported!.url, revision: imported!.revision } : {}) })
			if (!result.success) throw new Error(result.error || 'Не удалось отправить сообщение.')
			if (edit && 'source' in result) setImported(result.source)
			setBaseline(source); rememberChannel(channel.trim())
			notify((edit ? 'Изменения сохранены в оригинале.' : 'Сообщение опубликовано в Discord.') + (result.logError ? '\n' + result.logError : ''), Boolean(result.logError))
		})
	}
	return <div className="grid gap-6">
		<details className="import-panel"><summary><Link aria-hidden="true" />Загрузить контейнер по ссылке<span className="ml-auto text-xs text-muted">Для изменения или копирования</span></summary><form onSubmit={load} noValidate className="grid gap-3 border-t border-line p-5"><Field label="Ссылка на сообщение"><input value={link} type="url" onChange={event => setLink(event.target.value)} placeholder="https://discord.com/channels/…/…/…" /></Field><Button icon={Download} type="submit" className="justify-self-start">Загрузить</Button></form></details>
		<div className="max-w-xl"><Field label="Канал публикации" hint="Выбери из списка или вставь ID текстового канала."><input list={id + '-channels'} value={channel} placeholder="Выбери канал или вставь ID" onChange={event => { setChannel(event.target.value); rememberChannel(event.target.value) }} /></Field><datalist id={id + '-channels'}>{channels.map(item => <option key={item.id} value={item.id}># {item.name}</option>)}</datalist>{channels.find(item => item.id === channel)?.name && <p className="mt-2 text-xs text-brand"># {channels.find(item => item.id === channel)?.name}</p>}</div>
		{imported && <div className="binding-strip"><div className="min-w-0 flex-1"><h2 className="text-sm font-medium">{imported.canEdit ? 'Редактирование оригинала' : 'Копия чужого сообщения'}</h2><a className="mt-1 inline-flex items-center gap-1 text-xs text-muted hover:text-brand" href={imported.url} target="_blank" rel="noopener noreferrer">Открыть исходное сообщение<ArrowUpRight className="size-3" /></a></div><IconButton icon={Unlink} label="Отсоединить оригинал, сохранив черновик" onClick={() => { setImported(null); notify('Режим нового сообщения. Черновик сохранён.') }} /></div>}
		<EditorWorkspace resetKey={generation} renderPreview={() => {
			window.componentMarkdown.parse(source)
			return <DiscordPreview channel={channels.find(item => item.id === channel)?.name || 'предпросмотр'}><Components source={source} /></DiscordPreview>
		}} footer={<div className="flex flex-wrap items-center justify-between gap-4"><span className="text-xs text-muted">{source !== baseline ? 'Есть несохранённые изменения' : 'Предпросмотр не публикует сообщение'}</span><div className="flex flex-wrap gap-2">{imported && <Button icon={Save} disabled={!imported.canEdit} onClick={() => publish(true)}>Сохранить оригинал</Button>}<Button icon={Send} variant="primary" onClick={() => publish()}>{imported ? 'Отправить копию' : 'Опубликовать'}</Button></div></div>}>
			<Panel title="Редактор сообщения" action={<span className="text-xs text-muted">Components v2</span>}><div className="p-5 sm:p-6"><Field label="Текст сообщения"><MarkdownEditor key={generation} value={source} onChange={setSource} resources={resources} maxLength={16000} placeholder={'## Заголовок\nТекст сообщения\n\n---\n\n<img src="https://example.com/image.png" />'} /></Field></div></Panel>
		</EditorWorkspace>
	</div>
}
