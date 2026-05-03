require("dotenv").config();

module.exports = async (client, message) => {
  if (message.channel.id !== process.env.PLUS_CHANNEL_ID) return;

  if (message.author.bot && message.author.id !== client.user.id) {
    try {
      const roleId = process.env.AUTO_ROLE;
      for (let i = 0; i < 3; i++) {
        await message.channel.send({
          content: `<@&${roleId}> рега выше`,
          allowedMentions: { roles: [roleId] },
        });
      }
    } catch (error) {
      console.error("Ошибка при отправке сообщения:", error);
    }
  }
  return;
};
