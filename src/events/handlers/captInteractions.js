const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  MessageFlags,
} = require("discord.js");
const {
  parseDateTime,
  getDiscordTimestamp,
} = require("../../commands/utility/parseDateTime");
const naborManager = require("../../commands/utility/naborManager");

// 1. Старая кнопка — только время
async function showCaptModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("modal_capt_base")
    .setTitle("Регистрация на капт");
  const timeInput = new TextInputBuilder()
    .setCustomId("capt_time")
    .setLabel("Время проведения")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Например: 18:00 или 29.08.2026 18:00")
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(timeInput));
  return await interaction.showModal(modal);
}

// 2. Новая кнопка — время + цель + количество участников
async function showExtendedCaptModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("modal_capt_extended")
    .setTitle("Расширенная регистрация");

  const timeInput = new TextInputBuilder()
    .setCustomId("capt_time")
    .setLabel("Время проведения")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Например: 18:00 или 29.08.2026 18:00")
    .setRequired(true);

  const targetInput = new TextInputBuilder()
    .setCustomId("capt_target")
    .setLabel("Цель проведения")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Например: Захват фабрики / Защита территорий")
    .setRequired(true);

  const countInput = new TextInputBuilder()
    .setCustomId("capt_count")
    .setLabel("Количество участников в основе")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("По умолчанию: 20")
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(timeInput),
    new ActionRowBuilder().addComponents(targetInput),
    new ActionRowBuilder().addComponents(countInput),
  );
  return await interaction.showModal(modal);
}

// 3. Общий обработчик отправки формы
async function submitCaptModal(interaction) {
  const customId = interaction.customId; // 'modal_capt_base' или 'modal_capt_extended'

  const timeInput = interaction.fields.getTextInputValue("capt_time").trim();
  const parsedDate = parseDateTime(timeInput);

  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return await interaction.reply({
      content:
        "❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const discordTimestamp = getDiscordTimestamp(parsedDate);

  // Значения по умолчанию для обычного капта
  let target = null;
  let maxMain = 20;

  // Если форма расширенная — собираем дополнительные данные
  if (customId === "modal_capt_extended") {
    target = interaction.fields.getTextInputValue("capt_target").trim();
    const countInput = interaction.fields
      .getTextInputValue("capt_count")
      .trim();

    if (countInput) {
      const parsedCount = parseInt(countInput, 10);
      if (!isNaN(parsedCount) && parsedCount > 0) {
        maxMain = parsedCount;
      } else {
        return await interaction.reply({
          content:
            "❌ Количество участников должно быть целым положительным числом.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  }

  await interaction
    .reply({
      content: `✅ Набор успешно создан и отправлен в канал! Время: ${discordTimestamp}`,
      flags: MessageFlags.Ephemeral,
    })
    .catch(console.error);

  try {
    // Передаем дополнительные параметры в менеджер наборов
    await naborManager.sendNabor(
      interaction,
      discordTimestamp,
      target,
      maxMain,
    );
  } catch (error) {
    console.error("Ошибка при отправке набора:", error);
  }
}

module.exports = { showCaptModal, showExtendedCaptModal, submitCaptModal };
