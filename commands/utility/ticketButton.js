module.exports = async (client) => {
  const {
    ButtonBuilder,
    ActionRowBuilder,
    ButtonStyle,
    roleMention,
  } = require("discord.js");

  require("dotenv").config();

  const channel = await client.channels.fetch(process.env.WARN_CHANNEL_ID);

  // Создаём кнопку
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("Создать тикет")
      .setStyle(ButtonStyle.Primary),
  );

  // Ищем сообщение с кнопкой
  const messages = await channel.messages.fetch({ limit: 10 });
  const existingMessage = messages.find(
    (msg) => msg.components?.[0]?.components?.[0]?.customId === "create_ticket",
  );
  const content = `||${roleMention(process.env.MENTIONED_ROLE)}||\n
            **ЗА ЧТО ВЫДАЮТ ВАРНЫ?**\n
            \`\`\`css\n
            1. Неуместная неадекватность\n
            2. Спам в войсе\n
            3. Отсутствие активности в семье без отписанной причины в AFK (нвс)\n
            4. Действия, приводящие к плохим последствиям для семьи\n
            5. Отсутствие дисциплины (неуважение)\n
            \`\`\`\n
            **СИСТЕМА СНЯТИЯ ВАРНОВ**\n\n
            Для снятие варна нужно посетить 4 семейных мероприятия и создав кнопкой ниже заявку, отправить доказательства присутствия в канал.\n\n
            За семейные мероприятия считается:\n\n
            **\`КОНТРАКТЫ\`**: Ценная партия, Подставная стройка, Конспирация\n\n
            **\`ТАЙНИКИ\`**: 02:00, 06:00, 10:00, 14:00, 18:00, 22:00\n
            **\`ДРОП\`**: 04:00, 08:00, 12:00, 16:00, 20:00, 00:00\n
            **\`ДИЛЛЕРЫ\`**: 10:45, 18:45\n
            **\`ЦЕХА\`**: 14:45, 22:45\n
            **\`ОГРАБЛЕНИЯ\`**: 12:00-01:00\n\n
            **\`КАПТЫ (15:00-21:00) / ОСТРОВ (17:00-20:00, 21:00-23:00)\`**: ПОНЕДЕЛЬНИК, СРЕДА, ПЯТНИЦА, ВОСКРЕСЕНЬЕ\n
            ||${roleMention(process.env.MENTIONED_ROLE)}||`;
  if (existingMessage) {
    // Обновляем существующее сообщение
    await existingMessage.edit({
      content,
      allowedMentions: { roles: [process.env.MENTIONED_ROLE] },
      components: [row],
    });
    console.log("Сообщение с кнопкой обновлено");
  } else {
    await channel.send({
      content,
      allowedMentions: { roles: [process.env.MENTIONED_ROLE] },
      components: [row],
    });
    console.log("Сообщение с кнопкой отправлено");
  }
};
