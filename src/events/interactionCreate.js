const naborManager = require("../commands/utility/naborManager");
const groupInteractions = require("./handlers/groupInteractions");
const captInteractions = require("./handlers/captInteractions");
const archiveInteractions = require("./handlers/archiveInteractions");
const moveAllInteractions = require("./handlers/moveAllInteractions");

module.exports = (client) => {
  client.on("interactionCreate", async (interaction) => {
    // 1. Быстрая обработка кнопок набора
    if (
      interaction.isButton() &&
      ["capt_join", "capt_leave"].includes(interaction.customId)
    ) {
      return await naborManager.handleButton(interaction);
    }

    // ИСПРАВЛЕНИЕ: Добавляем разрешение для выпадающих списков (isStringSelectMenu)
    if (
      !interaction.isButton() &&
      !interaction.isModalSubmit() &&
      !interaction.isStringSelectMenu()
    )
      return;

    const guild = interaction.guild;
    if (!guild) return;

    const customId = interaction.customId;

    // 2. Обработка выпадающих списков (Добавленный блок)
    if (interaction.isStringSelectMenu()) {
      if (customId === "group_select_target") {
        return await groupInteractions.showGroupModal(interaction);
      }
      if (customId === "move_all_channel") {
        return await moveAllInteractions.handleMoveAllSelect(interaction);
      }
    }

    // 3. Обработка кнопок
    if (interaction.isButton()) {
      if (customId === "group")
        return await groupInteractions.showGroupSelect(interaction);
      if (customId === "capt")
        return await captInteractions.showCaptModal(interaction);
      if (customId === "moveall")
        return await moveAllInteractions.showMoveAllSelect(interaction);
      if (customId === "cancel")
        return await archiveInteractions.cancelArchive(interaction);

      // Динамические кнопки (содержат символы разделения)
      if (customId.includes("_")) {
        return await archiveInteractions.handleDynamicButtons(interaction);
      }
    }

    // 4. Обработка модальных окон
    if (interaction.isModalSubmit()) {
      if (customId.startsWith("modal_group_"))
        return await groupInteractions.submitGroupModal(interaction);

      if (customId === "modal_capt")
        return await captInteractions.submitCaptModal(interaction);
    }
  });
};
