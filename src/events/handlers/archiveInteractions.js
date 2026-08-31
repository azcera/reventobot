const { MessageFlags } = require("discord.js");
const { createChannel } = require("../../commands/utility/createChannel");

async function cancelArchive(interaction) {
  return await interaction.message
    .delete()
    .catch((err) => console.error("Ошибка удаления:", err));
}

async function handleDynamicButtons(interaction) {
  // Проверяем, с чего начинается customId кнопки
  if (interaction.customId.startsWith("cancelcreate")) {
    return await interaction.message.delete().catch(() => {});
  }

  if (interaction.customId.startsWith("create_")) {
    // Убираем префикс "create_", оставляя "archive-yung-289229-474636543789629440"
    const rawData = interaction.customId.replace("create_", "");

    // Находим ID пользователя (последовательность из 17-19 цифр в самом конце строки)
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

    // Получаем имя канала, отрезая дефис и ID пользователя с конца строки
    // Из "archive-yung-289229-474636543789629440" получаем "archive-yung-289229"
    const rawChannelName = rawData.replace(`-${targetMemberID}`, "");

    // Заменяем все дефисы на пробелы: из "archive-yung-289229" получаем "archive yung 289229"
    const cleanedChannelName = rawChannelName.replace(/-/g, " ");

    // Ищем пользователя на сервере
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
        content: "Пользователь не найден на сервере.",
        flags: MessageFlags.Ephemeral,
      });
    }

    // Удаляем сообщение с кнопкой
    await interaction.message.delete().catch(() => {});

    // Отправляем очищенное имя "archive yung 289229" и объект пользователя в утилиту
    return await createChannel(interaction, {
      channelName: cleanedChannelName,
      member,
    });
  }
}

module.exports = { cancelArchive, handleDynamicButtons };
