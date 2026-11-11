import catalog = require('./templates.json')
export type TemplateText = (key: string, variables?: Record<string, unknown>) => string
export const templateText: TemplateText = (key, variables = {}) => {
	const field = (catalog as Record<string, { default: string }>)[key]
	if (!field) throw new Error('Unknown template: ' + key)
	return field.default.replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, name: string) => Object.hasOwn(variables, name) ? String(variables[name]) : match)
}
