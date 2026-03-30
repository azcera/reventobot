function splitName(nickname) {
  const splittedName = nickname.split(" | ");
  if (splittedName.length < 2) return null;

  match = nickname.match(/(?:\] )?([^|]+)/);
  return {
    name: match ? match[1].trim() : splittedName[0].toLowerCase(),
    stat: splittedName[1],
  };
}

module.exports = { splitName };
