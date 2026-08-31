const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, MessageFlags } = require("discord.js");
const { parseDateTime, getDiscordTimestamp } = require("../../commands/utility/parseDateTime");
const naborManager = require("../../commands/utility/naborManager");

async function showCaptModal(interaction) {
  const modal = new ModalBuilder().setCustomId("modal_capt").setTitle("Создание регистрации на капт");
  const timeInput = new TextInputBuilder()
    .setCustomId("capt_time")
    .setLabel("Время проведения")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Например: 18:00 или 29.08.2026 18:00")
    .setRequired(true);

  modal.addComponents(new ActionRowBuilder().addComponents(timeInput));
  return await interaction.showModal(modal);
}

async function submitCaptModal(interaction) {
  const timeInput = interaction.fields.getTextInputValue("capt_time").trim();
  const parsedDate = parseDateTime(timeInput);

  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return await interaction.reply({
      content: "❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const discordTimestamp = getDiscordTimestamp(parsedDate);

  await interaction.reply({
    content: `✅ Набор успешно создан и отправлен в канал! Время: ${discordTimestamp}`,
    flags: MessageFlags.Ephemeral,
  }).catch(console.error);

  try {
    await naborManager.sendNabor(interaction, discordTimestamp);
  } catch (error) {
    console.error("Ошибка при отправке набора:", error);
  }
}

module.exports = { showCaptModal, submitCaptModal };
