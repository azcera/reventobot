const { createHash } = require('node:crypto')

module.exports = (id, field) => 'panel.row.' + createHash('sha256').update(String(id)).digest('hex').slice(0, 16) + '.' + field
