const { MessageFlags } = require("discord.js");
const { createChannel } = require("../../utils/channelUtils");

async function cancelArchive(interaction) {
  return await interaction.message
    .delete()
    .catch((err) => console.error("Ошибка удаления:", err));
}

async function handleDynamicButtons(interaction) {
  if (interaction.customId.startsWith("cancelcreate")) {
    return await interaction.message.delete().catch(() => {});
  }

  if (interaction.customId.startsWith("create_")) {
    const rawData = interaction.customId.replace("create_", "");

    const idMatch = rawData.match(/\d{17,19}$/);
    const targetMemberID = idMatch ? idMatch[0] : null;

    if (!targetMemberID) {
      console.error(
        `[Ошибка парсинга ID] Не удалось найти Snowflake в строке: ${rawData}`,
      );
      return await interaction.reply({
        content: "❌ Ошибка: В кнопке не найден ID пользователя.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const rawChannelName = rawData.replace(`-${targetMemberID}`, "");

    const cleanedChannelName = rawChannelName.replace(/-/g, " ");

    const member = await interaction.guild.members
      .fetch(targetMemberID)
      .catch((err) => {
        console.error(
          `[Ошибка Fetch] Не удалось найти пользователя ${targetMemberID}:`,
          err.message,
        );
        return null;
      });

    if (!member) {
      return await interaction.reply({
        content: "❌ Пользователь не найден на сервере.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.message.delete().catch(() => {});

    return await createChannel(interaction, {
      channelName: cleanedChannelName,
      member,
    });
  }
}

module.exports = { cancelArchive, handleDynamicButtons };
