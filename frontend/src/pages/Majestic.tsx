import type { MajesticState, PreviewRow, Decision, Resources, PageServices } from '../types'
import { errorMessage } from '../types'
import React, { useEffect, useRef, useState } from 'react'
import { CheckCheck, ChevronRight, Link, Pencil, RefreshCw, RotateCcw, ScanEye, Square, UserRoundCheck, UserRoundX, Users } from 'lucide-react'
import { applicableSelection, majesticLabels, previewIssue, visibleRows } from '../lib/majestic'
import { Button, Empty, Field, IconButton, Loading, Panel, useModal } from '../components/ui'

function Resolution({ row, data, resolve }: { row: PreviewRow; data: MajesticState; resolve(body: Decision): void }) {
	const decision = data.decisions?.[row.discordId]
	const [staticId, setStaticId] = useState(decision?.static || row.static || '')
	const tiers = Object.entries(data.rankRoles).filter(([rank, id]) => rank.startsWith('Tier ') && row.currentRoleIds?.includes(id))
	const [tier, setTier] = useState(decision?.tierRoleId || tiers[0]?.[1] || '')
	return <div className="mt-5 grid gap-5"><p className="text-sm text-muted">Discord ID: {row.discordId}</p>
		<form className="grid gap-3" noValidate onSubmit={event => { event.preventDefault(); resolve({ static: String(staticId).trim(), excluded: false }) }}><Field label="Static персонажа"><input inputMode="numeric" value={staticId} onChange={event => setStaticId(event.target.value)} /></Field><Button type="submit" icon={Link}>Подтвердить привязку</Button></form>
		{tiers.length > 1 && <div className="grid gap-3 border-t border-line pt-5"><Field label="Оставить Tier"><select value={tier} onChange={event => setTier(event.target.value)}>{tiers.map(([rank, id]) => <option key={id} value={id}>{rank}</option>)}</select></Field><Button icon={CheckCheck} onClick={() => resolve({ tierRoleId: tier })}>Сохранить выбор Tier</Button></div>}
		<div className="flex flex-wrap gap-2 border-t border-line pt-5"><Button icon={row.status === 'excluded' ? UserRoundCheck : UserRoundX} onClick={() => resolve({ excluded: row.status !== 'excluded' })}>{row.status === 'excluded' ? 'Вернуть в синхронизацию' : 'Исключить'}</Button>{decision && <IconButton icon={RotateCcw} label="Сбросить ручное решение" onClick={() => resolve({ reset: true })} />}</div>
		<p className="field-hint">После изменения привязок получи новый предпросмотр. Исключение отключает синхронизацию только этого участника.</p>
	</div>
}

export function Majestic({ active, resources, api, run, notify }: PageServices & { active: boolean; resources: Resources }) {
	const [data, setData] = useState<MajesticState | null>(null)
	const [search, setSearch] = useState('')
	const [filter, setFilter] = useState('all')
	const [selected, setSelected] = useState(new Set<string>())
	const [refresh, setRefresh] = useState(0)
	const [now, setNow] = useState(Date.now())
	const [loading, setLoading] = useState(false)
	const lastPreview = useRef<string | undefined>(undefined)
	const lastError = useRef<string | undefined>(undefined)
	const modal = useModal()
	const accept = (next: MajesticState) => {
		if (lastPreview.current !== next.preview?.id) setSelected(new Set())
		else setSelected(previous => new Set(applicableSelection(next, previous)))
		lastPreview.current = next.preview?.id
		setData(next); setNow(Date.now())
	}
	const acceptRef = useRef(accept); acceptRef.current = accept
	useEffect(() => {
		if (!active) return
		let cancelled = false, timer: ReturnType<typeof setTimeout> | undefined
		async function poll() {
			setLoading(true)
			try {
				const next = await api('majestic')
				if (cancelled) return
				acceptRef.current(next)
				if (next.busy) timer = setTimeout(poll, 2000)
			} catch (error) { if (!cancelled) notify(errorMessage(error), true) }
			finally { if (!cancelled) setLoading(false) }
		}
		poll()
		return () => { cancelled = true; clearTimeout(timer) }
	}, [active, api, refresh, notify])
	useEffect(() => {
		if (!data?.preview) return
		const timer = setTimeout(() => setNow(Date.now()), Math.max(0, data.preview.generatedAt + 15 * 60 * 1000 - Date.now() + 10))
		return () => clearTimeout(timer)
	}, [data?.preview?.id, data?.preview?.generatedAt])
	useEffect(() => {
		const error = data?.run?.error
		if (active && error && error !== lastError.current) { lastError.current = error; notify(error, true) }
	}, [active, data?.run?.error, notify])
	function operation(name: string, body: object = {}) {
		run(async () => { await api(`majestic/${name}`, body); accept(await api('majestic')); setRefresh(n => n + 1) })
	}
	const issue = previewIssue(data, now)
	const ids = applicableSelection(data, selected, now)
	const locked = Boolean(data?.busy)
	const rows = visibleRows(data, search, filter)
	const roleName = (id: string) => resources.roles.find(role => role.id === id)?.name || id
	if (!data) return loading ? <Loading /> : <Empty icon={Users} title="Не удалось загрузить синхронизацию"><Button icon={RefreshCw} onClick={() => setRefresh(n => n + 1)}>Повторить</Button></Empty>
	return <div className="grid gap-6">
		<div className="callout">Tier-роли сохраняются. Отсутствие в семье само по себе не снимает роли.</div>
		<div className="flex flex-wrap items-center gap-2"><Button variant="primary" icon={ScanEye} disabled={locked} onClick={() => operation('preview')}>Получить предпросмотр</Button><IconButton icon={RefreshCw} label={locked ? 'Обновить статус' : 'Обновить предпросмотр'} onClick={() => locked ? setRefresh(n => n + 1) : operation('preview')} /><IconButton icon={Square} label="Остановить операцию" disabled={!locked || data.run?.stopRequested} onClick={async () => {
			if (await modal({ title: 'Остановить синхронизацию?', message: 'Оставшиеся операции прекратятся. Уже выполненные изменения сохранятся.', confirm: 'Остановить' })) operation('stop')
		}} />{loading && <span className="ml-2 text-xs text-muted" role="status">Обновляем статус…</span>}</div>
		<Panel title="Состояние синхронизации"><div className="grid gap-3 p-5 text-sm" role="status" aria-live="polite">
			{!data.configured && <p className="text-danger">Настрой подключение Majestic на сервере: MAJESTIC_SESSION_ID, MAJESTIC_SERVER и MAJESTIC_CHARACTER_ID.</p>}
			{data.run && <><div className="flex flex-wrap items-center justify-between gap-2"><span>{({ apply: 'Применение', preview: 'Предпросмотр', nicknames: 'Автообновление ников', sync: 'Автосинхронизация' } as Record<string, string>)[data.run.kind] || data.run.kind}: <strong className="font-medium">{majesticLabels[data.run.status] || data.run.status}</strong></span><span className="tabular-nums text-muted">{data.run.completed} / {data.run.total}</span></div>{data.run.total > 0 && <progress className="sync-progress" value={data.run.completed} max={data.run.total} aria-label="Обработано участников" />}{data.run.stopRequested && <p className="text-muted">Запрошена остановка. Текущий запрос Discord может завершиться.</p>}{data.run.error && <p className="text-danger">{data.run.error}</p>}</>}
			{data.preview ? <><p className="text-xs text-muted">В семье: {data.preview.familyTotal} · Получено {new Date(data.preview.generatedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}</p><div className="flex flex-wrap gap-2">{Object.entries(data.preview.summary).map(([key, count]) => <span key={key} className="badge badge-neutral">{majesticLabels[key] || key}: {count}</span>)}</div></> : <p className="text-muted">Получи предпросмотр, чтобы увидеть состав и конфликты.</p>}
		</div></Panel>
		<div className="grid gap-4 sm:grid-cols-[1fr_220px]"><Field label="Поиск участника"><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Ник, Discord ID или static" /></Field><Field label="Показать"><select value={filter} onChange={event => setFilter(event.target.value)}>{Object.entries({ all: 'Всех', issues: 'Изменения и конфликты', conflict: 'Конфликты', skipped: 'Пропущенных', excluded: 'Исключённых' }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>
		<div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><IconButton icon={CheckCheck} label="Выбрать / снять все доступные изменения" disabled={locked || Boolean(issue)} onClick={() => {
			const all = data.preview!.rows.filter(row => row.status === 'change').map(row => row.discordId)
			setSelected(new Set(all.every(id => selected.has(id)) ? [] : all))
		}} /><span className="text-xs text-muted" aria-live="polite">Выбрано: {ids.length}</span></div><Button icon={ChevronRight} variant="primary" disabled={locked || Boolean(issue) || !ids.length} onClick={() => {
			const fresh = applicableSelection(data, selected, Date.now())
			if (!fresh.length) { setNow(Date.now()); return notify(previewIssue(data) || 'Выбери участников.', true) }
			operation('apply', { previewId: data.preview!.id, discordIds: fresh })
		}}>Применить выбранные</Button></div>
		<p className="field-hint" role="status">{locked ? 'Дождись завершения операции. Статус обновляется автоматически.' : issue || 'Отметь участников или выбери все доступные изменения.'}</p>
		<div className="grid gap-3">{rows.map(row => <article key={row.discordId} className="participant-card">
			<div className="flex flex-wrap items-center gap-3">{row.status === 'change' && <input type="checkbox" aria-label={`Применить изменения: ${row.currentNickname || row.discordId}`} checked={ids.includes(row.discordId)} disabled={locked || Boolean(issue)} onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(row.discordId); else next.delete(row.discordId); return next })} />}<div className="min-w-0 flex-1"><h3 className="break-words text-sm font-medium">{row.currentNickname || row.discordId}</h3><p className="mt-1 break-words text-xs text-muted">Discord ID: {row.discordId}{row.static && ' · Static: ' + row.static}{row.gameRank && ' · В игре: ' + row.gameRank}</p></div><span className={`badge ${['conflict', 'blocked'].includes(row.status) ? 'badge-warning' : 'badge-neutral'}`}>{majesticLabels[row.status] || row.status}</span><IconButton icon={Pencil} label={`Действия участника: ${row.currentNickname || row.discordId}`} disabled={locked} onClick={() => modal({ title: 'Привязка участника', content: ({ close }) => <Resolution row={row} data={data} resolve={body => { close(); operation('resolve', { discordId: row.discordId, ...body }) }} /> })} /></div>
			{row.nickname && row.nickname !== row.currentNickname && <div className="nickname-change"><span>{row.currentNickname || row.discordId}</span><ChevronRight aria-hidden="true" /><strong>{row.nickname}</strong></div>}
			{data.decisions?.[row.discordId]?.static && <p className="mt-3 text-xs text-muted">Подтверждённый static: {data.decisions[row.discordId].static}</p>}
			{Boolean(row.addRoles?.length) && <p className="mt-2 text-xs">Выдать: {row.addRoles!.map(roleName).join(', ')}</p>}{Boolean(row.removeRoles?.length) && <p className="mt-2 text-xs text-danger">Снять: {row.removeRoles!.map(roleName).join(', ')}</p>}
			{row.preservedTier && <p className="mt-2 text-xs text-muted">Tier-роль сохраняется.</p>}{(row.reason || row.roleNote) && <p className="mt-3 text-xs text-muted">{row.reason || row.roleNote}</p>}
		</article>)}{!rows.length && <Empty icon={Users} title="Участников не найдено">Измени поиск или фильтр.</Empty>}</div>
		{Boolean(data.run?.results?.length) && <Panel title="Результат последней операции"><div className="divide-y divide-line">{data.run!.results.map((result, index) => <div key={index} className="flex flex-wrap justify-between gap-2 px-5 py-3 text-xs"><span>{result.before || result.discordId}</span><span className={result.error ? 'text-danger' : 'text-muted'}>{majesticLabels[result.status] || result.status}{result.error && ' · ' + result.error}</span></div>)}</div></Panel>}
	</div>
}
