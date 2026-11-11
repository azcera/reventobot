const prefixes = ['[𝐃𝐞𝐩] ', '[𝐇𝐢𝐠𝐡] ', '[𝐑𝐞𝐜] ']

function defaultRolePrefixes(adminRoleIds: string[]) {
	return adminRoleIds.slice(0, prefixes.length).map((roleId, index) => ({ roleId, prefix: prefixes[index].trim() }))
}

function adminPrefix(roleIds: string[], adminRoleIds: string[], rolePrefixes?: import('../types').RolePrefix[]) {
	const entries = Array.isArray(rolePrefixes) ? rolePrefixes : defaultRolePrefixes(adminRoleIds)
	const entry = entries.find(item => roleIds.includes(item.roleId))
	return entry ? `${entry.prefix.trim()} ` : ''
}

export { adminPrefix, defaultRolePrefixes }
