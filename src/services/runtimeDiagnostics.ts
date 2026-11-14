import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import type { Pool } from 'pg'

// Local logs only: periodic measurements must not produce Telegram alerts.
export function startRuntimeDiagnostics(pool: Pick<Pool, 'totalCount' | 'idleCount' | 'waitingCount'>) {
	const delay = monitorEventLoopDelay({ resolution: 20 })
	delay.enable()
	let previous = performance.eventLoopUtilization()
	const timer = setInterval(() => {
		const current = performance.eventLoopUtilization()
		const utilization = performance.eventLoopUtilization(current, previous)
		previous = current
		console.log('[Runtime]', {
			uptimeSeconds: Math.round(process.uptime()),
			eventLoopMaxMs: Math.round(delay.max / 1e6),
			eventLoopP99Ms: Math.round(delay.percentile(99) / 1e6),
			eventLoopUtilization: Number(utilization.utilization.toFixed(3)),
			rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
			pool: { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount }
		})
		delay.reset()
	}, 60000)
	timer.unref()
	return () => { clearInterval(timer); delay.disable() }
}
