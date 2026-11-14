import { createApi, readAuthStatus } from './lib/api'
import type { Api, Config, Resources, Session, Drafts, SettingsDraft, Notify, Run, Guild, HistoryEntry, Overview as OverviewData } from './types'
import { errorMessage, errorStatus } from './types'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Activity, ArrowUp, ArrowRight, ArrowUpRight, Clock, ListChecks, CalendarDays, Braces, BookOpen, Check, ChevronRight, Database, Files, History, LayoutDashboard, LogOut, Menu, RefreshCw, Settings2, ShieldCheck, Wifi, X } from 'lucide-react'
import { BusyContext, Button, Empty, IconButton, Loading, Panel, useModal } from './components/ui'
import { HistoryRows } from './components/History'
import { Variables } from './pages/Variables'
import { Templates } from './pages/Templates'
import { Settings } from './pages/Settings'
import { Majestic } from './pages/Majestic'
import { RoleCurators } from './pages/RoleCurators'
import { CapturePresets } from './pages/CapturePresets'
import { dirtyGroup } from './lib/templates'
import { showGuide } from './guides'
import { Appearance } from './components/Appearance'

const pages = {
	overview: { title: 'Обзор', label: 'Обзор', description: 'Твой сервер. Всё под контролем.', icon: LayoutDashboard },
	templates: { title: 'Шаблоны сообщений', label: 'Шаблоны', description: 'Редактируй содержимое. Структуру и кнопки сохранит бот.', icon: Files },
	variables: { title: 'Переменные шаблонов', label: 'Переменные', description: 'Значения для быстрой замены в шаблонах.', icon: Braces },
	settings: { title: 'Настройки', label: 'Настройки', description: 'Каналы, роли и параметры работы бота.', icon: Settings2 },
	access: { title: 'Доступ к функциям', label: 'Доступ', description: 'Дополнительные роли для функций бота.', icon: ShieldCheck },
	curators: { title: 'Кураторы ролей', label: 'Кураторы ролей', description: 'Назначай, кто и какими ролями может управлять.', icon: ListChecks },
	captures: { title: 'Управление сборами', label: 'Сборы', description: 'Предустановки ручной регистрации на мероприятия.', icon: CalendarDays },
	majestic: { title: 'Majestic — синхронизация', label: 'Majestic', description: 'Сверь состав семьи с Discord перед применением изменений.', icon: RefreshCw },
	history: { title: 'История изменений', label: 'История изменений', description: 'Последние 100 действий администраторов. Время — московское.', icon: History }
}

function currentPage() { const page = location.hash.slice(1).split('?')[0]; return Object.hasOwn(pages, page) ? page as keyof typeof pages : 'overview' }

const navigation = [
	['Обзор', ['overview']],
	['Контент', ['templates', 'variables']],
	['Управление сервером', ['captures', 'curators', 'access']],
	['Интеграции', ['majestic']],
	['Система', ['settings', 'history']]
] satisfies [string, (keyof typeof pages)[]][]

function Login({ loading, configured, status, retry }: { loading: boolean; configured: boolean; status: string; retry(): void }) {
	return <main className="login-screen"><div className="login-decoration" aria-hidden="true" /><div className="login-card"><img src="/revento-logo.png" className="mb-8 size-16 rounded-2xl" alt="Логотип Revento" /><p className="eyebrow mb-4">REVENTO / CONTROL ROOM</p><h1 className="text-4xl font-semibold leading-tight tracking-[-1.5px] sm:text-5xl">Всё под<br /><span className="text-brand">контролем.</span></h1><p className="mt-5 max-w-sm text-sm leading-relaxed text-muted">Сообщения, компоненты и настройки твоего сервера в одном месте.</p>
		{loading ? <Loading>Проверяем подключение…</Loading> : configured ? <a className="button button-primary mt-8 w-full" href="/auth/discord">Войти через Discord<ArrowUpRight aria-hidden="true" /></a> : <Button className="mt-8" icon={RefreshCw} onClick={retry}>Проверить подключение</Button>}
		<p role="status" aria-live="polite" className="mt-4 text-xs leading-relaxed text-muted">{status || 'Доступ только администраторам сервера.'}</p><div className="mt-8 flex items-center gap-2 border-t border-line pt-5 text-[11px] text-muted"><ShieldCheck className="size-4 text-brand" />Авторизация через Discord · проверка прав на сервере</div></div></main>
}

type DataPageProps = { active: boolean; api: Api; config: Config; guild: Guild; notify: Notify; refresh: number }
function Overview({ active, api, config, guild, notify, refresh }: DataPageProps) {
	const [data, setData] = useState<OverviewData | null>(null)
	const [loading, setLoading] = useState(false)
	useEffect(() => {
		if (!active) return
		let cancelled = false
		setLoading(true)
		api('overview').then(result => { if (!cancelled) setData(result) }).catch(error => { if (!cancelled) notify(errorMessage(error), true) }).finally(() => { if (!cancelled) setLoading(false) })
		return () => { cancelled = true }
	}, [active, api, refresh, notify])
	return <div className="grid gap-7"><div className="overview-hero"><div><p className="eyebrow mb-3">ТВОЙ СЕРВЕР. ТВОИ ПРАВИЛА.</p><h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Центр управления</h2><p className="mt-3 max-w-lg text-sm leading-relaxed text-muted">Подготовь публикацию, обнови шаблоны и настрой бота — без редактирования кода.</p><a href="#templates" className="button button-primary mt-6">Открыть шаблоны<ArrowRight aria-hidden="true" /></a></div></div>
		{loading && !data ? <Loading /> : data && <div className="metric-grid">{([[Wifi, 'Discord', data.ready ? 'Подключён' : 'Отключён'], [Activity, 'Задержка API', data.ping >= 0 ? data.ping + ' мс' : 'Измеряется'], [Database, 'База данных', data.database ? 'Доступна' : 'Недоступна'], [Clock, 'Время работы', Math.floor(data.uptime / 3600) + ' ч ' + Math.floor(data.uptime % 3600 / 60) + ' мин']] satisfies [typeof Wifi, string, string][]).map(([Icon, label, value]) => <div className="metric" data-tilt key={label}><div className="flex items-center justify-between gap-2 text-xs text-muted"><span>{label}</span><Icon className="size-4" aria-hidden="true" /></div><strong className="mt-3 block text-lg font-medium tracking-tight">{value}</strong></div>)}</div>}
		<div className="grid gap-4 sm:grid-cols-2">{([['templates', 'Обновить шаблоны', 'Тексты и кнопки сообщений бота в одном редакторе.', Files], ['captures', 'Подготовить сбор', 'Команды и предустановки для событий семьи.', CalendarDays], ['curators', 'Назначить кураторов', 'Управление ролями и полномочиями участников.', ListChecks], ['majestic', 'Сверить состав', 'Синхронизация участников семьи с Discord.', RefreshCw]] satisfies [string, string, string, typeof Files][]).map(([key, title, description, Icon]) => <a key={key} href={'#' + key} className="quick-link" data-tilt><div className="mb-5 flex items-center justify-between"><Icon className="size-5 text-brand" aria-hidden="true" /><ArrowUpRight className="size-4 text-muted" aria-hidden="true" /></div><h2 className="text-base font-medium">{title}</h2><p className="mt-2 text-xs leading-relaxed text-muted">{description}</p></a>)}</div>
		<Panel title="Последние изменения" action={<a href="#history" className="inline-flex items-center gap-1 text-xs text-muted hover:text-brand">Вся история<ArrowUpRight className="size-3.5" aria-hidden="true" /></a>}><HistoryRows entries={data?.history || []} config={config} guild={guild} compact /></Panel>
	</div>
}

function HistoryPage({ active, api, config, guild, notify, refresh }: DataPageProps) {
	const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
	useEffect(() => {
		if (!active) return
		let cancelled = false
		api('history').then(data => { if (!cancelled) setEntries(data) }).catch(error => { if (!cancelled) notify(errorMessage(error), true) })
		return () => { cancelled = true }
	}, [active, api, notify, refresh])
	return entries ? <Panel title="Журнал действий"><HistoryRows entries={entries} config={config} guild={guild} /></Panel> : <Loading />
}

export function App() {
	const [page, setPage] = useState(currentPage)
	const [menu, setMenu] = useState(false)
	const [alt, setAlt] = useState(false)
	const [scrolled, setScrolled] = useState(false)
	const [headerVisible, setHeaderVisible] = useState(true)
	useEffect(() => {
		let previous = window.scrollY, upward = 0
		const scroll = () => {
			const current = window.scrollY
			upward = current < previous ? upward + previous - current : 0
			setScrolled(current > 320)
			if (current < 72 || upward > 12) setHeaderVisible(true)
			else if (current > previous && current > 100) setHeaderVisible(false)
			previous = current
		}
		const keydown = (event: KeyboardEvent) => {
			setAlt(event.altKey && !event.ctrlKey && !event.metaKey)
			if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || document.querySelector('dialog[open]')) return
			const index = /^Digit[1-9]$/.test(event.code) ? Number(event.code.slice(-1)) - 1 : -1
			const target = navigation.flatMap(([, keys]) => keys)[index]
			if (target) { event.preventDefault(); location.hash = target; setMenu(false) }
		}
		const release = (event: KeyboardEvent) => setAlt(event.altKey && !event.ctrlKey && !event.metaKey)
		const blur = () => setAlt(false)
		window.addEventListener('scroll', scroll, { passive: true })
		window.addEventListener('keydown', keydown); window.addEventListener('keyup', release); window.addEventListener('blur', blur)
		return () => { window.removeEventListener('scroll', scroll); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', release); window.removeEventListener('blur', blur) }
	}, [])
	const sidebar = useRef<HTMLElement>(null)
	useEffect(() => {
		if (!menu) return
		const previous = document.activeElement
		const media = matchMedia('(min-width: 1024px)')
		const close = () => { if (media.matches) setMenu(false) }
		const keydown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') { event.preventDefault(); setMenu(false) }
			if (event.key !== 'Tab') return
			const targets = sidebar.current?.querySelectorAll<HTMLElement>('a, button:not(:disabled)')
			if (!targets?.length) return
			const first = targets[0], last = targets[targets.length - 1]
			if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
		}
		sidebar.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
		document.addEventListener('keydown', keydown); media.addEventListener('change', close)
		return () => {
			document.removeEventListener('keydown', keydown); media.removeEventListener('change', close)
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
		}
	}, [menu])
	const [session, setSession] = useState<Session | null>(null)
	const [configured, setConfigured] = useState(false)
	const [booting, setBooting] = useState(true)
	const [loginStatus, setLoginStatus] = useState('')
	const [config, setConfig] = useState<Config | null>(null)
	const [resources, setResources] = useState<Resources | null>(null)
	const [drafts, setDrafts] = useState<Drafts>({})
	const [settings, setSettings] = useState<SettingsDraft>({})
	const [busy, setBusy] = useState(false)
	const [toast, setToast] = useState('')
	const [refresh, setRefresh] = useState(0)
	const lock = useRef(false)
	const sessionRef = useRef(session)
	const modal = useModal()
	const notify = useCallback<Notify>((message, error = false) => {
		if (error) { setToast(''); modal({ kind: 'error', title: 'Не удалось завершить действие', message }) }
		else setToast(message)
	}, [modal])
	const api = useRef(createApi(() => sessionRef.current?.csrf || '', () => { sessionRef.current = null; setSession(null) })).current
	const run = useCallback<Run>(async work => {
		if (lock.current) return
		lock.current = true; setBusy(true)
		try { return await work() } catch (error) { notify(errorMessage(error), true) }
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
			const status = await readAuthStatus(response)
			setConfigured(status.configured)
			if (!status.configured) { setLoginStatus('Настрой CLIENT_ID, DISCORD_CLIENT_SECRET (или CLIENT_SECRET), GUILD_ID и DASHBOARD_URL в окружении сервера.'); return }
			const current = await api('session')
			sessionRef.current = current; setSession(current)
			await loadConfig()
		} catch (error) {
			setLoginStatus(errorStatus(error) === 401 ? 'Войди с аккаунтом администратора сервера.' : errorMessage(error))
			if (errorStatus(error) !== 401) notify(errorMessage(error), true)
		} finally { setBooting(false) }
	}
	useEffect(() => {
		const error = new URLSearchParams(location.search).get('error')
		if (error) { modal({ kind: 'error', title: 'Не удалось войти через Discord', message: error }); history.replaceState(null, '', location.pathname + location.hash) }
		start()
		const change = () => { setPage(currentPage()); setMenu(false); setToast('') }
		window.addEventListener('hashchange', change)
		if (!Object.hasOwn(pages, location.hash.slice(1).split('?')[0]) && location.hash) history.replaceState(null, '', '/#overview')
		return () => window.removeEventListener('hashchange', change)
	}, [])
	useEffect(() => {
		if (!toast) return
		const timer = setTimeout(() => setToast(''), 8000)
		return () => clearTimeout(timer)
	}, [toast])
	const dirty = config && (Object.keys(drafts).some(group => dirtyGroup(config, drafts, group)) || config.settings.some(field => JSON.stringify(settings[field.key]) !== JSON.stringify(field.value)))
	useEffect(() => {
		const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
		window.addEventListener('beforeunload', warn)
		return () => window.removeEventListener('beforeunload', warn)
	}, [dirty])
	async function reload() {
		if (['overview', 'history'].includes(page)) { setRefresh(n => n + 1); return }
		if (!await modal({ title: 'Обновить данные?', message: 'Несохранённые правки шаблонов и настроек будут сброшены.', confirm: 'Обновить' })) return
		run(async () => { await loadConfig(); notify('Данные обновлены.') })
	}
	if (!session) return <><div className="login-appearance"><Appearance /></div><Login loading={booting} configured={configured} status={loginStatus} retry={start} /></>
	const current = pages[page]
	return <div className={`app-shell ${alt ? 'show-shortcuts' : ''}`}>
		{menu && <button className="sidebar-scrim" aria-label="Закрыть меню" onClick={() => setMenu(false)} />}
		<aside ref={sidebar} id="dashboard-navigation" className={`sidebar ${menu ? 'sidebar-open' : ''}`} aria-label="Рабочее пространство"><IconButton className="sidebar-close lg:hidden" icon={X} label="Закрыть меню" onClick={() => setMenu(false)} /><a href="#overview" className="brand"><img src="/revento-logo.png" alt="" /><span>REVENTO<small>CONTROL ROOM</small></span></a><nav aria-label="Разделы дашборда">{navigation.map(([title, keys]) => <div className="nav-group" key={title}><p className="nav-caption">{title}</p>{keys.map(key => { const { label, icon: Icon } = pages[key]; return <a href={'#' + key} key={key} aria-keyshortcuts={`Alt+${navigation.flatMap(([, items]) => items).indexOf(key) + 1}`} aria-current={page === key ? 'page' : undefined}><Icon aria-hidden="true" /><span>{label}</span><kbd className="nav-shortcut" aria-hidden="true">{navigation.flatMap(([, items]) => items).indexOf(key) + 1}</kbd></a> })}</div>)}</nav><div className="sidebar-bottom"><div className="user-avatar">{session.user.avatar ? <img src={session.user.avatar} alt="" className="size-full rounded-full object-cover" /> : session.user.name.slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={session.user.name}>{session.user.name}</p><p className="mt-1 text-[10px] text-muted">Аккаунт Discord</p></div><IconButton icon={LogOut} label="Выйти из аккаунта" disabled={busy} onClick={async () => {
			if (!await modal({ title: 'Выйти из аккаунта?', message: dirty ? 'Несохранённые правки будут потеряны. Для входа потребуется авторизация через Discord.' : 'Для входа потребуется снова авторизоваться через Discord.', confirm: 'Выйти' })) return
			run(async () => { await api('logout', {}); sessionRef.current = null; setSession(null); setConfig(null); setResources(null); setDrafts({}); setSettings({}); setLoginStatus('Ты вышел из аккаунта.'); setToast('') })
		}} /></div></aside>
		<main className="main-content" inert={menu}><header className={`topbar ${headerVisible || menu ? 'topbar-visible' : ''}`}><div className="flex min-w-0 items-center gap-3"><div className="lg:hidden"><IconButton aria-expanded={menu} aria-controls="dashboard-navigation" icon={menu ? X : Menu} label={menu ? 'Закрыть меню' : 'Открыть меню'} className="lg:hidden" onClick={() => setMenu(!menu)} /></div><p className="flex min-w-0 items-center gap-2 text-xs text-muted"><span className="hidden sm:inline">Рабочее пространство</span><ChevronRight className="hidden size-3 sm:block" aria-hidden="true" /><span className="truncate text-text">{current.label}</span></p></div><div className="flex items-center gap-3"><Appearance /></div></header>
			<div className="page-content"><div className="page-heading"><div><p className="eyebrow mb-2 lg:hidden">REVENTO / CONTROL ROOM</p><h1>{current.title}</h1><p>{current.description}</p></div><div className="flex shrink-0 gap-2">{page !== 'majestic' && <IconButton icon={RefreshCw} label="Обновить данные" disabled={busy || booting} onClick={reload} />}<IconButton icon={BookOpen} label="Руководство по разделу" onClick={() => showGuide(modal, page)} /></div></div>
				{!config || !resources ? booting || busy ? <Loading /> : <Empty title="Не удалось загрузить данные"><Button icon={RefreshCw} onClick={() => run(loadConfig)}>Повторить загрузку</Button></Empty>
					: <BusyContext.Provider value={busy}><fieldset className="min-w-0" disabled={busy} aria-busy={busy}>
						<div className="page-view" hidden={page !== 'overview'}><Overview active={page === 'overview'} api={api} config={config} guild={session.guild} notify={notify} refresh={refresh} /></div>
						<div className="page-view" hidden={page !== 'templates'}><Templates config={config} setConfig={setConfig} resources={resources} drafts={drafts} setDrafts={setDrafts} api={api} run={run} notify={notify} /></div>
						<div className="page-view" hidden={page !== 'variables'}><Variables config={config} setConfig={setConfig} api={api} run={run} notify={notify} /></div>
						<div className="page-view" hidden={page !== 'settings'}><Settings config={config} setConfig={setConfig} resources={resources} draft={settings} setDraft={setSettings} api={api} run={run} notify={notify} /></div>
						<div className="page-view" hidden={page !== 'access'}><Settings access config={config} setConfig={setConfig} resources={resources} draft={settings} setDraft={setSettings} api={api} run={run} notify={notify} /></div>
						<div className="page-view" hidden={page !== 'curators'}><RoleCurators active={page === 'curators'} resources={resources} api={api} run={run} notify={notify} setConfig={setConfig} /></div>
						<div className="page-view" hidden={page !== 'captures'}><CapturePresets active={page === 'captures'} resources={resources} api={api} run={run} notify={notify} setConfig={setConfig} /></div>
						<div className="page-view" hidden={page !== 'majestic'}><Majestic active={page === 'majestic'} resources={resources} api={api} run={run} notify={notify} /></div>
						<div className="page-view" hidden={page !== 'history'}><HistoryPage active={page === 'history'} api={api} config={config} guild={session.guild} notify={notify} refresh={refresh} /></div>
					</fieldset></BusyContext.Provider>}
			</div>
		</main>
		{scrolled && <IconButton icon={ArrowUp} label="Наверх" className="scroll-top" onClick={() => window.scrollTo({ top: 0, behavior: document.documentElement.dataset.motion === 'on' ? 'smooth' : 'instant' })} />}
		{busy && <div role="status" className="busy-indicator"><RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />Выполняется действие…</div>}
		{toast && <div role="status" aria-live="polite" className="toast"><Check className="size-4 shrink-0 text-brand" aria-hidden="true" /><p>{toast}</p><IconButton icon={X} label="Закрыть уведомление" onClick={() => setToast('')} /></div>}
	</div>
}
