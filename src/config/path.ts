import path = require('path')

const compiledRoot = path.resolve(__dirname, '..', '..')
const ROOT_PATH =
	path.basename(compiledRoot) === 'dist'
		? path.dirname(compiledRoot)
		: compiledRoot

/**
 * Экспортирует абсолютные пути к корню проекта и public независимо от cwd.
 */

const PUBLIC_PATH = path.join(ROOT_PATH, 'public')
export { PUBLIC_PATH, ROOT_PATH }
