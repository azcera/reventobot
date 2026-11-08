import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import { AlertCircle, BookOpen, Check, CheckCircle2, Info, LoaderCircle, X } from 'lucide-react'

export function Button({ icon: Icon, children, variant = 'secondary', className = '', loading = false, disabled, ...props }) {
	return <button type="button" className={`button button-${variant} ${className}`} disabled={disabled || loading} {...props}>
		{loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : Icon && <Icon aria-hidden="true" />}{children}
	</button>
}

export function IconButton({ icon: Icon, label, className = '', ...props }) {
	return <button type="button" aria-label={label} className={`icon-button group ${className}`} {...props}>
		<Icon aria-hidden="true" /><span role="tooltip" className="icon-tooltip">{label}</span>
	</button>
}

export function Panel({ title, action, children, className = '', ...props }) {
	return <section className={`panel ${className}`} {...props}>
		{title && <div className="panel-heading"><h2>{title}</h2>{action}</div>}{children}
	</section>
}

export function Field({ label, hint, children, className = '' }) {
	const id = useId()
	return <div className={`grid min-w-0 gap-2 ${className}`}><label htmlFor={id} className="field-label">{label}</label>
		{React.cloneElement(children, { id, 'aria-describedby': hint ? id + '-hint' : undefined })}
		{hint && <p id={id + '-hint'} className="field-hint">{hint}</p>}
	</div>
}

export function Empty({ icon: Icon = Info, title, children }) {
	return <div className="empty-state"><Icon aria-hidden="true" /><h3>{title}</h3>{children && <p>{children}</p>}</div>
}

export function Loading({ children = 'Загружаем данные…' }) {
	return <div role="status" className="flex items-center justify-center gap-3 py-16 text-muted"><LoaderCircle className="size-5 animate-spin" aria-hidden="true" />{children}</div>
}

const ModalContext = createContext(null)
export const useModal = () => useContext(ModalContext)

function Modal({ item, dismiss }) {
	const ref = useRef(null)
	const titleId = useId()
	const descriptionId = useId()
	useEffect(() => {
		const dialog = ref.current
		const previous = document.activeElement
		dialog.showModal()
		return () => { dialog.close(); if (previous?.isConnected) previous.focus() }
	}, [])
	const Icon = item.kind === 'error' ? AlertCircle : item.kind === 'guide' ? BookOpen : item.kind === 'success' ? CheckCircle2 : Info
	return <dialog ref={ref} aria-labelledby={titleId} aria-describedby={item.message ? descriptionId : undefined}
		className={`modal modal-${item.kind || 'info'}`} onCancel={event => { event.preventDefault(); dismiss(false) }}
		onClick={event => {
			if (event.target !== ref.current) return
			const rect = ref.current.getBoundingClientRect()
			if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dismiss(false)
		}}>
		<div className="relative p-6 sm:p-8">
			<IconButton icon={X} label="Закрыть окно" className="modal-close absolute right-4 top-4" onClick={() => dismiss(false)} />
			<div className="modal-glyph"><Icon aria-hidden="true" /></div>
			<h2 id={titleId} className="mb-3 pr-7 text-xl font-semibold tracking-tight">{item.title}</h2>
			{item.message && <p id={descriptionId} className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{item.message}</p>}
			{typeof item.content === 'function' ? item.content({ close: () => dismiss(false) }) : item.content}
			<div className="mt-7 flex flex-wrap justify-end gap-2">
				{item.confirm && <Button onClick={() => dismiss(false)}>Отмена</Button>}
				<Button variant={item.danger ? 'danger' : 'primary'} icon={item.confirm ? undefined : Check} onClick={() => dismiss(true)}>{item.confirm || 'Понятно'}</Button>
			</div>
		</div>
	</dialog>
}

export function ModalProvider({ children }) {
	const [queue, setQueue] = useState([])
	const counter = useRef(0)
	const show = useCallback(options => new Promise(resolve => {
		setQueue(previous => [...previous, { ...options, id: ++counter.current, resolve }])
	}), [])
	const dismiss = value => {
		queue[0].resolve(value)
		setQueue(previous => previous.slice(1))
	}
	return <ModalContext.Provider value={show}>{children}{queue[0] && <Modal key={queue[0].id} item={queue[0]} dismiss={dismiss} />}</ModalContext.Provider>
}
