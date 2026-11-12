export const templateVariableName = /^[a-zA-Zа-яА-ЯёЁ][a-zA-Zа-яА-ЯёЁ0-9_-]{0,63}$/

export function replaceTemplateVariables(source: string, custom: Record<string, string>, runtime: Record<string, unknown> = {}) {
	return source.replace(/\{([a-zA-Zа-яА-ЯёЁ][a-zA-Zа-яА-ЯёЁ0-9_-]*)\}/g, (match, name: string) =>
		Object.hasOwn(runtime, name) ? String(runtime[name]) : Object.hasOwn(custom, name) ? custom[name] : match)
}
