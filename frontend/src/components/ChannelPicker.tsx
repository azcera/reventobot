import { useState } from 'react'
import type { Api, ChannelResource, Notify, Resources } from '../types'
import { Button } from './ui'

export function ChannelPicker({ id, value, onChange, resources, api, notify }: { id?: string; value: string; onChange(value: string): void; resources: Resources; api: Api; notify: Notify }) {
	const [expanded, setExpanded] = useState<Record<string, boolean>>({})
	const [threads, setThreads] = useState<Record<string, ChannelResource[]>>({})
	const [loading, setLoading] = useState('')
	const channels = resources.channels.filter(channel => [0, 5, 15, 16].includes(channel.type))
	return <div id={id} className="grid max-h-80 gap-1 overflow-auto rounded-lg border border-line p-2" role="group" aria-label="Канал публикации">
		{value && !resources.channels.some(channel => channel.id === value) && <p className="p-2 text-xs">Выбран канал / ветка: {value}</p>}
		{channels.map(channel => <div key={channel.id}><div className="flex items-center gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 p-2"><input type="radio" name={id || 'publication-channel'} value={channel.id} checked={value === channel.id} disabled={!channel.canSend || [15, 16].includes(channel.type)} onChange={() => onChange(channel.id)} /><span className="truncate"># {channel.name}</span></label><Button disabled={loading === channel.id} aria-expanded={Boolean(expanded[channel.id])} onClick={async () => {
			if (expanded[channel.id]) { setExpanded(previous => ({ ...previous, [channel.id]: false })); return }
			setLoading(channel.id)
			try { const items = await api(`channel-threads/${channel.id}`); setThreads(previous => ({ ...previous, [channel.id]: items })); setExpanded(previous => ({ ...previous, [channel.id]: true })) } catch (error) { notify(error instanceof Error ? error.message : String(error), true) } finally { setLoading('') }
		}}>{loading === channel.id ? 'Загрузка…' : expanded[channel.id] ? 'Скрыть ветки' : 'Ветки'}</Button></div>
		{expanded[channel.id] && <div className="ml-6 border-l border-line pl-3">{threads[channel.id]?.length ? threads[channel.id].map(thread => <label key={thread.id} className="flex items-center gap-2 p-2"><input type="radio" name={id || 'publication-channel'} checked={value === thread.id} onChange={() => onChange(thread.id)} />{thread.name}</label>) : <p className="p-2 text-xs text-muted">Нет доступных веток</p>}</div>}</div>)}
	</div>
}
