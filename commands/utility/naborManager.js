const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const activeNabors = new Map();
const MAX_MAIN_SEATS = 20;

function createNaborEmbed(time, mainList, reserveList, leftList = []) {
  const embed = new EmbedBuilder()
    .setTitle("📢 Сбор на капт!")
    .setDescription(
      `**Время проведения:** ${time}\n\nНажимайте кнопки ниже, чтобы записаться или выписаться.`,
    )
    .setColor("#2f3136")
    .setTimestamp();

  embed.addFields({
    name: `👥 Основной состав (${mainList.length}/${MAX_MAIN_SEATS})`,
    value:
      mainList.length > 0
        ? mainList.map((id, i) => `${i + 1}. <@${id}>`).join("\n")
        : "_Список пуст_",
  });

  if (reserveList.length > 0) {
    embed.addFields({
      name: `⏳ Резерв (${reserveList.length})`,
      value: reserveList.map((id, i) => `${i + 1}. <@${id}>`).join("\n"),
    });
  }

  if (leftList.length > 0) {
    embed.addFields({
      name: `🚪 Покинули набор (${leftList.length})`,
      value: leftList.map((id, i) => `${i + 1}. <@${id}>`).join("\n"),
    });
  }

  return embed;
}

function createNaborButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("nabor_join")
      .setLabel("Присоединиться")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("nabor_leave")
      .setLabel("Выйти")
      .setStyle(ButtonStyle.Danger),
  );
}

module.exports = {
  async sendNabor(interaction, time) {
    const plusChannelId = process.env.PLUS_CHANNEL_ID;
    const mentionedRoleId = process.env.MENTIONED_ROLE;

    if (!plusChannelId)
      return console.error("Ошибка: В .env не указан PLUS_CHANNEL_ID");

    const channel =
      interaction.client.channels.cache.get(plusChannelId) ||
      (await interaction.client.channels
        .fetch(plusChannelId)
        .catch(() => null));
    if (!channel)
      return console.error(`Ошибка: Канал ${plusChannelId} не найден.`);

    const roleMention = mentionedRoleId
      ? `<@&${mentionedRoleId}>`
      : "@everyone";
    const msg = await channel.send({
      content: roleMention,
      embeds: [createNaborEmbed(time, [], [], [])],
      components: [createNaborButtons()],
    });

    activeNabors.set(msg.id, {
      time,
      mainList: [],
      reserveList: [],
      leftList: [],
    });

    // Оптимизация: Отправляем три пинга одной строкой, а не тремя запросами к API
    const followUpText = `${roleMention} рега выше`;
    await channel
      .send({ content: `${followUpText}\n${followUpText}\n${followUpText}` })
      .catch(console.error);
  },

  async handleNaborInteraction(interaction) {
    const { customId, user, message } = interaction;
    if (!activeNabors.has(message.id)) {
      return interaction.reply({
        content: "❌ Этот набор устарел или бот был перезапущен.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const nabor = activeNabors.get(message.id);
    const userId = user.id;
    if (!nabor.leftList) nabor.leftList = [];

    if (customId === "nabor_join") {
      if (
        nabor.mainList.includes(userId) ||
        nabor.reserveList.includes(userId)
      ) {
        return interaction.reply({
          content: "❌ Вы уже записаны!",
          flags: MessageFlags.Ephemeral,
        });
      }

      const inLeft = nabor.leftList.indexOf(userId);
      if (inLeft !== -1) nabor.leftList.splice(inLeft, 1);

      if (nabor.mainList.length < MAX_MAIN_SEATS) {
        nabor.mainList.push(userId);
        await interaction.reply({
          content: "✅ Вы записаны в **основной состав**!",
          flags: MessageFlags.Ephemeral,
        });
      } else {
        nabor.reserveList.push(userId);
        await interaction.reply({
          content: "⚠️ Мест нет. Вы добавлены в **резерв**.",
          flags: MessageFlags.Ephemeral,
        });
      }
    }

    if (customId === "nabor_leave") {
      const inMain = nabor.mainList.indexOf(userId);
      const inReserve = nabor.reserveList.indexOf(userId);

      if (inMain === -1 && inReserve === -1) {
        return interaction.reply({
          content: "❌ Вас нет в списках.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (inMain !== -1) {
        nabor.mainList.splice(inMain, 1);
        if (nabor.reserveList.length > 0)
          nabor.mainList.push(nabor.reserveList.shift());
      } else {
        nabor.reserveList.splice(inReserve, 1);
      }

      if (!nabor.leftList.includes(userId)) nabor.leftList.push(userId);
      await interaction.reply({
        content: "ℹ️ Вы успешно выписались.",
        flags: MessageFlags.Ephemeral,
      });
    }

    activeNabors.set(message.id, nabor);
    await message
      .edit({
        embeds: [
          createNaborEmbed(
            nabor.time,
            nabor.mainList,
            nabor.reserveList,
            nabor.leftList,
          ),
        ],
      })
      .catch(console.error);
  },
};
