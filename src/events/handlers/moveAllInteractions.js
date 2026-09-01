const {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
  MessageFlags,
} = require("discord.js");

async function showMoveAllSelect(interaction) {
  const guild = interaction.guild;

  const voiceChannels = guild.channels.cache.filter(
    (channel) => channel.type === 2 && channel.name.includes("🔊"),
  );

  voiceChannels.sort((a, b) => a.name.localeCompare(b.name));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("move_all_channel")
    .setPlaceholder("Выберите канал для перемещения...")
    .addOptions(
      voiceChannels.map((channel) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(channel.name)
          .setValue(channel.id),
      ),
    );

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: "Пожалуйста, выберите канал для перемещения из списка ниже:",
    components: [row],
    flags: [MessageFlags.Ephemeral],
  });
}

async function handleMoveAllSelect(interaction) {
  if (interaction.customId !== "move_all_channel") return;

  const targetChannelId = interaction.values[0];
  const guild = interaction.guild;

  const targetChannel = guild.channels.cache.get(targetChannelId);

  if (!targetChannel) {
    return interaction.reply({
      content: "❌ Выбранный канал не найден.",
      flags: [MessageFlags.Ephemeral],
    });
  }

  if (!guild.members.me.permissions.has("MoveMembers")) {
    return interaction.reply({
      content: "❌ У бота нет прав «Перемещение участников» на этом сервере.",
      flags: [MessageFlags.Ephemeral],
    });
  }

  await interaction.reply({
    content: `Начинаю перемещение всех участников в канал **${targetChannel.name}**...`,
    flags: [MessageFlags.Ephemeral],
  });

  const otherVoiceChannels = guild.channels.cache.filter(
    (channel) => channel.type === 2 && channel.id !== targetChannelId,
  );

  let movedCount = 0;

  for (const [_, channel] of otherVoiceChannels) {
    for (const [_, member] of channel.members) {
      try {
        await member.voice.setChannel(targetChannel);
        movedCount++;
      } catch (error) {
        console.error(`❌ Не удалось переместить ${member.user.tag}:`, error);
      }
    }
  }

  await interaction.followUp({
    content: `✅ Успешно перемещено участников: **${movedCount}**`,
    flags: [MessageFlags.Ephemeral],
  });
}

module.exports = { showMoveAllSelect, handleMoveAllSelect };
