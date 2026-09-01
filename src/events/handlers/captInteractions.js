const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  LabelBuilder
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

async function handleAutoCaptButton(interaction) {
  // 1. Разбиваем customId кнопки: capt_[enemy]_[time]
  const [, enemyRaw, timeRaw] = interaction.customId.split("_");

  const target = enemyRaw.replace(/-/g, " "); // "Culture"
  const timeInput = timeRaw.replace(/-/g, " "); // "29.08.2026 16:20:00"

  // 2. Отрезаем секунды, чтобы ваша функция parseDateTime смогла прочитать строку!
  // Из "29.08.2026 16:20:00" делаем "29.08.2026 16:20"
  const cleanTimeInput = timeInput.substring(0, 16);

  // 3. Вызываем вашу родную функцию парсинга
  let parsedDate = null;
  if (typeof parseDateTime === "function") {
    parsedDate = parseDateTime(cleanTimeInput);
  }

  // Если ваша функция вернула null, используем резервный нативный парсинг
  if (!parsedDate || isNaN(parsedDate.getTime())) {
    const dateMatch = cleanTimeInput.match(
      /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/,
    );
    if (dateMatch) {
      const [, day, month, year, hours, minutes] = dateMatch;
      // Собираем дату напрямую с указанием часового пояса +03:00 (МСК)
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
