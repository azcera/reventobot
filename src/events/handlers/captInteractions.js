const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  LabelBuilder,
} = require("discord.js");
const {
  parseDateTime,
  getDiscordTimestamp,
} = require("../../commands/utility/parseDateTime");
const naborManager = require("../../commands/utility/naborManager");
const ADMIN_ROLES = process.env.ADMIN_ROLES.split(",");

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

async function handleAutoCaptButton(interaction) {
  // Проверяем, есть ли у пользователя хотя бы одна роль из списка allowedRoles
  const hasAdminRole = interaction.member.roles.cache.some((role) =>
    ADMIN_ROLES.includes(role.id),
  );

  // Если у него нет нужной роли, прерываем выполнение
  if (!hasAdminRole) {
    return await interaction.reply({
      content: "❌ У вас нет необходимой роли для использования этой кнопки.",
      flags: [MessageFlags.Ephemeral],
    });
  }

  const [, enemyRaw, timeRaw] = interaction.customId.split("_");

  const target = enemyRaw.replace(/-/g, " ");
  const timeInput = timeRaw.replace(/-/g, " ");

  const cleanTimeInput = timeInput.substring(0, 16);

  let parsedDate = null;
  if (typeof parseDateTime === "function") {
    parsedDate = parseDateTime(cleanTimeInput);
  }

  if (!parsedDate || isNaN(parsedDate.getTime())) {
    const dateMatch = cleanTimeInput.match(
      /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/,
    );
    if (dateMatch) {
      const [, day, month, year, hours, minutes] = dateMatch;
      parsedDate = new Date(
        `${year}-${month}-${day}T${hours}:${minutes}:00+03:00`,
      );
    }
  }

  // Если совсем всё плохо — выдаем ошибку
  if (!parsedDate || isNaN(parsedDate.getTime())) {
    return await interaction.reply({
      content: `❌ Не удалось автоматически распознать формат времени: \`${timeInput}\`.`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // 4. Генерируем правильный Discord-таймстамп через вашу функцию getDiscordTimestamp
  const discordTimestamp = getDiscordTimestamp(parsedDate);
  const maxMain = 20;

  // 5. Отвечаем пользователю (теперь Discord сам отобразит время правильно в самом ответе!)
  await interaction
    .reply({
      content: `✅ Капт против **${target}** успешно создан автоматически! Время начала: ${discordTimestamp}`,
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
      `капт против ${target}`,
      maxMain,
    );
  } catch (error) {
    console.error("❌ Ошибка при отправке автоматического набора:", error);
  }
}

module.exports = { showCaptModal, submitCaptModal, handleAutoCaptButton };
