const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SectionBuilder, // Используется для создания красивых блоков-контейнеров
  SeparatorBuilder, // Новый компонент для красивых разделительных линий
} = require("discord.js");

module.exports = {
  async sendNabor(interaction, discordTimestamp) {
    // Начальные пустые списки участников (хранятся в замыкании для этого конкретного сбора)
    const mainList = [];
    const reserveList = [];
    const leftList = [];

    // Функция генерации контента (инкапсулирует логику красивого отображения)
    function generateNaborMessage() {
      // 1. Создаем чистый, премиальный Embed без визуального мусора
      const embed = new EmbedBuilder()
        .setColor("#2b2d31") // Трендовый "невидимый" цвет Discord
        .setTitle("⚔️ Сбор на Капт")
        .setDescription(
          `**Время проведения:** ${discordTimestamp}\n\n*Нажимайте кнопки ниже, чтобы управлять своим участием.*`,
        )
        .setTimestamp();

      // Наполнение основного состава (Максимум 20)
      const mainValue =
        mainList.length > 0
          ? mainList.map((id, index) => `\`${index + 1}.\` <@${id}>`).join("\n")
          : "*Пока никого нет*";
      embed.addFields({
        name: `🟢 Основной состав (${mainList.length}/20)`,
        value: mainValue,
        inline: false,
      });

      // Наполнение резерва
      const reserveValue =
        reserveList.length > 0
          ? reserveList
              .map((id, index) => `\`${index + 1}.\` <@${id}>`)
              .join("\n")
          : "*Пусто*";
      embed.addFields({
        name: "⏳ Резерв",
        value: reserveValue,
        inline: false,
      });

      // Условие из ТЗ: Категория покинувших показывается ТОЛЬКО если там кто-то есть
      if (leftList.length > 0) {
        const leftValue = leftList.map((id) => `<@${id}>`).join(", ");
        embed.addFields({
          name: "🗑️ Покинули сбор",
          value: leftValue,
          inline: false,
        });
      }

      // 2. Строим компоненты нового поколения (Components v2)
      // Оборачиваем кнопки в Section (Container), чтобы отделить интерфейс от текста
      const section = new SectionBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("nabor_join")
          .setLabel("Присоединиться")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("nabor_leave")
          .setLabel("Выйти")
          .setStyle(ButtonStyle.Danger),
      );

      // Добавляем красивую разделительную линию (Separator) перед кнопками
      const separator = new SeparatorBuilder();

      // Возвращаем структуру для отправки/обновления
      return {
        embeds: [embed],
        components: [separator, section], // Передаем разделитель и контейнер с кнопками
      };
    }

    // Первичная отправка сообщения в канал
    const message = await interaction.channel.send(generateNaborMessage());

    // Создаем производительный коллектор без нагрузки на БД
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 7200000, // Время жизни сбора (например, 2 часа)
    });

    collector.on("collect", async (btnInteraction) => {
      const userId = btnInteraction.user.id;

      // Вспомогательная функция для полной очистки игрока из текущих списков
      const removeFromLists = (id) => {
        const mIdx = mainList.indexOf(id);
        if (mIdx > -1) mainList.splice(mIdx, 1);
        const rIdx = reserveList.indexOf(id);
        if (rIdx > -1) reserveList.splice(rIdx, 1);
        const lIdx = leftList.indexOf(id);
        if (lIdx > -1) leftList.splice(lIdx, 1);
      };

      // ЛОГИКА НАЖАТИЯ: ПРИСОЕДИНИТЬСЯ
      if (btnInteraction.customId === "nabor_join") {
        if (mainList.includes(userId) || reserveList.includes(userId)) {
          return btnInteraction.reply({
            content: "❌ Вы уже находитесь в списках этого сбора!",
            ephemeral: true,
          });
        }

        removeFromLists(userId);

        if (mainList.length < 20) {
          mainList.push(userId);
        } else {
          reserveList.push(userId);
        }
      }

      // ЛОГИКА НАЖАТИЯ: ВЫЙТИ
      else if (btnInteraction.customId === "nabor_leave") {
        if (!mainList.includes(userId) && !reserveList.includes(userId)) {
          return btnInteraction.reply({
            content: "❌ Вас изначально не было в списках участников.",
            ephemeral: true,
          });
        }

        removeFromLists(userId);
        leftList.push(userId);

        // Автобаланс: если освободилось место в основе, двигаем человека из резерва вперед
        if (mainList.length < 20 && reserveList.length > 0) {
          const promotedUser = reserveList.shift();
          mainList.push(promotedUser);
        }
      }

      // Обновляем сообщение актуальными данными
      await btnInteraction.update(generateNaborMessage()).catch(console.error);
    });

    // Обработка завершения сбора (выключение кнопок)
    collector.on("end", () => {
      const disabledSeparator = new SeparatorBuilder();
      const disabledSection = new SectionBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("nabor_join")
          .setLabel("Сбор завершен")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId("nabor_leave")
          .setLabel("Выйти")
          .setStyle(ButtonStyle.Danger)
          .setDisabled(true),
      );

      message
        .edit({ components: [disabledSeparator, disabledSection] })
        .catch(() => {});
    });
  },
};
