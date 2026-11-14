import { useEffect } from 'react'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

export function useMotion(enabled: boolean) {
	useEffect(() => {
		const root = document.documentElement
		const aura = document.querySelector<HTMLElement>('.cursor-aura')
		const reduced = matchMedia('(prefers-reduced-motion: reduce)')
		const pointer = matchMedia('(any-hover: hover) and (any-pointer: fine)')
		let mouseSeen = false
		let lenis: Lenis | undefined
		let frame = 0, scrollFrame = 0, navigationFrame = 0
		let lastPaint = 0, lastScrollTime = 0, scrollTime = 0
		let surface: HTMLElement | null = null
		let tilt: HTMLElement | null = null
		let rect: DOMRect | null = null
		let x = 0, y = 0
		const allowed = () => enabled && !reduced.matches && !document.hidden
		const clearSurface = () => {
			surface?.classList.remove('is-lit')
			for (const property of ['--light-x', '--light-y', '--light-angle', '--tilt-x', '--tilt-y']) surface?.style.removeProperty(property)
			surface = null; tilt = null; rect = null
		}
		const reset = () => {
			cancelAnimationFrame(frame); frame = 0; lastPaint = 0; clearSurface()
			aura?.style.removeProperty('transform')
			if (root.dataset.cursor !== 'off') root.dataset.cursor = 'off'
		}
		const paint = (time: number) => {
			// Coalesce pointer events and cap expensive local highlights at 30 Hz.
			if (time - lastPaint < 1000 / 30) { frame = requestAnimationFrame(paint); return }
			frame = 0; lastPaint = time
			if (!allowed()) return
			if (root.dataset.cursor !== 'on') root.dataset.cursor = 'on'
			if (aura) aura.style.transform = `translate3d(${Math.round(x - 180)}px, ${Math.round(y - 180)}px, 0)`
			if (!surface || !rect) return
			surface.style.setProperty('--light-x', `${Math.round(x - rect.left)}px`)
			surface.style.setProperty('--light-y', `${Math.round(y - rect.top)}px`)
			surface.style.setProperty('--light-angle', `${Math.round(115 + (x - rect.left) / rect.width * 35 - (y - rect.top) / rect.height * 20)}deg`)
			if (tilt) {
				tilt.style.setProperty('--tilt-x', `${Math.max(-4, Math.min(4, -(y - rect.top - rect.height / 2) / rect.height * 8)).toFixed(1)}deg`)
				tilt.style.setProperty('--tilt-y', `${Math.max(-4, Math.min(4, (x - rect.left - rect.width / 2) / rect.width * 8)).toFixed(1)}deg`)
			}
		}
		const move = (event: PointerEvent) => {
			if (!allowed() || event.pointerType === 'touch' || !['mouse', 'pen'].includes(event.pointerType)) return
			// Hybrid Windows devices can report the primary pointer as coarse even with a mouse.
			mouseSeen = true
			if (root.dataset.effects !== 'on') root.dataset.effects = 'on'
			x = event.clientX; y = event.clientY
			const inside = tilt && rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
			const next = inside ? surface : event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tilt], .panel, .overview-hero, .binding-strip, .login-card') : null
			if (next !== surface) {
				clearSurface(); surface = next
				if (surface) { rect = surface.getBoundingClientRect(); if (surface.hasAttribute('data-tilt')) rect = new DOMRect(rect.left + (rect.width - surface.offsetWidth) / 2, rect.top + (rect.height - surface.offsetHeight) / 2, surface.offsetWidth, surface.offsetHeight); surface.classList.add('is-lit'); tilt = surface.hasAttribute('data-tilt') ? surface : null }
			}
			if (!frame) frame = requestAnimationFrame(paint)
		}
		const scrollTick = (time: number) => {
			scrollFrame = 0
			if (!lenis || document.hidden) return
			// A virtual clock avoids a large first delta after an idle period.
			scrollTime += lastScrollTime ? Math.min(time - lastScrollTime, 50) : 16
			lastScrollTime = time
			lenis.raf(scrollTime)
			if (lenis.isScrolling === 'smooth') scrollFrame = requestAnimationFrame(scrollTick)
		}
		const wakeScroll = () => {
			if (!scrollFrame && !document.hidden) { lastScrollTime = 0; scrollFrame = requestAnimationFrame(scrollTick) }
		}
		const navigate = () => {
			reset(); cancelAnimationFrame(navigationFrame)
			navigationFrame = requestAnimationFrame(() => { lenis?.resize(); if (lenis) lenis.scrollTo(0, { immediate: true }); else window.scrollTo({ top: 0, behavior: 'instant' }) })
		}
		const apply = () => {
			reset(); cancelAnimationFrame(scrollFrame); scrollFrame = 0; scrollTime = 0
			lenis?.destroy(); lenis = undefined
			const motion = allowed()
			root.dataset.reducedMotion = reduced.matches ? 'on' : 'off'
			root.dataset.motion = motion ? 'on' : 'off'
			root.dataset.effects = motion && (pointer.matches || mouseSeen) ? 'on' : 'off'
			if (motion) {
				lenis = new Lenis({ autoRaf: false, lerp: .09, syncTouch: false, autoToggle: true,
					prevent: node => Boolean(node.closest('dialog, .sidebar, .role-picker, .mention-menu, textarea, [contenteditable], pre')) })
				lenis.on('virtual-scroll', wakeScroll)
			}
		}
		apply()
		reduced.addEventListener('change', apply); pointer.addEventListener('change', apply)
		document.addEventListener('visibilitychange', apply)
		document.addEventListener('pointermove', move, { passive: true }); document.addEventListener('pointerleave', reset)
		window.addEventListener('blur', reset); window.addEventListener('resize', reset)
		window.addEventListener('scroll', reset, { passive: true }); window.addEventListener('hashchange', navigate)
		return () => {
			reset(); cancelAnimationFrame(scrollFrame); cancelAnimationFrame(navigationFrame); lenis?.destroy()
			reduced.removeEventListener('change', apply); pointer.removeEventListener('change', apply)
			document.removeEventListener('visibilitychange', apply)
			document.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', reset)
			window.removeEventListener('blur', reset); window.removeEventListener('resize', reset)
			window.removeEventListener('scroll', reset); window.removeEventListener('hashchange', navigate)
		}
	}, [enabled])
}
