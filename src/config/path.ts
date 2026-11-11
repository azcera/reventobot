import type * as D from 'discord.js'
import type * as T from '../types'
import type * as E from 'express'
import type * as Pg from 'pg'
import path = require('path')

const compiledRoot = path.resolve(__dirname, '..', '..')
const ROOT_PATH = path.basename(compiledRoot) === 'dist' ? path.dirname(compiledRoot) : compiledRoot

/**
 * Экспортирует абсолютные пути к корню проекта и public независимо от cwd.
 */

const PUBLIC_PATH = path.join(ROOT_PATH, 'public')
export { ROOT_PATH, PUBLIC_PATH }
