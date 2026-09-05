const { MessageFlags } = require("discord.js");
const captureManager = require("../features/capture/captureManager");
const groupInteractions = require("../features/capture/groupInteractions");
const captureInteractions = require("../features/capture/captureInteractions");
const archiveInteractions = require("../features/archive/archiveInteractions");
const moveAllInteractions = require("../features/moveAll/moveAllInteractions");
const inviteApplication = require("../features/invite/inviteApplication");
const {
  handleModerationButton,
} = require("../features/invite/inviteModeration");
const { handleVoiceSelect } = require("../features/invite/inviteVoiceSelect");

module.exports = (client) => {
  client.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      try {
        await command.execute(interaction);
      } catch (error) {
        console.error(error);
        const payload = {
          content: "Произошла ошибка при запуске команды!",
          flags: MessageFlags.Ephemeral,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      }
      return;
    }

    if (
      interaction.isButton() &&
      ["capt_join", "capt_leave"].includes(interaction.customId)
    ) {
      return await captureManager.handleButton(interaction);
    }

    if (
      !interaction.isButton() &&
      !interaction.isModalSubmit() &&
      !interaction.isStringSelectMenu()
    )
      return;

    const guild = interaction.guild;
    if (!guild) return;

    const customId = interaction.customId;

    // selects

    if (interaction.isStringSelectMenu()) {
      if (customId === "group_select_target")
        return await groupInteractions.showGroupModal(interaction);
      if (customId === "move_all_channel")
        return await moveAllInteractions.handleMoveAllSelect(interaction);
      if (customId.startsWith("invite_select_voice_"))
        return await handleVoiceSelect(interaction);
    }

    // buttons

    if (interaction.isButton()) {
      if (customId === "open_invite_modal")
        return await inviteApplication.showModal(interaction);
      if (customId.startsWith("invite_"))
        return await handleModerationButton(interaction);

      if (customId === "capt_edit_time_trigger") {
        return await captureInteractions.handleInlineEditTimeButton(
          interaction,
        );
      }

      if (customId.startsWith("capt_")) {
        return await captureInteractions.handleAutoCaptButton(interaction);
      }

      if (customId === "group")
        return await groupInteractions.showGroupSelect(interaction);
      if (customId === "capt")
        return await captureInteractions.showCaptModal(interaction);

      if (customId === "moveall")
        return await moveAllInteractions.showMoveAllSelect(interaction);
      if (customId === "cancel")
        return await archiveInteractions.cancelArchive(interaction);
      if (customId.includes("_"))
        return await archiveInteractions.handleDynamicButtons(interaction);
    }

    // modals

    if (interaction.isModalSubmit()) {
      if (customId === "modal_inline_edit_time") {
        return await captureInteractions.submitInlineEditTimeModal(interaction);
      }

      if (customId === "invite_modal_submit")
        return await inviteApplication.submitModal(interaction);
      if (customId.startsWith("invite_modal_reject_"))
        return await inviteAdmin.submitRejectModal(interaction);
      if (customId.startsWith("modal_group_"))
        return await groupInteractions.submitGroupModal(interaction);
      if (interaction.customId === "modal_capt")
        return await captureInteractions.submitCaptModal(interaction);
    }
  });
};
