const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  ActionRowBuilder,
  LabelBuilder,
} = require("discord.js");
const {
  parseDateTime,
  getMskTimeString,
} = require("../../commands/utility/parseDateTime");

const {
  getFilteredOptions,
  optionsMap,
} = require("../../commands/utility/groupOptions");

async function showGroupSelect(interaction) {
  // 1. Сразу говорим Discord, что мы обрабатываем запрос в фоновом режиме
  // Это продлевает жизнь взаимодействия до 15 минут
  await interaction
    .deferReply({ flags: [MessageFlags.Ephemeral] })
    .catch(console.error);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("group_select_target")
    .setPlaceholder("Выберите цель проведения...")
    .addOptions(getFilteredOptions());

  const row = new ActionRowBuilder().addComponents(selectMenu);

  const message = await interaction
    .editReply({
      content:
        "Пожалуйста, выберите цель создания группы из списка ниже (меню активно 1 минуту):",
      components: [row],
    })
    .catch(console.error);

  if (!message) return;

  const collector = message.createMessageComponentCollector({
    filter: (i) =>
      i.customId === "group_select_target" && i.user.id === interaction.user.id,
    time: 60000,
    max: 1,
  });

  collector.on("collect", () => {
    collector.stop("selected");
  });

  collector.on("end", async (collected, reason) => {
    if (reason === "time") {
      await interaction.deleteReply().catch(() => {
        console.log(
          "[Group Select] Не удалось удалить сообщение (возможно, оно уже было закрыто)",
        );
      });
    }
  });
}

async function showGroupModal(interaction) {
  const selectedTarget = interaction.values[0];

  const modal = new ModalBuilder()
    .setCustomId(`modal_group_${selectedTarget}`)
    .setTitle("Создание группы");

  const timeLabel = new LabelBuilder()
    .setLabel("Время проведения")
    .setDescription(
      "Указывать именно начало МП, время группа и проверки явки рассчитается само",
    )
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("group_time")
        .setPlaceholder("Например: 18:00 или 29.08.2026 18:00 ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    );
  const targetLabel = new LabelBuilder()
    .setLabel("Цель")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("group_target")
        .setPlaceholder("Например: ОСТРОВ, ОГРАБЛЕНИЯ, КОНТРАКТЫ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    );
  const codeLabel = new LabelBuilder()
    .setLabel("Код группы")
    .setTextInputComponent(
      new TextInputBuilder()
        .setCustomId("group_code")
        .setPlaceholder("По умолчанию: Нет")
        .setStyle(TextInputStyle.Short)
        .setRequired(false),
    );

  if (selectedTarget === "other") {
    modal.addLabelComponents(timeLabel, targetLabel, codeLabel);
  } else {
    modal.addLabelComponents(codeLabel);
  }

  return await interaction.showModal(modal);
}

async function submitGroupModal(interaction) {
  const selectedValue = interaction.customId.replace("modal_group_", "");
  let timeInput, target;

  if (selectedValue !== "other") {
    timeInput = optionsMap[selectedValue].time;
    target = optionsMap[selectedValue].target;
  } else {
    timeInput = interaction.fields.getTextInputValue("group_time").trim();
    target = interaction.fields.getTextInputValue("group_target");
  }

  const code = interaction.fields.getTextInputValue("group_code");

  const parsedDate = parseDateTime(timeInput);
  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return await interaction.reply({
      content:
        "❌ Неверный формат времени. Используйте `ЧЧ:ММ` или `ДД.ММ.ГГГГ ЧЧ:ММ`.",
      flags: [MessageFlags.Ephemeral],
    });
  }

  const mskTimeStr = getMskTimeString(parsedDate, -600);
  const mskTimeWith5MinStr = getMskTimeString(parsedDate, -300);

  await interaction
    .reply({
      content: `✅ Группа создана!\nВремя: ${mskTimeStr}\nЦель: ${target}\nКод: ${code}`,
      flags: [MessageFlags.Ephemeral],
    })
    .then(() => {
      setTimeout(async () => {
        await interaction.deleteReply().catch(() => {});
      }, 60000);
    })
    .catch(console.error);
  try {
    const pingChannelId = process.env.PING_CHANNEL_ID;
    const mentionedRoleId = process.env.MENTIONED_ROLE;
    if (!pingChannelId)
      return console.log("❌ В файле .env не указан PING_CHANNEL_ID");

    const pingChannel =
      interaction.client.channels.cache.get(pingChannelId) ||
      (await interaction.client.channels
        .fetch(pingChannelId)
        .catch(() => null));

    if (!pingChannel)
      return console.log(`❌ Канал с ID ${pingChannelId} не найден.`);

    const roleMention = mentionedRoleId ? `<@&${mentionedRoleId}> ` : "";

    const msgContent = `# 📢 ${roleMention} Групп на \`${target}\` в \`${mskTimeStr}\`, проверка явки в \`${mskTimeWith5MinStr}\`. 🔑 Код группы: \`${code}\``;

    for (let i = 0; i < 3; i++) {
      await pingChannel.send(msgContent);
    }
  } catch (error) {
    console.error("❌ Не удалось отправить сообщения в пинг-канал:", error);
  }
}

module.exports = { showGroupSelect, showGroupModal, submitGroupModal };
