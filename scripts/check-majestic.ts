export {}
import path = require('node:path')
import dotenv = require('dotenv')
import { readConfig, fetchMembers, checkMembers } from '../src/services/majesticClient'
import { ROOT_PATH } from '../src/config/path'

async function main() {
	dotenv.config({ path: path.join(ROOT_PATH, '.env.majestic.local'), quiet: true })
	const result = await checkMembers(readConfig(process.env))
	console.log(`Состав получен полностью: ${result.total} участников.`)
	console.log(JSON.stringify(result.examples, null, 2))
}

if (require.main === module) main().catch(error => {
	console.error(error.message)
	process.exitCode = 1
})

export { readConfig, fetchMembers, checkMembers }
