import type { CapturePreset, Config, PageServices, Resources, Setter } from '../types'
import { errorMessage, errorStatus } from '../types'
import React, { useEffect, useState } from 'react'
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { RoleChoices } from '../components/RoleChoices'
import { SaveStatus, Button, Field, IconButton, Panel } from '../components/ui'

export function CapturePresets({ active, resources, api, run, notify, setConfig }: PageServices & { active: boolean; resources: Resources; setConfig: Setter<Config | null> }) {
	const [presets, setPresets] = useState<CapturePreset[] | null>(null)
	const [revision, setRevision] = useState(0)
	const [saved, setSaved] = useState('')
	const [failed, setFailed] = useState(false)
	const [conflict, setConflict] = useState(false)
	async function load() {
		try { const data = await api('capture-presets'); setPresets(data.presets); setSaved(JSON.stringify(data.presets)); setRevision(data.revision); setFailed(false); setConflict(false) }
		catch (error) { setFailed(true); notify(errorMessage(error), true) }
	}
	useEffect(() => { if (active && !presets && !failed) void load() }, [active, presets, failed, api])
	if (!presets) return failed ? <Button icon={RefreshCw} onClick={load}>Повторить загрузку сборов</Button> : <p className="text-sm text-muted">Загрузка сборов…</p>
	const edit = (id: string, values: Partial<CapturePreset>) => setPresets(current => current!.map(item => item.id === id ? { ...item, ...values } : item))
	async function save(event: React.FormEvent) {
		event.preventDefault()
		await run(async () => {
			try {
				const data = await api('capture-presets', { presets, revision })
				setPresets(data.presets); setSaved(JSON.stringify(data.presets)); setRevision(data.revision); setConfig(await api('config')); notify('Предустановки сохранены. Команды доступны в Discord.')
			} catch (error) {
				if (errorStatus(error) === 409) {
					setConflict(true)
					throw new Error('Настройки изменились. Черновик оставлен в форме. Загрузите актуальные сборы перед повторным редактированием.')
				}
				if (errorMessage(error).startsWith('Предустановки сохранены')) { const data = await api('capture-presets'); setRevision(data.revision); setConfig(await api('config')) }
				throw error
			}
		})
	}
	return <form className="grid gap-6" onSubmit={save}>
		{conflict && <Button icon={RefreshCw} onClick={load}>Загрузить актуальные сборы и заменить черновик</Button>}
		<div className="callout">Каждая предустановка создаёт slash-команду. При вызове нужно заполнить только дату и время по Москве в одном поле. Выбранные роли разрешают создание сбора дополнительно к администраторам и старшему составу. Без них команда доступна только модераторам. Обычная /capt сохраняет поля времени, цели и количества; автокапт работает отдельно.</div>
		{presets.map((preset, index) => <Panel key={preset.id} title={preset.target || `Сбор ${index + 1}`} action={<IconButton icon={Trash2} label={`Удалить сбор ${index + 1}`} onClick={() => setPresets(presets.filter(item => item.id !== preset.id))} />}>
			<div className="grid gap-5 p-5 sm:grid-cols-2 sm:p-6">
				<Field label="Команда" hint="Без /: строчные буквы, цифры, _ и -. Например, сбор-тренировка."><input required maxLength={32} value={preset.command} onChange={event => edit(preset.id, { command: event.target.value })} /></Field>
				<Field label="Цель сбора"><input required maxLength={100} value={preset.target} onChange={event => edit(preset.id, { target: event.target.value })} /></Field>
				<Field label="Канал публикации"><select required value={preset.channelId} onChange={event => edit(preset.id, { channelId: event.target.value })}><option value="">Выберите канал</option>{preset.channelId && !resources.channels.some(channel => channel.id === preset.channelId) && <option value={preset.channelId}>Недоступен · {preset.channelId}</option>}{resources.channels.filter(channel => channel.type === 0).map(channel => <option key={channel.id} value={channel.id}># {channel.name}</option>)}</select></Field>
				<RoleChoices label="Роль доступа к команде" value={preset.accessRoleId} roles={resources.roles} onChange={value => edit(preset.id, { accessRoleId: value })} />
				<Field label="Количество участников" hint="Лимит подтверждённых участников. Записавшиеся ожидают подтверждения модератора."><input required type="number" min={1} max={2147483647} step={1} value={preset.maxMain || ''} onChange={event => edit(preset.id, { maxMain: Number(event.target.value) })} /></Field>
			</div>
		</Panel>)}
		<div className="action-bar flex flex-wrap items-center justify-between gap-3"><SaveStatus dirty={JSON.stringify(presets) !== saved} /><Button icon={Plus} disabled={presets.length >= 20} onClick={() => setPresets([...presets, { id: crypto.randomUUID(), command: '', target: '', channelId: '', accessRoleId: '', maxMain: 20 }])}>Добавить предустановку</Button><Button type="submit" variant="primary" icon={Save} disabled={conflict}>Сохранить сборы</Button></div>
	</form>
}
