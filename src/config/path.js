const path = require('path')

const ROOT_PATH = path.join(__dirname, '..', '..')

/**
 * Экспортирует абсолютные пути к корню проекта, папке изображений и public.
 * Используется для корректной загрузки локальных файлов (картинок) независимо от cwd.
 */

module.exports = {
	ROOT_PATH,
	IMAGES_PATH: path.join(ROOT_PATH, 'src', 'images'),
	PUBLIC_PATH: path.join(ROOT_PATH, 'public')
}
