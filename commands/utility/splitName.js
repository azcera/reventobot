function splitName(nickname) {
    const splittedName = nickname.split(' | ');
    if (splittedName.length < 2) return null;

    return {
        name: splittedName[0].toLowerCase(),
        stat: splittedName[1],
    };
}

module.exports = { splitName };
