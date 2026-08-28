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
const { parseDateTime } = require("./commands/utility/parseDateTime");

module.exports = (client) => {
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;

    // ОШИБКА 1 ИСПРАВЛЕНА: Извлекаем customId, только если это КНОПКА.
    // Если это модальное окно, split ИСКАЖАЛ action (например, "modal_capt-имя-стат-id" превращался в "modal_capt")
    let action, name, stat, memberID;
    if (interaction.isButton()) {
      [action, name, stat, memberID] = interaction.customId.split("-");
    }

    const guild = interaction.guild;
    if (!guild) return;

    // Проверку пользователя выполняем только для кнопок, где передается memberID
    if (interaction.isButton()) {
      const member = await guild.members.fetch(memberID).catch(() => null);
      if (!member)
        return interaction.reply({
          content: "Пользователь не найден.",
          flags: MessageFlags.Ephemeral,
        });

      if (action === "cancel_create_archive") {
        console.log("Создание архива отменено.");
        return await interaction.message
          .delete()
          .catch((err) => console.log("Не удалось удалить сообщение:", err));
      }

      if (action === "create_archive") {
        await interaction.message
          .delete()
          .catch((err) => console.log("Не удалось удалить сообщение:", err));
        return await createChannel(interaction, {
          channelName: `archive ${name} ${stat}`,
          member,
        });
      }

      if (action === "create_group") {
        const modal = new ModalBuilder()
          .setCustomId(`modal_group`)
          .setTitle("Создание группы");

        const timeInput = new TextInputBuilder()
          .setCustomId("group_time")
          .setLabel("Время проведения")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Например: 18:00 или 29.08.2026 18:00") // Обновили плейсхолдер
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
      } else if (action === "create_capt") {
        const modal = new ModalBuilder()
          .setCustomId(`modal_capt-${name}-${stat}-${memberID}`)
          .setTitle("Создание капта");

        const timeInput = new TextInputBuilder()
          .setCustomId("capt_time")
          .setLabel("Время капта")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Например: 20:30 или 29.08.2026 20:30") // Обновили плейсхолдер
          .setRequired(true);

        const firstRow = new ActionRowBuilder().addComponents(timeInput);

        modal.addComponents(firstRow);

        return await interaction.showModal(modal);
      }
    }

    // ОБРАБОТКА МОДАЛЬНЫХ ОКНО
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
              "❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ` (например, `29.08.2026 18:00`).",
            flags: MessageFlags.Ephemeral,
          });
        }

        const timestamp = Math.floor(parsedDate.getTime() / 1000);
        const discordTimestamp = `<t:${timestamp}:F>`;

        await interaction.reply({
          content: `Группа создана!\nВремя: ${discordTimestamp}\nЦель: ${target}\nКод: ${code}`,
          flags: MessageFlags.Ephemeral,
        });
      }

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

        const timestamp = Math.floor(parsedDate.getTime() / 1000);
        const discordTimestamp = `<t:${timestamp}:F>`;

        await interaction.reply({
          content: `Капт запланирован на ${discordTimestamp}`,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  });
};
