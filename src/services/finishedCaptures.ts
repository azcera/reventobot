import { normalizeWar, rulesFromEnv, SERVER } from '../features/capture/familyWarData'
import type { RawWar } from '../features/capture/familyWarTypes'
import type { Env } from '../types'

export async function fetchFinishedCaptures(
	key: string,
	env: Env,
	fetchImpl = fetch
) {
	const response = await fetchImpl(
		`https://api.majestic-files.net/v1/ext/family-wars/${SERVER}`,
		{
			headers: { Accept: 'application/json', 'x-api-key': key },
			signal: AbortSignal.timeout(20000),
			redirect: 'error'
		}
	)
	if (!response.ok) throw new Error(`Family Wars HTTP ${response.status}`)
	const data = await response.json() as {
		code: number
		status: boolean
		result?: { serverId: string; captures: RawWar[] }
	}
	if (
		data.code !== 200 || data.status !== true || data.result?.serverId !== SERVER ||
		!Array.isArray(data.result.captures)
	) throw new Error('Неожиданный формат Family Wars API.')
	const rules = rulesFromEnv(env)
	return data.result.captures.flatMap(raw => {
		try {
			const war = normalizeWar(raw, rules)
			return war?.status === 'finished' && !war.neutral ? [war] : []
		} catch {
			return []
		}
	})
}
