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

findCallback = (m) => {
  splitName(m).stat === stat;
};

async function getMemberByStat(channel, stat) {
  // Сначала ищем в кэше
  let member = channel.guild.members.cache.find(findCallback);

  // Если не нашли — fetch по кэшу Discord, чтобы получить участника
  if (!member) {
    try {
      // Получаем всех участников с правом доступа к каналу
      const fetchedMembers = await channel.guild.members.fetch();
      member = fetchedMembers.find(findCallback);
    } catch (err) {
      console.error("Ошибка при fetch участников:", err);
      return null;
    }
  }

  return member;
}

module.exports = { getChannelViewers, getMemberByStat };
