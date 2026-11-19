import { createContext, useContext } from 'react'
import type { Setter } from '../types'

type Draft = { value: unknown; baseline: string }
export type FormDrafts = Record<string, Draft>
export const FormDraftContext = createContext<{
	drafts: FormDrafts
	setDrafts: Setter<FormDrafts>
} | null>(null)

export function useFormDraft<T>(key: string, saved: T) {
	const registry = useContext(FormDraftContext)!
	const baseline = JSON.stringify(saved)
	const current = registry.drafts[key]
	const value = current ? (current.value as T) : saved
	function reset() {
		registry.setDrafts(previous => {
			const next = { ...previous }
			delete next[key]
			return next
		})
	}
	const setValue: Setter<T> = update =>
		registry.setDrafts(previous => {
			const draft = previous[key]
			const value = draft ? (draft.value as T) : saved
			const next =
				typeof update === 'function'
					? (update as (previous: T) => T)(value)
					: update
			const original = draft?.baseline ?? baseline
			const result = { ...previous }
			if (JSON.stringify(next) === original) delete result[key]
			else result[key] = { value: next, baseline: original }
			return result
		})
	return {
		value,
		setValue,
		reset,
		conflict: Boolean(current && current.baseline !== baseline)
	}
}
