import type { ReactNode } from 'react'

type PageLayoutProps = {
	title?: string
	description?: string
	actions?: ReactNode
	header?: ReactNode
	headerVisible?: boolean
	inert?: boolean
	standalone?: boolean
	children: ReactNode
}

export function PageLayout({ title, description, actions, header, headerVisible = true, inert, standalone = false, children }: PageLayoutProps) {
	return <main className={standalone ? 'login-screen' : 'main-content'} inert={inert}>
		{header && <header className={`topbar ${headerVisible ? 'topbar-visible' : ''}`}>{header}</header>}
		<div className={standalone ? 'standalone-content' : 'page-content'}>
			{title && <div className="page-heading"><div><p className="eyebrow mb-2 lg:hidden">REVENTO / панель управления</p><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="flex shrink-0 gap-2">{actions}</div>}</div>}
			{children}
		</div>
	</main>
}
