const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} = require("discord.js");
const {
  parseDateTime,
  getMskTimeString,
} = require("../../commands/utility/parseDateTime");

const { options, optionsMap } = require("../../commands/utility/groupOptions");

async function showGroupSelect(interaction) {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("group_select_target")
    .setPlaceholder("Выберите цель проведения...")
    .addOptions(...options);

  const row = new ActionRowBuilder().addComponents(selectMenu);

  await interaction.reply({
    content: "Пожалуйста, выберите цель создания группы из списка ниже:",
    components: [row],
    flags: [MessageFlags.Ephemeral],
  });
}

// 2. Показ модального окна ПОСЛЕ выбора в меню
async function showGroupModal(interaction) {
  // Получаем то, что юзер выбрал в выпадающем списке
  const selectedTarget = interaction.values[0];

  // Передаем этот выбор прямо в customId модалки через разделитель "_"
  const modal = new ModalBuilder()
    .setCustomId(`modal_group_${selectedTarget}`)
    .setTitle("Создание группы");

  const timeInput = new TextInputBuilder()
    .setCustomId("group_time")
    .setLabel("Время проведения")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(
      "Например: 18:00 или 29.08.2026 18:00 (указывать именно начало МП, время расчитается само)",
    )
    .setRequired(true);

  const targetInput = new TextInputBuilder()
    .setCustomId("group_target")
    .setLabel("Цель")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Например: ОСТРОВ, ОГРАБЛЕНИЯ, КОНТРАКТЫ")
    .setRequired(true);

  const codeInput = new TextInputBuilder()
    .setCustomId("group_code")
    .setLabel("Код группы")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Введите код...")
    .setRequired(true);

  if (selectedTarget === "other") {
    modal.addComponents(
      new ActionRowBuilder().addComponents(timeInput),
      new ActionRowBuilder().addComponents(targetInput),
      new ActionRowBuilder().addComponents(codeInput),
    );
  } else {
    modal.addComponents(new ActionRowBuilder().addComponents(codeInput));
  }

  // Показываем модальное окно пользователю
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
      flags: MessageFlags.Ephemeral,
    });
  }

  // Получаем статичный текст времени по МСК (например, "18:00" и "17:55")
  const mskTimeStr = getMskTimeString(parsedDate, -600);
  const mskTimeWith5MinStr = getMskTimeString(parsedDate, -300);

  await interaction
    .reply({
      content: `Группа создана!\nВремя: ${mskTimeStr} МСК\nЦель: ${target}\nКод: ${code}`,
      flags: MessageFlags.Ephemeral,
    })
    .catch(console.error);

  try {
    const pingChannelId = process.env.PING_CHANNEL_ID;
    const mentionedRoleId = process.env.MENTIONED_ROLE;
    if (!pingChannelId)
      return console.log("Ошибка: В файле .env не указан PING_CHANNEL_ID");

    const pingChannel =
      interaction.client.channels.cache.get(pingChannelId) ||
      (await interaction.client.channels
        .fetch(pingChannelId)
        .catch(() => null));

    if (!pingChannel)
      return console.log(`Ошибка: Канал с ID ${pingChannelId} не найден.`);

    const roleMention = mentionedRoleId ? `<@&${mentionedRoleId}> ` : "";

    // В тексте сообщения теперь используются обычные строки времени
    const msgContent = `# 📢 ${roleMention} Групп на \`${target}\` в \`${mskTimeStr}\`, проверка явки в \`${mskTimeWith5MinStr}\`. 🔑 Код группы: \`${code}\``;

    for (let i = 0; i < 3; i++) {
      await pingChannel.send(msgContent);
    }
  } catch (error) {
    console.error("Не удалось отправить сообщения в пинг-канал:", error);
  }
}

module.exports = { showGroupSelect, showGroupModal, submitGroupModal };
