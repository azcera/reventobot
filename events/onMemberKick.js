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

        const splittedData = splitName(member.displayName);
        console.log(
          `Splitted Data: ${splittedData.name}, ${splittedData.stat} `,
        );
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
