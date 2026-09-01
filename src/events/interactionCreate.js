const { MessageFlags } = require("discord.js");
const naborManager = require("../commands/utility/naborManager");
const groupInteractions = require("./handlers/groupInteractions");
const captInteractions = require("./handlers/captInteractions");
const archiveInteractions = require("./handlers/archiveInteractions");
const moveAllInteractions = require("./handlers/moveAllInteractions");
const inviteCandidate = require("./handlers/inviteCandidate");
const inviteAdmin = require("./handlers/inviteAdmin");

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
      return await naborManager.handleButton(interaction);
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
        return await inviteAdmin.handleVoiceSelect(interaction);
    }

    // buttons

    if (interaction.isButton()) {
      if (customId === "open_invite_modal")
        return await inviteCandidate.showModal(interaction);
      if (customId.startsWith("invite_"))
        return await inviteAdmin.handleButtons(interaction);
      if (customId.startsWith("capt_")) {
        return await captInteractions.handleAutoCaptButton(interaction);
      }
      if (customId === "group")
        return await groupInteractions.showGroupSelect(interaction);
      if (customId === "capt")
        return await captInteractions.showCaptModal(interaction);

      if (customId === "moveall")
        return await moveAllInteractions.showMoveAllSelect(interaction);
      if (customId === "cancel")
        return await archiveInteractions.cancelArchive(interaction);
      if (customId.includes("_"))
        return await archiveInteractions.handleDynamicButtons(interaction);
    }

    if (interaction.isModalSubmit()) {
      if (customId === "invite_modal_submit")
        return await inviteCandidate.submitModal(interaction);
      if (customId.startsWith("invite_modal_reject_"))
        return await inviteAdmin.submitRejectModal(interaction);
      if (customId.startsWith("modal_group_"))
        return await groupInteractions.submitGroupModal(interaction);
      if (interaction.customId === "modal_capt")
        await captInteractions.submitCaptModal(interaction);
    }
  });
};
