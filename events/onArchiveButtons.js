const { createChannel } = require("../commands/utility/createChannel");
const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
require("dotenv").config();

// Убедитесь, что путь к файлу указан верно относительно этого скрипта
const {
  parseDateTime,
  getDiscordTimestamp,
} = require("../commands/utility/parseDateTime");

const naborManager = require("../commands/utility/naborManager");

module.exports = (client) => {
  client.on("interactionCreate", async (interaction) => {
    // Добавляем обработку кнопок участников "Присоединиться/Выйти"
    if (
      interaction.isButton() &&
      (interaction.customId === "nabor_join" ||
        interaction.customId === "nabor_leave")
    ) {
      return await naborManager.handleNaborInteraction(interaction);
    }

    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    const guild = interaction.guild;
    if (!guild) return;

    // ОБРАБОТКА НАЖАТИЙ НА КНОПКИ
    if (interaction.isButton()) {
      const [action, name, stat, memberID] = interaction.customId.split("-");

      // -----------------------------------------------------------------
      // КАТЕГОРИЯ 1: Действия, для которых НЕ нужен пользователь (member)
      // -----------------------------------------------------------------

      // Отмена создания архива (просто удаляем сообщение)
      if (action === "cancel_create_archive") {
        console.log("Создание архива отменено.");
        return await interaction.message
          .delete()
          .catch((err) => console.log("Не удалось удалить сообщение:", err));
      }

      // Создание группы (открытие модалки)
      if (action === "create_group") {
        const modal = new ModalBuilder()
          .setCustomId(`modal_group`)
          .setTitle("Создание группа");

        const timeInput = new TextInputBuilder()
          .setCustomId("group_time")
          .setLabel("Время проведения")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Например: 18:00 или 29.08.2026 18:00")
          .setRequired(true);

        const targetInput = new TextInputBuilder()
          .setCustomId("group_target")
          .setLabel("Цель (выберите из списка)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Дроп, дилеры, цеха, ограбы")
          .setRequired(true);

        const codeInput = new TextInputBuilder()
          .setCustomId("group_code")
          .setLabel("Код группы")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Введите код...")
          .setRequired(true);

        const firstRow = new ActionRowBuilder().addComponents(timeInput);
        const secondRow = new ActionRowBuilder().addComponents(targetInput);
        const thirdRow = new ActionRowBuilder().addComponents(codeInput);

        modal.addComponents(firstRow, secondRow, thirdRow);

        return await interaction.showModal(modal);
      }

      // КНОПКА СОЗДАНИЯ КАПТА
      if (action === "create_capt") {
        const modal = new ModalBuilder()
          .setCustomId(`modal_capt`)
          .setTitle("Создание реги на капт");

        const timeInput = new TextInputBuilder()
          .setCustomId("capt_time")
          .setLabel("Время проведения")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Например: 18:00 или 29.08.2026 18:00")
          .setRequired(true);

        const firstRow = new ActionRowBuilder().addComponents(timeInput);
        modal.addComponents(firstRow);

        return await interaction.showModal(modal);
      }

      // -----------------------------------------------------------------
      // КАТЕГОРИЯ 2: Действия, где пользователь (member) ОБЯЗАТЕЛЕН
      // -----------------------------------------------------------------

      // Запрашиваем пользователя, только если в ID кнопки был передан memberID
      const member = memberID
        ? await guild.members.fetch(memberID).catch(() => null)
        : null;

      // Если дошли сюда, а пользователя нет — выводим ошибку
      if (!member) {
        return interaction.reply({
          content: "Пользователь не найден.",
          flags: MessageFlags.Ephemeral,
        });
      }

      // Создание архива
      if (action === "create_archive") {
        await interaction.message
          .delete()
          .catch((err) => console.log("Не удалось удалить сообщение:", err));
        return await createChannel(interaction, {
          channelName: `archive ${name} ${stat}`,
          member,
        });
      }
    }

    // ОБРАБОТКА МОДАЛЬНЫХ ОКОН
    if (interaction.isModalSubmit()) {
      const modalId = interaction.customId;

      // Модалка группы
      if (modalId === "modal_group") {
        const timeInput = interaction.fields
          .getTextInputValue("group_time")
          .trim();
        const target = interaction.fields.getTextInputValue("group_target");
        const code = interaction.fields.getTextInputValue("group_code");

        const parsedDate = parseDateTime(timeInput);

        if (!parsedDate || isNaN(parsedDate.getTime())) {
          return await interaction.reply({
            content:
              "❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ` (например, `29.08.2026 18:00`).",
            flags: MessageFlags.Ephemeral,
          });
        }

        const discordTimestamp = getDiscordTimestamp(parsedDate);
        const discordTimestampWith5Min = getDiscordTimestamp(parsedDate, -300);

        await interaction.reply({
          content: `Группа создана!\nВремя: ${discordTimestamp}\nЦель: ${target}\nКод: ${code}`,
          flags: MessageFlags.Ephemeral,
        });

        try {
          const pingChannelId = process.env.PING_CHANNEL_ID;
          const mentionedRoleId = process.env.MENTIONED_ROLE;

          if (!pingChannelId) {
            return console.log(
              "Ошибка: В файле .env не указан PING_CHANNEL_ID",
            );
          }

          const pingChannel =
            interaction.client.channels.cache.get(pingChannelId) ||
            (await interaction.client.channels
              .fetch(pingChannelId)
              .catch(() => null));

          if (!pingChannel) {
            return console.log(
              `Ошибка: Канал с ID ${pingChannelId} не найден.`,
            );
          }
          const roleMention = mentionedRoleId ? `<@&${mentionedRoleId}> ` : "";

          await pingChannel.send(
            `# 📢 ${roleMention} Групп на \`${target}\` в ${discordTimestamp}, проверка явки в ${discordTimestampWith5Min}. 🔑 Код группы: \`${code}\``,
          );
        } catch (error) {
          console.error("Не удалось отправить сообщения в пинг-канал:", error);
        }

        return;
      }

      // Модалка капта
      if (modalId.startsWith("modal_capt")) {
        const timeInput = interaction.fields
          .getTextInputValue("capt_time")
          .trim();

        const parsedDate = parseDateTime(timeInput);

        if (!parsedDate || isNaN(parsedDate.getTime())) {
          return await interaction.reply({
            content:
              "❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ` (например, `29.08.2026 20:30`).",
            flags: MessageFlags.Ephemeral,
          });
        }

        const discordTimestamp = getDiscordTimestamp(parsedDate);

        await naborManager.sendNabor(interaction, discordTimestamp);

        return await interaction.reply({
          content: `✅ Набор успешно создан и отправлен в канал! Время: ${discordTimestamp}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  });
};
