import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronRight, Database, Files, History, LayoutDashboard, LogOut, Menu, PanelsTopLeft, RefreshCw, Settings2, ShieldCheck, Wifi, X } from 'lucide-react'
import { Button, Empty, IconButton, Loading, Panel, useModal } from './components/ui.jsx'
import { HistoryRows } from './components/History.jsx'
import { Templates } from './pages/Templates.jsx'
import { Builder } from './pages/Builder.jsx'
import { Settings } from './pages/Settings.jsx'
import { Majestic } from './pages/Majestic.jsx'
import { dirtyGroup } from './lib/templates.mjs'
import { showGuide } from './guides.jsx'

const pages = {
	overview: { title: 'Обзор', label: 'Обзор', description: 'Твой сервер. Всё под контролем.', icon: LayoutDashboard },
	builder: { title: 'Конструктор v2', label: 'Конструктор v2', description: 'Собери сообщение и проверь его перед отправкой.', icon: PanelsTopLeft },
	templates: { title: 'Шаблоны сообщений', label: 'Шаблоны', description: 'Редактируй содержимое. Структуру и кнопки сохранит бот.', icon: Files },
	settings: { title: 'Настройки', label: 'Настройки', description: 'Каналы, роли и параметры работы бота.', icon: Settings2 },
	majestic: { title: 'Majestic — синхронизация', label: 'Majestic', description: 'Сверь состав семьи с Discord перед применением изменений.', icon: RefreshCw },
	history: { title: 'История изменений', label: 'История изменений', description: 'Последние 100 действий администраторов. Время — московское.', icon: History }
}

function currentPage() { const page = location.hash.slice(1); return Object.hasOwn(pages, page) ? page : 'overview' }

function Login({ loading, configured, status, retry }) {
	return <main className="login-screen"><div className="login-decoration" aria-hidden="true" /><div className="login-card"><img src="/revento-logo.png" className="mb-8 size-16 rounded-2xl" alt="Логотип Revento" /><p className="eyebrow mb-4">REVENTO / CONTROL ROOM</p><h1 className="text-4xl font-semibold leading-tight tracking-[-1.5px] sm:text-5xl">Всё под<br /><span className="text-brand">контролем.</span></h1><p className="mt-5 max-w-sm text-sm leading-relaxed text-muted">Сообщения, компоненты и настройки твоего сервера в одном месте.</p>
		{loading ? <Loading>Проверяем подключение…</Loading> : configured ? <a className="button button-primary mt-8 w-full" href="/auth/discord">Войти через Discord<ArrowUpRight aria-hidden="true" /></a> : <Button className="mt-8" icon={RefreshCw} onClick={retry}>Проверить подключение</Button>}
		<p role="status" aria-live="polite" className="mt-4 text-xs leading-relaxed text-muted">{status || 'Доступ только администраторам сервера.'}</p><div className="mt-8 flex items-center gap-2 border-t border-line pt-5 text-[11px] text-muted"><ShieldCheck className="size-4 text-brand" />Авторизация через Discord · проверка прав на сервере</div></div></main>
}

function Overview({ active, api, config, notify, refresh }) {
	const [data, setData] = useState(null)
	const [loading, setLoading] = useState(false)
	useEffect(() => {
		if (!active) return
		let cancelled = false
		setLoading(true)
		api('overview').then(result => { if (!cancelled) setData(result) }).catch(error => { if (!cancelled) notify(error.message, true) }).finally(() => { if (!cancelled) setLoading(false) })
		return () => { cancelled = true }
	}, [active, api, refresh, notify])
	return <div className="grid gap-7"><div className="overview-hero"><div><p className="eyebrow mb-3">ТВОЙ СЕРВЕР. ТВОИ ПРАВИЛА.</p><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Центр управления Revento</h2><p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">Подготовь публикацию, обнови шаблоны и настрой бота — без редактирования кода.</p><a href="#templates" className="button button-primary mt-6">Открыть шаблоны<ArrowRight aria-hidden="true" /></a></div><img src="/revento-logo.png" alt="" aria-hidden="true" className="hidden size-28 rounded-3xl opacity-90 lg:block" /></div>
		{loading && !data ? <Loading /> : data && <div className="metric-grid">{[[Wifi, 'Discord', data.ready ? 'Подключён' : 'Отключён'], [ChevronRight, 'Задержка API', data.ping >= 0 ? data.ping + ' мс' : 'Измеряется'], [Database, 'База данных', data.database ? 'Доступна' : 'Недоступна'], [History, 'Время работы', Math.floor(data.uptime / 3600) + ' ч ' + Math.floor(data.uptime % 3600 / 60) + ' мин']].map(([Icon, label, value]) => <div className="metric" key={label}><div className="flex items-center justify-between gap-2 text-xs text-muted"><span>{label}</span><Icon className="size-4" aria-hidden="true" /></div><strong className="mt-3 block text-lg font-medium tracking-tight">{value}</strong></div>)}</div>}
		<div className="grid gap-4 sm:grid-cols-2">{[['builder', 'Создать сообщение', 'Markdown, компоненты и предпросмотр перед публикацией.', PanelsTopLeft], ['templates', 'Обновить шаблоны', 'Тексты и кнопки сообщений бота в одном редакторе.', Files]].map(([key, title, description, Icon]) => <a key={key} href={'#' + key} className="quick-link"><div className="mb-5 flex items-center justify-between"><Icon className="size-5 text-brand" aria-hidden="true" /><ArrowUpRight className="size-4 text-muted" aria-hidden="true" /></div><h2 className="text-base font-medium">{title}</h2><p className="mt-2 text-xs leading-relaxed text-muted">{description}</p></a>)}</div>
		<Panel title="Последние изменения" action={<a href="#history" className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand">Вся история<ArrowUpRight className="size-3.5" aria-hidden="true" /></a>}><HistoryRows entries={data?.history || []} config={config} compact /></Panel>
	</div>
}

function HistoryPage({ active, api, config, notify, refresh }) {
	const [entries, setEntries] = useState(null)
	useEffect(() => {
		if (!active) return
		let cancelled = false
		api('history').then(data => { if (!cancelled) setEntries(data) }).catch(error => { if (!cancelled) notify(error.message, true) })
		return () => { cancelled = true }
	}, [active, api, notify, refresh])
	return entries ? <Panel title="Журнал действий"><HistoryRows entries={entries} config={config} /></Panel> : <Loading />
}

export function App() {
	const [page, setPage] = useState(currentPage)
	const [menu, setMenu] = useState(false)
	const [session, setSession] = useState(null)
	const [configured, setConfigured] = useState(false)
	const [booting, setBooting] = useState(true)
	const [loginStatus, setLoginStatus] = useState('')
	const [config, setConfig] = useState(null)
	const [resources, setResources] = useState(null)
	const [drafts, setDrafts] = useState({})
	const [settings, setSettings] = useState({})
	const [builderDirty, setBuilderDirty] = useState(false)
	const [busy, setBusy] = useState(false)
	const [toast, setToast] = useState('')
	const [refresh, setRefresh] = useState(0)
	const lock = useRef(false)
	const sessionRef = useRef(session)
	const modal = useModal()
	const notify = useCallback((message, error = false) => {
		if (error) { setToast(''); modal({ kind: 'error', title: 'Не удалось завершить действие', message }) }
		else setToast(message)
	}, [modal])
	const api = useCallback(async (path, body) => {
		let response
		try {
			response = await fetch('/api/' + path, { credentials: 'same-origin', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': sessionRef.current?.csrf || '' }, body: JSON.stringify(body) }) })
		} catch { throw new Error('Не удалось связаться с сервером. Проверь подключение и повтори действие. Черновики остаются в редакторе.') }
		let result
		try { result = await response.json() } catch { throw new Error('Сервер вернул неожиданный ответ. Повтори действие позже.') }
		if (!response.ok) {
			if (response.status === 401) { sessionRef.current = null; setSession(null) }
			throw Object.assign(new Error(result.error || 'Не удалось выполнить запрос.'), { status: response.status })
		}
		return result
	}, [])
	const run = useCallback(async work => {
		if (lock.current) return
		lock.current = true; setBusy(true)
		try { return await work() } catch (error) { notify(error.message, true) }
		finally { lock.current = false; setBusy(false) }
	}, [notify])
	async function loadConfig() {
		const [next, nextResources] = await Promise.all([api('config'), api('resources')])
		window.setDiscordMentionResources(nextResources)
		setConfig(next); setResources(nextResources); setDrafts({}); setSettings(Object.fromEntries(next.settings.map(field => [field.key, structuredClone(field.value)])))
	}
	async function start() {
		setBooting(true)
		try {
			const response = await fetch('/auth/status')
			if (!response.ok) throw new Error('Не удалось проверить подключение Discord. Повтори попытку.')
			const status = await response.json()
			setConfigured(status.configured)
			if (!status.configured) { setLoginStatus('Настрой CLIENT_ID, DISCORD_CLIENT_SECRET (или CLIENT_SECRET), GUILD_ID и DASHBOARD_URL в окружении сервера.'); return }
			const current = await api('session')
			sessionRef.current = current; setSession(current)
			await loadConfig()
		} catch (error) {
			setLoginStatus(error.status === 401 ? 'Войди с аккаунтом администратора сервера.' : error.message)
			if (error.status !== 401) notify(error.message, true)
		} finally { setBooting(false) }
	}
	useEffect(() => {
		const error = new URLSearchParams(location.search).get('error')
		if (error) { modal({ kind: 'error', title: 'Не удалось войти через Discord', message: error }); history.replaceState(null, '', location.pathname + location.hash) }
		start()
		const change = () => { setPage(currentPage()); setMenu(false); setToast('') }
		window.addEventListener('hashchange', change)
		if (!Object.hasOwn(pages, location.hash.slice(1)) && location.hash) history.replaceState(null, '', '/#overview')
		return () => window.removeEventListener('hashchange', change)
	}, [])
	useEffect(() => {
		if (!toast) return
		const timer = setTimeout(() => setToast(''), 8000)
		return () => clearTimeout(timer)
	}, [toast])
	const dirty = config && (builderDirty || Object.keys(drafts).some(group => dirtyGroup(config, drafts, group)) || config.settings.some(field => JSON.stringify(settings[field.key]) !== JSON.stringify(field.value)))
	useEffect(() => {
		const warn = event => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
		window.addEventListener('beforeunload', warn)
		return () => window.removeEventListener('beforeunload', warn)
	}, [dirty])
	async function reload() {
		if (['overview', 'history'].includes(page)) { setRefresh(n => n + 1); return }
		if (!await modal({ title: 'Обновить данные?', message: 'Несохранённые правки шаблонов и настроек будут сброшены.', confirm: 'Обновить' })) return
		run(async () => { await loadConfig(); notify('Данные обновлены.') })
	}
	if (!session) return <Login loading={booting} configured={configured} status={loginStatus} retry={start} />
	const current = pages[page]
	return <div className="app-shell">
		{menu && <button className="sidebar-scrim" aria-label="Закрыть меню" onClick={() => setMenu(false)} />}
		<aside className={`sidebar ${menu ? 'sidebar-open' : ''}`} aria-label="Рабочее пространство"><a href="#overview" className="brand"><img src="/revento-logo.png" alt="" /><span>REVENTO<small>CONTROL ROOM</small></span></a><div className="server-card"><span className="server-avatar">{session.guild.name.slice(0, 1)}</span><div className="min-w-0"><strong className="block truncate text-sm font-medium" title={session.guild.name}>{session.guild.name}</strong><span className="text-[11px] text-muted">Твой сервер</span></div></div><div><p className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</p><nav aria-label="Разделы дашборда">{Object.entries(pages).map(([key, { label, icon: Icon }]) => <a href={'#' + key} key={key} aria-current={page === key ? 'page' : undefined}><Icon aria-hidden="true" /><span>{label}</span>{key === 'builder' && <small aria-hidden="true">V2</small>}</a>)}</nav></div><div className="sidebar-bottom"><div className="user-avatar">{session.user.name.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={session.user.name}>{session.user.name}</p><p className="mt-1 text-[10px] text-muted">Аккаунт Discord</p></div><IconButton icon={LogOut} label="Выйти из аккаунта" disabled={busy} onClick={async () => {
			if (!await modal({ title: 'Выйти из аккаунта?', message: dirty ? 'Несохранённые правки будут потеряны. Для входа потребуется авторизация через Discord.' : 'Для входа потребуется снова авторизоваться через Discord.', confirm: 'Выйти' })) return
			run(async () => { await api('logout', {}); sessionRef.current = null; setSession(null); setConfig(null); setResources(null); setDrafts({}); setSettings({}); setBuilderDirty(false); setLoginStatus('Ты вышел из аккаунта.'); setToast('') })
		}} /></div></aside>
		<main className="main-content"><header className="topbar"><div className="flex min-w-0 items-center gap-3"><IconButton icon={menu ? X : Menu} label={menu ? 'Закрыть меню' : 'Открыть меню'} className="lg:hidden" onClick={() => setMenu(!menu)} /><p className="flex min-w-0 items-center gap-2 text-xs text-muted"><span className="hidden sm:inline">Рабочее пространство</span><ChevronRight className="hidden size-3 sm:block" aria-hidden="true" /><span className="truncate text-text">{current.label}</span></p></div><span className="admin-badge"><ShieldCheck aria-hidden="true" /><span>Администратор</span></span></header>
			<div className="page-content"><div className="page-heading"><div><p className="eyebrow mb-2 lg:hidden">REVENTO / CONTROL ROOM</p><h1>{current.title}</h1><p>{current.description}</p></div><div className="flex shrink-0 gap-2">{page !== 'majestic' && <IconButton icon={RefreshCw} label="Обновить данные" disabled={busy || booting} onClick={reload} />}<IconButton icon={BookOpen} label="Руководство по разделу" onClick={() => showGuide(modal, page)} /></div></div>
				{!config || !resources ? booting || busy ? <Loading /> : <Empty title="Не удалось загрузить данные"><Button icon={RefreshCw} onClick={() => run(loadConfig)}>Повторить загрузку</Button></Empty>
					: <fieldset className="min-w-0" disabled={busy} aria-busy={busy}>
						<div hidden={page !== 'overview'}><Overview active={page === 'overview'} api={api} config={config} notify={notify} refresh={refresh} /></div>
						<div hidden={page !== 'builder'}><Builder resources={resources} api={api} run={run} notify={notify} onDirty={setBuilderDirty} /></div>
						<div hidden={page !== 'templates'}><Templates config={config} setConfig={setConfig} resources={resources} drafts={drafts} setDrafts={setDrafts} api={api} run={run} notify={notify} /></div>
						<div hidden={page !== 'settings'}><Settings config={config} setConfig={setConfig} resources={resources} draft={settings} setDraft={setSettings} api={api} run={run} notify={notify} /></div>
						<div hidden={page !== 'majestic'}><Majestic active={page === 'majestic'} resources={resources} api={api} run={run} notify={notify} /></div>
						<div hidden={page !== 'history'}><HistoryPage active={page === 'history'} api={api} config={config} notify={notify} refresh={refresh} /></div>
					</fieldset>}
			</div>
		</main>
		{busy && <div role="status" className="busy-indicator"><RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />Выполняется действие…</div>}
		{toast && <div role="status" aria-live="polite" className="toast"><Check className="size-4 shrink-0 text-brand" aria-hidden="true" /><p>{toast}</p><IconButton icon={X} label="Закрыть уведомление" onClick={() => setToast('')} /></div>}
	</div>
}
