const prefixes = ['[𝐃𝐞𝐩] ', '[𝐇𝐢𝐠𝐡] ', '[𝐑𝐞𝐜] ']

function adminPrefix(roleIds, adminRoleIds) {
	const index = adminRoleIds.findIndex(id => roleIds.includes(id))
	return prefixes[index] || ''
}

module.exports = { adminPrefix }
