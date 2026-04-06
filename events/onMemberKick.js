const { AuditLogEvent } = require("discord.js");
const { splitName } = require("../commands/utility/splitName");
require("dotenv").config();

module.exports = (client) => {
  client.on("guildMemberRemove", async (member) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      const fetchedLogs = await member.guild.fetchAuditLogs({
        limit: 1,
        type: AuditLogEvent.MemberKick,
      });

      const kickLog = fetchedLogs.entries.first();

      if (kickLog && kickLog.target.id === member.id) {
        console.log(`${member.user.tag} был кикнут.`);

        const updateLogs = await member.guild.fetchAuditLogs({
          limit: 10, // берем несколько последних записей
          type: AuditLogEvent.MemberUpdate,
          targetId: member.id, // фильтруем по конкретному пользователю
        });
        const nickChangeLog = updateLogs.entries.find((entry) =>
          entry.changes.some((change) => change.key === "nick"),
        );

        let finalNickname;

        if (nickChangeLog) {
          // Берем "новое" значение из последнего изменения ника
          const nickChange = nickChangeLog.changes.find(
            (c) => c.key === "nick",
          );
          finalNickname = nickChange.new || nickChange.old;
        } else {
          // Если логов изменения ника нет, используем displayName (текущий в кэше)
          finalNickname = member.nickname || member.displayName;
        }

        const kickedUser = kickLog.target;

        const nameToSplit =
          member.displayName || kickedUser.globalName || kickedUser.username;
        const splittedData = splitName(finalNickname);
        console.log(`Name:  ${nameToSplit}, finalNickname: ${finalNickname}`);
        if (!splittedData) return;

        const channelName = `archive-${splittedData.name}-${splittedData.stat}`;
        const existingChannel = member.guild.channels.cache.find(
          (ch) => ch.name === channelName,
        );

        if (existingChannel) {
          await existingChannel.delete("Пользователь был кикнут с сервера");
        } else {
          console.log(`Канал для ${member.user.tag} не создан.`);
        }
      }
    } catch (error) {
      console.error("Ошибка при проверке логов или удалении канала:", error);
    }
  });
};
