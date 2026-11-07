const path = require('node:path')
const dotenv = require('dotenv')
const { readConfig, fetchMembers, checkMembers } = require('../src/services/majesticClient')

async function main() {
	dotenv.config({ path: path.join(__dirname, '..', '.env.majestic.local'), quiet: true })
	const result = await checkMembers(readConfig(process.env))
	console.log(`Состав получен полностью: ${result.total} участников.`)
	console.log(JSON.stringify(result.examples, null, 2))
}

if (require.main === module) main().catch(error => {
	console.error(error.message)
	process.exitCode = 1
})

module.exports = { readConfig, fetchMembers, checkMembers }
