function splitName(nickname) {
  // Разделяем на части по ' | '
  const splittedName = nickname.split(" | ");
  if (splittedName.length < 2) return null;

  const match = splittedName[0].match(/[A-Za-z]+/);

  return {
    name: match
      ? match[1].trim().toLowerCase()
      : splittedName[0].trim().toLowerCase(),
    stat: splittedName[1].trim(),
  };
}

module.exports = { splitName };
