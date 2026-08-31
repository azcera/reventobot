const { createChannel } = require("../commands/utility/createChannel");
const {
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");
require("dotenv").config();

const {
  parseDateTime,
  getDiscordTimestamp,
} = require("../commands/utility/parseDateTime");
const naborManager = require("../commands/utility/naborManager");

module.exports = (client) => {
  client.on("interactionCreate", async (interaction) => {
    // 1. Быстрая обработка кнопок набора
    if (
      interaction.isButton() &&
      ["nabor_join", "nabor_leave"].includes(interaction.customId)
    ) {
      return await naborManager.handleNaborInteraction(interaction);
    }

    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    const guild = interaction.guild;
    if (!guild) return;

    // 2. ОБРАБОТКА НАЖАТИЙ НА КНОПКИ
    if (interaction.isButton()) {
      const [action, name, stat, memberID] = interaction.customId.split("_");

      // Отмена создания архива
      if (action === "cancel") {
        return await interaction.message
          .delete()
          .catch((err) => console.error("Ошибка удаления:", err));
      }

      // Создание группы (Модалка)
      if (action === "group") {
        const modal = new ModalBuilder()
          .setCustomId("modal_group")
          .setTitle("Создание группы");

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

        modal.addComponents(
          new ActionRowBuilder().addComponents(timeInput),
          new ActionRowBuilder().addComponents(targetInput),
          new ActionRowBuilder().addComponents(codeInput),
        );

        return await interaction.showModal(modal);
      }

      // Создание капта (Модалка)
      if (action === "capt") {
        const modal = new ModalBuilder()
          .setCustomId("modal_capt")
          .setTitle("Создание регистрации на капт");
        const timeInput = new TextInputBuilder()
          .setCustomId("capt_time")
          .setLabel("Время проведения")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Например: 18:00 или 29.08.2026 18:00")
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(timeInput));
        return await interaction.showModal(modal);
      }

      // Действия создания архива по кнопке из логов ролей
      if (action === "create" || action === "cancelcreate") {
        const targetMemberID = name; // В данном случае во вторых кнопках передается ID
        if (action === "cancelcreate") {
          return await interaction.message.delete().catch(() => {});
        }

        const member = targetMemberID
          ? await guild.members.fetch(targetMemberID).catch(() => null)
          : null;
        if (!member) {
          return interaction.reply({
            content: "Пользователь не найден.",
            flags: MessageFlags.Ephemeral,
          });
        }

        await interaction.message.delete().catch(() => {});
        return await createChannel(interaction, { channelName: stat, member }); // В stat передается сгенерированное имя
      }
    }

    // 3. ОБРАБОТКА МОДАЛЬНЫХ ОКНО
    if (interaction.isModalSubmit()) {
      const modalId = interaction.customId;

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
              "❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`.",
            flags: MessageFlags.Ephemeral,
          });
        }

        const discordTimestamp = getDiscordTimestamp(parsedDate);
        const discordTimestampWith5Min = getDiscordTimestamp(parsedDate, 300);

        await interaction
          .reply({
            content: `Группа создана!\nВремя: ${discordTimestamp}\nЦель: ${target}\nКод: ${code}`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(console.error);

        try {
          const pingChannelId = process.env.PING_CHANNEL_ID;
          const mentionedRoleId = process.env.MENTIONED_ROLE;
          if (!pingChannelId)
            return console.log(
              "Ошибка: В файле .env не указан PING_CHANNEL_ID",
            );

          const pingChannel =
            interaction.client.channels.cache.get(pingChannelId) ||
            (await interaction.client.channels
              .fetch(pingChannelId)
              .catch(() => null));
          if (!pingChannel)
            return console.log(
              `Ошибка: Канал с ID ${pingChannelId} не найден.`,
            );

          const roleMention = mentionedRoleId ? `<@&${mentionedRoleId}> ` : "";
          const msgContent = `# 📢 ${roleMention} Групп на \`${target}\` в ${discordTimestamp}, проверка явки в ${discordTimestampWith5Min}. 🔑 Код группы: \`${code}\``;

          // Вместо спама тремя сообщениями отправляем одно красивое с тремя пингами внутри (или дублируем текст в одном)
          await pingChannel.send(`${msgContent}\n${msgContent}\n${msgContent}`);
        } catch (error) {
          console.error("Не удалось отправить сообщения в пинг-канал:", error);
        }
        return;
      }

      if (modalId === "modal_capt") {
        const timeInput = interaction.fields
          .getTextInputValue("capt_time")
          .trim();
        const parsedDate = parseDateTime(timeInput);

        if (!parsedDate || isNaN(parsedDate.getTime())) {
          return await interaction.reply({
            content:
              "❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`.",
            flags: MessageFlags.Ephemeral,
          });
        }

        const discordTimestamp = getDiscordTimestamp(parsedDate);

        await interaction
          .reply({
            content: `✅ Набор успешно создан и отправлен в канал! Время: ${discordTimestamp}`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(console.error);

        try {
          await naborManager.sendNabor(interaction, discordTimestamp);
        } catch (error) {
          console.error("Ошибка при отправке набора:", error);
        }
        return;
      }
    }
  });
};
