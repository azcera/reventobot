import { createRoot } from 'react-dom/client'
import { ArrowUpRight, Circle, Eraser, Hand, Map, Minus, MousePointer2, Pencil, Plus, RotateCcw, Save, Shapes, Square, Triangle, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DragEvent, PointerEvent } from 'react'
import { brushWidths, shapes } from '../../../shared/tactics'
import type { Board, BoardObject, ClientMessage, Edit, MapPage, Player, Point, ServerMessage, Shape, Stroke, TacticInfo } from '../../../shared/tactics'
import { hit, paint } from './canvas'
import { connectActivity } from './connection'
import './style.css'

const palette = ['#ff414b', '#fb912e', '#ffe258', '#4ade80', '#38d6ff', '#bd8cff', '#ffffff', '#111827']
const figures = {
	circle: { icon: Circle, label: 'Круг' },
	rectangle: { icon: Square, label: 'Прямоугольник' },
	triangle: { icon: Triangle, label: 'Треугольник' },
	arrow: { icon: ArrowUpRight, label: 'Стрелка' }
}
const tools = {
	select: { icon: MousePointer2, label: 'Выбрать и переместить' },
	brush: { icon: Pencil, label: 'Кисть' },
	erase: { icon: Eraser, label: 'Удалить объект' },
	pan: { icon: Hand, label: 'Переместить карту' }
}
type Placement = { shape: Shape } | { userId: string }
type Gesture =
	| { kind: 'stroke'; stroke: Stroke; sent: number; last: number }
	| { kind: 'move'; object: Exclude<BoardObject, Stroke> }
	| { kind: 'pan'; x: number; y: number; left: number; top: number }
const initialBoard: Board = { map: null, epoch: 0, revision: 0, dirty: false, objects: [] }

function Activity() {
	const [board, setBoard] = useState(initialBoard)
	const current = useRef(initialBoard)
	const [players, setPlayers] = useState<Player[]>([])
	const [canEdit, setCanEdit] = useState(false)
	const [connected, setConnected] = useState(false)
	const [status, setStatus] = useState('Запуск доски…')
	const [notice, setNotice] = useState('')
	const connection = useRef<ReturnType<typeof connectActivity> | null>(null)
	const [maps, setMaps] = useState<MapPage>({ maps: [], next: null })
	const [search, setSearch] = useState('')
	const [searchLoaded, setSearchLoaded] = useState<string | null>(null)
	const [mapGeneration, setMapGeneration] = useState(0)
	const [tactics, setTactics] = useState<TacticInfo[]>([])
	const [presetGeneration, setPresetGeneration] = useState(0)
	const [image, setImage] = useState('')
	const [imageError, setImageError] = useState('')
	const [zoom, setZoom] = useState(1)
	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
	const [panel, setPanel] = useState<'maps' | 'players' | null>('maps')
	const [tool, setTool] = useState<keyof typeof tools>('brush')
	const [color, setColor] = useState(palette[0])
	const [brush, setBrush] = useState<number>(brushWidths[1])
	const [figuresOpen, setFiguresOpen] = useState(false)
	const [placement, setPlacement] = useState<Placement | null>(null)
	const [selected, setSelected] = useState<string | null>(null)
	const [preview, setPreview] = useState<BoardObject | null>(null)
	const [saveOpen, setSaveOpen] = useState(false)
	const [name, setName] = useState('')
	const [pendingChange, setPendingChange] = useState<{ type: 'map' | 'load'; id: string } | null>(null)
	const viewport = useRef<HTMLDivElement>(null)
	const canvas = useRef<HTMLCanvasElement>(null)
	const gesture = useRef<Gesture | null>(null)
	const pointer = useRef<number | null>(null)
	const editable = connected && canEdit && !!board.map
	const mapId = board.map?.id

	function update(next: Board) {
		current.current = next
		setBoard(next)
	}

	useEffect(() => {
		function receive(message: ServerMessage) {
			const board = current.current
			if (message.type === 'snapshot') {
				if (message.board.epoch !== board.epoch) {
					gesture.current = null
					pointer.current = null
					setSelected(null)
					setPreview(null)
					setPendingChange(null)
				}
				update(message.board)
				setCanEdit(message.canEdit)
				setPlayers(message.players)
			} else if (message.type === 'access') setCanEdit(message.canEdit)
			else if (message.type === 'players') setPlayers(message.players)
			else if (message.type === 'error') setNotice(message.message)
			else if (message.type === 'saved') {
				if (message.revision === board.revision) update({ ...board, dirty: false })
				if (message.mapId === board.map?.id) {
					setPresetGeneration(value => value + 1)
					setNotice(`Тактика «${message.tactic.name}» сохранена.`)
				}
			} else {
				if (message.epoch !== board.epoch || message.revision !== board.revision + 1) {
					connection.current?.send({ type: 'sync' })
					return
				}
				const change = message.change
				let objects = board.objects
				if (change.type === 'remove') objects = objects.filter(object => object.id !== change.id)
				if (change.type === 'put') {
					const index = objects.findIndex(object => object.id === change.object.id)
					objects = [...objects]
					if (index < 0) objects.push(change.object)
					else objects[index] = change.object
				}
				if (change.type === 'points') objects = objects.map(object =>
					object.type === 'stroke' && object.id === change.id
						? { ...object, points: [...object.points, ...change.points] } : object)
				update({ ...board, objects, revision: message.revision, dirty: true })
			}
		}
		const active = connectActivity(receive, (text, ready) => {
			setStatus(text)
			setConnected(ready)
		})
		connection.current = active
		void active.start()
		return () => { active.stop(); connection.current = null }
	}, [])

	useEffect(() => {
		if (editable) return
		gesture.current = null
		pointer.current = null
		setPlacement(null)
		setPreview(null)
		setSelected(null)
		setSaveOpen(false)
		setPendingChange(null)
	}, [editable])

	useEffect(() => {
		if (!connected) return
		const signal = new AbortController()
		const timeout = window.setTimeout(() => {
			const query = new URLSearchParams({ search: search.trim() })
			void connection.current?.get(`maps?${query}`, signal.signal).then(async response => {
				const page = await response.json() as MapPage
				if (!signal.signal.aborted) {
					setMaps(page)
					setSearchLoaded(search)
				}
			}).catch(error => { if (!signal.signal.aborted) setNotice(error.message) })
		}, 160)
		return () => { signal.abort(); clearTimeout(timeout) }
	}, [connected, search, mapGeneration])

	useEffect(() => {
		if (!mapId || !connected) return
		const controller = new AbortController()
		let url: string | undefined
		setImageError('')
		void connection.current?.get(`maps/${mapId}/image`, controller.signal).then(async response => {
			const blob = await response.blob()
			if (controller.signal.aborted) return
			url = URL.createObjectURL(blob)
			setImage(url)
		}).catch(error => { if (!controller.signal.aborted) setImageError(error.message) })
		return () => {
			controller.abort()
			if (url) URL.revokeObjectURL(url)
			setImage('')
		}
	}, [mapId, connected, mapGeneration])

	useEffect(() => {
		if (!mapId || !connected) return
		const controller = new AbortController()
		void connection.current?.get(`maps/${mapId}/tactics`, controller.signal).then(async response => {
			const result = await response.json() as TacticInfo[]
			if (!controller.signal.aborted) setTactics(result)
		}).catch(error => { if (!controller.signal.aborted) setNotice(error.message) })
		return () => { controller.abort(); setTactics([]) }
	}, [mapId, connected, presetGeneration])

	useEffect(() => {
		if (!viewport.current) return
		const observer = new ResizeObserver(([entry]) => setViewportSize({
			width: entry.contentRect.width, height: entry.contentRect.height
		}))
		observer.observe(viewport.current)
		return () => observer.disconnect()
	}, [])

	useEffect(() => { setZoom(1) }, [mapId])
	const ratio = board.map ? board.map.width / board.map.height : 1
	const width = Math.max(1, Math.min(viewportSize.width, viewportSize.height * ratio) * zoom)
	const height = Math.max(1, width / ratio)
	const pixelScale = Math.min(window.devicePixelRatio || 1, 4096 / Math.max(width, height))

	useEffect(() => {
		const target = canvas.current
		if (!target) return
		const frame = requestAnimationFrame(() => paint(target, preview
			? [...board.objects.filter(object => object.id !== preview.id), preview]
			: board.objects, selected))
		return () => cancelAnimationFrame(frame)
	}, [board.objects, preview, selected, width, height, pixelScale, image])

	function send(message: ClientMessage) {
		if (!connection.current?.send(message)) setNotice('Нет связи с доской.')
	}

	function edit(operation: Edit) {
		send({ ...operation, epoch: current.current.epoch })
	}

	function place(item: Placement, at: Point) {
		const id = crypto.randomUUID()
		if ('shape' in item) edit({ type: 'shape', id, shape: item.shape, at, color })
		else edit({ type: 'player', id, userId: item.userId, at })
		setPlacement(null)
		setFiguresOpen(false)
		setTool('select')
	}

	function point(event: { clientX: number; clientY: number }): Point {
		const bounds = canvas.current!.getBoundingClientRect()
		const clamp = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100000) / 100000
		return [clamp((event.clientX - bounds.left) / bounds.width), clamp((event.clientY - bounds.top) / bounds.height)]
	}

	function down(event: PointerEvent<HTMLCanvasElement>) {
		if (pointer.current !== null || event.button !== 0) return
		if ((!editable || tool === 'pan') && viewport.current) {
			gesture.current = { kind: 'pan', x: event.clientX, y: event.clientY,
				left: viewport.current.scrollLeft, top: viewport.current.scrollTop }
		} else {
			const at = point(event)
			if (placement) return place(placement, at)
			if (tool === 'brush') {
				const id = crypto.randomUUID()
				const stroke: Stroke = { type: 'stroke', id, color, width: brush, points: [at] }
				edit({ type: 'stroke', id, color, width: brush, point: at })
				gesture.current = { kind: 'stroke', stroke, sent: 1, last: performance.now() }
				setPreview(stroke)
			} else {
				const object = hit(current.current.objects, at, width, height)
				if (tool === 'erase') {
					if (object) edit({ type: 'remove', id: object.id })
					return
				}
				setSelected(object?.id ?? null)
				if (!object || object.type === 'stroke') return
				gesture.current = { kind: 'move', object }
			}
		}
		pointer.current = event.pointerId
		event.currentTarget.setPointerCapture(event.pointerId)
	}

	function flush(active: Extract<Gesture, { kind: 'stroke' }>) {
		const { stroke } = active
		for (let i = active.sent; i < stroke.points.length; i += 64)
			edit({ type: 'points', id: stroke.id, points: stroke.points.slice(i, i + 64) })
		active.sent = stroke.points.length
		active.last = performance.now()
	}

	function move(event: PointerEvent<HTMLCanvasElement>) {
		if (pointer.current !== event.pointerId) return
		const active = gesture.current
		if (active?.kind === 'pan') {
			viewport.current?.scrollTo(active.left + active.x - event.clientX, active.top + active.y - event.clientY)
		} else if (editable && active?.kind === 'move') {
			setPreview({ ...active.object, at: point(event) })
		} else if (editable && active?.kind === 'stroke') {
			active.stroke.points.push(point(event))
			setPreview({ ...active.stroke })
			if (performance.now() - active.last >= 32) flush(active)
		}
	}

	function end(event: PointerEvent<HTMLCanvasElement>, canceled = false) {
		if (pointer.current !== event.pointerId) return
		const active = gesture.current
		if (editable && active?.kind === 'stroke') flush(active)
		if (editable && !canceled && active?.kind === 'move' && preview?.id === active.object.id)
			edit({ type: 'move', id: active.object.id, at: point(event) })
		gesture.current = null
		pointer.current = null
		setPreview(null)
	}

	function drop(event: DragEvent) {
		event.preventDefault()
		if (!editable) return
		const shape = event.dataTransfer.getData('application/x-revento-shape') as Shape
		const userId = event.dataTransfer.getData('application/x-revento-player')
		if (shapes.includes(shape)) place({ shape }, point(event))
		else if (players.some(player => player.id === userId)) place({ userId }, point(event))
	}

	function switchBoard(type: 'map' | 'load', id: string) {
		setPanel(null)
		setSaveOpen(false)
		if (current.current.dirty) setPendingChange({ type, id })
		else send({ type, id, revision: current.current.revision })
	}

	function show(which: 'maps' | 'players') {
		setPanel(value => value === which ? null : which)
	}

	return <main className='activity' data-panel={panel ?? ''}>
		<header>
			<button className='panel-toggle' onClick={() => show('maps')} aria-label='Карты'><Map size={18} /></button>
			<strong>Доска тактик</strong>
			<span className='map-title'>{board.map?.name}</span>
			<span className='connection' data-live={connected}>{connected ? (canEdit ? 'Редактирование' : 'Просмотр') : status}</span>
			{!connected && <button onClick={() => void connection.current?.start()}>Подключиться</button>}
			<button className='panel-toggle' onClick={() => show('players')} aria-label='Состав'><Users size={18} /></button>
		</header>
		<aside className='maps'>
			<div className='aside-title'>Карты <button title='Обновить карты' onClick={() => setMapGeneration(value => value + 1)}><RotateCcw size={14} /></button></div>
			<input type='search' aria-label='Поиск карты' placeholder='Найти карту' value={search} maxLength={100}
				onChange={event => setSearch(event.target.value)} />
			<div className='list'>
				{searchLoaded === search && maps.maps.map(map => <button key={map.id} disabled={!canEdit || !connected}
					aria-current={map.id === mapId} onClick={() => { if (map.id !== mapId) switchBoard('map', map.id) }}>
					{map.name}{map.archived && <small>Архив</small>}
				</button>)}
				{searchLoaded === search && !maps.maps.length && <p>Карты не найдены.</p>}
				{searchLoaded === search && maps.next && <button onClick={async () => {
					try {
						const query = new URLSearchParams({ search: search.trim(), cursor: maps.next! })
						const response = await connection.current!.get(`maps?${query}`)
						const next = await response.json() as MapPage
						setMaps(current => current.next === maps.next ? { maps: [...current.maps, ...next.maps], next: next.next } : current)
					} catch (error) { setNotice((error as Error).message) }
				}}>Ещё карты</button>}
			</div>
			{mapId && <section className='presets'>
				<div className='aside-title'>Тактики</div>
				{!tactics.length && <p>Сохранённых тактик нет.</p>}
				<div className='list'>
					{tactics.map(tactic => <button key={tactic.id} disabled={!editable} onClick={() => switchBoard('load', tactic.id)}>{tactic.name}</button>)}
				</div>
			</section>}
		</aside>
		<div className='editor'>
			{editable && <div className='toolbar' aria-label='Инструменты'>
				{Object.entries(tools).map(([id, { icon: Icon, label }]) => <button key={id} title={label} aria-label={label}
					aria-pressed={!placement && tool === id} onClick={() => { setTool(id as keyof typeof tools); setPlacement(null) }}>
					<Icon size={18} />
				</button>)}
				<div className='figure-menu'>
					<button title='Фигуры' aria-label='Фигуры' aria-expanded={figuresOpen} onClick={() => setFiguresOpen(value => !value)}>
						<Shapes size={18} />
					</button>
					{figuresOpen && <div className='figure-list'>
						{shapes.map(shape => {
							const { icon: Icon, label } = figures[shape]
							return <button key={shape} draggable title={label} aria-label={label}
								aria-pressed={!!placement && 'shape' in placement && placement.shape === shape}
								onDragStart={event => event.dataTransfer.setData('application/x-revento-shape', shape)}
								onClick={() => { setPlacement({ shape }); setFiguresOpen(false) }}><Icon size={18} /></button>
						})}
					</div>}
				</div>
				<div className='brushes' aria-label='Размер кисти'>
					{brushWidths.map((size, index) => <button key={size} title={['Маленькая кисть', 'Средняя кисть', 'Большая кисть'][index]}
						aria-label={['Маленькая кисть', 'Средняя кисть', 'Большая кисть'][index]}
						aria-pressed={brush === size} onClick={() => { setBrush(size); setTool('brush'); setPlacement(null) }}>
						<span style={{ width: 5 + index * 5, height: 5 + index * 5 }} />
					</button>)}
				</div>
				<div className='colors' aria-label='Цвет кисти'>
					{palette.map(value => <button key={value} style={{ background: value }} title={value} aria-label={`Цвет ${value}`}
						aria-pressed={color === value} onClick={() => setColor(value)} />)}
					<input type='color' title='Произвольный цвет' aria-label='Произвольный цвет' value={color}
						onChange={event => setColor(event.target.value)} />
				</div>
				<button title='Сохранить тактику' aria-label='Сохранить тактику' onClick={() => { setPendingChange(null); setSaveOpen(value => !value) }}>
					<Save size={18} />
				</button>
			</div>}
			<div className='workspace'>
				<div ref={viewport} className='viewport'>
					{board.map && image ? <div className='scene' style={{ width, height }}>
						<img src={image} alt={board.map.name} draggable={false} onError={() => setImageError('Не удалось открыть изображение карты.')} />
						<canvas ref={canvas} width={Math.max(1, Math.round(width * pixelScale))}
							height={Math.max(1, Math.round(height * pixelScale))}
							data-tool={placement ? 'place' : editable ? tool : 'pan'} aria-label='Зарисовки на карте'
							onPointerDown={down} onPointerMove={move} onPointerUp={end}
							onPointerCancel={event => end(event, true)} onLostPointerCapture={event => end(event, true)}
							onDragOver={event => { if (editable) event.preventDefault() }} onDrop={drop} />
					</div> : <div className='empty'>
						<Map size={34} />
						<p>{imageError || (board.map ? 'Загрузка карты…' : canEdit ? 'Выберите карту слева' : 'Ожидаем выбора карты редактором')}</p>
					</div>}
				</div>
				{!!image && <div className='zoom'>
					<button title='Приблизить' aria-label='Приблизить' onClick={() => setZoom(value => Math.min(4, value * 1.25))}><Plus size={17} /></button>
					<button title='Отдалить' aria-label='Отдалить' onClick={() => setZoom(value => Math.max(1, value / 1.25))}><Minus size={17} /></button>
					<button title='Сбросить масштаб' aria-label='Сбросить масштаб' onClick={() => setZoom(1)}><RotateCcw size={16} /></button>
					<small>{Math.round(zoom * 100)}%</small>
				</div>}
				{(pendingChange || saveOpen) && <div className='board-dialog'>
					{pendingChange ? <>
						<p>Заменить текущую доску? Несохранённые изменения будут потеряны.</p>
						<button onClick={() => {
							send({ ...pendingChange, revision: current.current.revision })
							setPendingChange(null)
						}}>Заменить</button>
						<button onClick={() => setPendingChange(null)}>Отмена</button>
					</> : <form onSubmit={event => {
						event.preventDefault()
						if (!name.trim()) return
						send({ type: 'save', name: name.trim(), revision: current.current.revision })
						setSaveOpen(false)
						setName('')
					}}>
						<label>Название тактики <input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
						<button type='submit'>Сохранить</button>
						<button type='button' onClick={() => setSaveOpen(false)}>Отмена</button>
					</form>}
				</div>}
				{(notice || placement) && <div role='status' className='notice'>
					{placement ? 'Укажите место на карте.' : notice}
					<button aria-label='Закрыть уведомление' onClick={() => { setNotice(''); setPlacement(null) }}>×</button>
				</div>}
			</div>
		</div>
		<aside className='players'>
			<div className='aside-title'>Состав <span>{players.length}</span></div>
			<div className='list'>
				{players.map(player => <button key={player.id} disabled={!editable} draggable={editable}
					aria-pressed={!!placement && 'userId' in placement && placement.userId === player.id}
					onDragStart={event => event.dataTransfer.setData('application/x-revento-player', player.id)}
					onClick={() => { setPlacement({ userId: player.id }); setPanel(null) }}>{player.name}</button>)}
			</div>
			{connected && !players.length && <p>Голосовой канал пуст.</p>}
		</aside>
	</main>
}

createRoot(document.getElementById('root')!).render(<Activity />)
