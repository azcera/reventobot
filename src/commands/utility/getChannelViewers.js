const { splitName } = require("./splitName");

// getChannelViewers.js
async function getChannelViewers(channel) {
  const members = channel.guild.members.cache;
  const data = [];

  members.forEach((member) => {
    if (!member) return;

    // проверяем права на просмотр канала
    if (channel.permissionsFor(member).has("ViewChannel")) {
      data.push(member);
    }
  });

  return data;
}

const findCallback = (stat) => (m) => {
  const nickname = m.displayName || m.user.username;
  if (!nickname || typeof nickname !== "string") return false;

  const parsed = splitName(nickname);
  if (!parsed) return false;

  return parsed.stat === stat;
};

async function getMemberByStat(channel, stat) {
  // Сначала ищем в кэше
  let member = channel.guild.members.cache.find(findCallback(stat));

  // Если не нашли — fetch
  if (!member) {
    try {
      const fetchedMembers = await channel.guild.members.fetch();
      member = fetchedMembers.find(findCallback(stat));
    } catch (err) {
      console.error("Ошибка при fetch участников:", err);
      return null;
    }
  }

  return member;
}

module.exports = { getChannelViewers, getMemberByStat };
