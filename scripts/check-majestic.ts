export {}
import path = require('node:path')
import dotenv = require('dotenv')
import { ROOT_PATH } from '../src/config/path'
import {
	checkMembers,
	fetchMembers,
	readConfig
} from '../src/services/majesticClient'

async function main() {
	dotenv.config({
		path: path.join(ROOT_PATH, '.env.majestic.local'),
		quiet: true
	})
	const result = await checkMembers(readConfig(process.env))
	console.log(`Состав получен полностью: ${result.total} участников.`)
	console.log(JSON.stringify(result.examples, null, 2))
}

if (require.main === module)
	main().catch(error => {
		console.error(error.message)
		process.exitCode = 1
	})

export { checkMembers, fetchMembers, readConfig }
