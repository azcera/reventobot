const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const {
  parseDateTime,
  getDiscordTimestamp,
} = require("../../commands/utility/parseDateTime");
const naborManager = require("../../commands/utility/naborManager");

async function showCaptModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("modal_capt")
    .setTitle("Создание реги");

  const timeLabel = new LabelBuilder()
    .setLabel("Время проведения")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("capt_time")
        .setPlaceholder("Например: 18:00 или 29.08.2026 18:00")
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    );
  const targetLabel = new LabelBuilder()
    .setLabel("Цель проведения")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("capt_target")
        .setPlaceholder("По умолчанию: КАПТ")
        .setStyle(TextInputStyle.Short)
        .setRequired(false),
    );
  const countLabel = new LabelBuilder()
    .setLabel("Количество участников в основе")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("capt_count")
        .setPlaceholder("По умолчанию: 20")
        .setStyle(TextInputStyle.Short)
        .setRequired(false),
    );

  modal.addLabelComponents(timeLabel, targetLabel, countLabel);
  return await interaction.showModal(modal);
}

// 3. Общий обработчик отправки формы
async function submitCaptModal(interaction) {
  const timeInput = interaction.fields.getTextInputValue("capt_time").trim();
  const parsedDate = parseDateTime(timeInput);

  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return await interaction.reply({
      content:
        "❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`.",
      flags: [MessageFlags.Ephemeral],
    });
  }

  const discordTimestamp = getDiscordTimestamp(parsedDate);

  let target =
    interaction.fields.getTextInputValue("capt_target").trim() ?? "капт";
  let maxMain = 20;

  const countInput = interaction.fields.getTextInputValue("capt_count").trim();

  if (countInput) {
    const parsedCount = parseInt(countInput, 10);
    if (!isNaN(parsedCount) && parsedCount > 0) {
      maxMain = parsedCount;
    } else {
      return await interaction.reply({
        content:
          "❌ Количество участников должно быть целым положительным числом.",
        flags: [MessageFlags.Ephemeral],
      });
    }
  }

  await interaction
    .reply({
      content: `✅ Набор успешно создан и отправлен в канал! Время: ${discordTimestamp}`,
      flags: [MessageFlags.Ephemeral],
    })
    .then(() => {
      setTimeout(async () => {
        await interaction.deleteReply().catch(() => {});
      }, 60000);
    })
    .catch(console.error);
  try {
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

module.exports = { showCaptModal, submitCaptModal };
