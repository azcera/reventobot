function splitName(nickname) {
  const splittedName = nickname.split(" | ");
  if (splittedName.length < 2) return null;

  const match = nickname.match(/(?:\] )?([^|]+)/);

  return {
    name: match
      ? match[1].toLowerCase().trim()
      : splittedName[0].toLowerCase().trim(),
    stat: splittedName[1].trim(),
  };
}

module.exports = { splitName };
