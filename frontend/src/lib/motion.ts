import { useEffect } from 'react'
import Lenis from 'lenis'
import 'lenis/dist/lenis.css'

export function useMotion(enabled: boolean) {
	useEffect(() => {
		const root = document.documentElement
		const reduced = matchMedia('(prefers-reduced-motion: reduce)')
		const pointer = matchMedia('(hover: hover) and (pointer: fine)')
		let lenis: Lenis | undefined
		let frame = 0, navigationFrame = 0
		let surface: HTMLElement | null = null
		let tilt: HTMLElement | null = null
		let rect: DOMRect | null = null
		let x = innerWidth / 2, y = innerHeight / 2
		let lightX = x, lightY = y, rx = 0, ry = 0, targetRx = 0, targetRy = 0
		const clearSurface = () => {
			surface?.classList.remove('is-lit')
			for (const property of ['--light-x', '--light-y', '--light-angle']) surface?.style.removeProperty(property)
			tilt?.style.removeProperty('--tilt-x'); tilt?.style.removeProperty('--tilt-y')
			surface = null; tilt = null; rect = null; rx = 0; ry = 0; targetRx = 0; targetRy = 0
		}
		const reset = () => {
			cancelAnimationFrame(frame); frame = 0; clearSurface()
			for (const property of ['--cursor-x', '--cursor-y', '--drift-x', '--drift-y']) root.style.removeProperty(property)
			root.dataset.cursor = 'off'
		}
		const tick = () => {
			lightX += (x - lightX) * .16; lightY += (y - lightY) * .16
			rx += (targetRx - rx) * .14; ry += (targetRy - ry) * .14
			root.style.setProperty('--cursor-x', `${lightX}px`); root.style.setProperty('--cursor-y', `${lightY}px`)
			root.style.setProperty('--drift-x', `${(lightX / innerWidth - .5) * 60}px`)
			root.style.setProperty('--drift-y', `${(lightY / innerHeight - .5) * 60}px`)
			if (surface && rect) {
				surface.style.setProperty('--light-x', `${x - rect.left}px`); surface.style.setProperty('--light-y', `${y - rect.top}px`)
				surface.style.setProperty('--light-angle', `${115 + (x - rect.left) / rect.width * 35 - (y - rect.top) / rect.height * 20}deg`)
			}
			if (tilt) { tilt.style.setProperty('--tilt-x', `${rx}deg`); tilt.style.setProperty('--tilt-y', `${ry}deg`) }
			frame = Math.abs(x - lightX) + Math.abs(y - lightY) + Math.abs(rx - targetRx) + Math.abs(ry - targetRy) > .1 ? requestAnimationFrame(tick) : 0
		}
		const move = (event: PointerEvent) => {
			if (root.dataset.effects !== 'on' || event.pointerType === 'touch') return
			x = event.clientX; y = event.clientY
			const next = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tilt], .panel, .overview-hero, .binding-strip, .login-card') : null
			if (next !== surface) {
				clearSurface(); surface = next
				if (surface) {
					rect = surface.getBoundingClientRect(); surface.classList.add('is-lit')
					tilt = surface.hasAttribute('data-tilt') ? surface : null
				}
			}
			if (tilt && rect) {
				targetRx = Math.max(-12, Math.min(12, -(y - rect.top - rect.height / 2) / rect.height * 24))
				targetRy = Math.max(-12, Math.min(12, (x - rect.left - rect.width / 2) / rect.width * 24))
			}
			root.dataset.cursor = 'on'
			if (!frame) frame = requestAnimationFrame(tick)
		}
		const navigate = () => {
			reset()
			// Let React expose the next page before measuring its scroll height.
			cancelAnimationFrame(navigationFrame)
			navigationFrame = requestAnimationFrame(() => { lenis?.resize(); if (lenis) lenis.scrollTo(0, { immediate: true }); else window.scrollTo({ top: 0, behavior: 'instant' }) })
		}
		const apply = () => {
			reset(); lenis?.destroy(); lenis = undefined
			const motion = enabled && !reduced.matches
			root.dataset.motion = motion ? 'on' : 'off'
			root.dataset.effects = motion && pointer.matches ? 'on' : 'off'
			if (motion) lenis = new Lenis({
				autoRaf: true, lerp: .09, syncTouch: false, autoToggle: true,
				prevent: node => Boolean(node.closest('dialog, .sidebar, .role-picker, .mention-menu, textarea, [contenteditable], pre'))
			})
		}
		apply()
		reduced.addEventListener('change', apply); pointer.addEventListener('change', apply)
		document.addEventListener('pointermove', move, { passive: true }); document.addEventListener('pointerleave', reset)
		window.addEventListener('blur', reset); window.addEventListener('resize', reset)
		window.addEventListener('scroll', reset, { passive: true }); window.addEventListener('hashchange', navigate)
		return () => {
			reset(); cancelAnimationFrame(navigationFrame); lenis?.destroy()
			reduced.removeEventListener('change', apply); pointer.removeEventListener('change', apply)
			document.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', reset)
			window.removeEventListener('blur', reset); window.removeEventListener('resize', reset)
			window.removeEventListener('scroll', reset); window.removeEventListener('hashchange', navigate)
		}
	}, [enabled])
}
