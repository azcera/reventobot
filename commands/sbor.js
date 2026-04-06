// const {
//   SlashCommandBuilder,
//   MessageFlags,
//   EmbedBuilder,
//   ActionRowBuilder,
//   ButtonBuilder,
//   ButtonStyle,
//   ComponentType,
// } = require("discord.js");
// const { splitName } = require("./utility/splitName");
// const { createChannel } = require("./utility/createChannel");
// require("dotenv").config();

// module.exports = {
//   data: new SlashCommandBuilder()
//     .setName("sbor")
//     .setNameLocalization("ru", "сбор")
//     .setDescription("Создает регу на мероприятие.")
//     .addStringOption((option) =>
//       option
//         .setName("name")
//         .setDescription("Сообщение к сбору")
//         .setNameLocalization("ru", "название")
//         .setRequired(true),
//     )
//     .addStringOption((option) =>
//       option
//         .setName("date")
//         .setNameLocalization("ru", "дата")
//         .setDescription("Дата сбора (формат: ДД.ММ.ГГГГ ЧЧ:ММ)")
//         .setRequired(true),
//     )
//     .addIntegerOption((option) =>
//       option
//         .setMinValue(0)
//         .setMaxValue(50)
//         .setName("slots")
//         .setNameLocalization("ru", "слоты")
//         .setDescription("Устанавливает количество участников в сборе")
//         .setRequired(false),
//     ),

//   async execute(interaction) {
//     const sborName = interaction.options.getString("name");
//     const sborDate = interaction.options.getString("date");
//     const sborSlots = interaction.options.getInteger("slots") ?? 20;

//     const botMessage = `<@${process.env.AUTO_ROLE_ID}> ` + sborName;

//     const dateRegExp = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/;
//     const match = sborDate.match(dateRegExp);

//     if (!match) {
//       return interaction.reply({
//         content:
//           "❌ Неверный формат даты! Используйте: ДД.ММ.ГГГГ ЧЧ:ММ (например, 25.12.2026 18:00)",
//         ephemeral: true,
//       });
//     }

//     const [_, day, month, year, hour, minute] = match;
//     const dateObject = new Date(year, month - 1, day, hour, minute);

//     if (isNaN(dateObject.getTime())) {
//       return interaction.reply({
//         content: "❌ Указана несуществующая дата!",
//         ephemeral: true,
//       });
//     }

//     if (dateObject < new Date()) {
//       return interaction.reply({
//         content: "❌ Нельзя создать сбор в прошлом времени!",
//         ephemeral: true,
//       });
//     }
//     const unixTime = Math.floor(dateObject.getTime() / 1000);
//     let participants = [];
//     const createEmbed = () => {
//       const participantList =
//         participants.length > 0
//           ? participants.map((id) => `<@${id}>`).join(", ")
//           : "Пока никого нет";

//       return new EmbedBuilder()
//         .setColor(0xde39f9) // Цвет полоски слева
//         .setDescription(
//           `**Создал:** <@${interaction.user.id}>
// **Дата:** \`<t:${unixTime}:F> (<t:${unixTime}:R>)\`

// **Участники (${participants.length}/${sborSlots})**
// ${participantList}
// `,
//         )
//         .setTimestamp(dateObject);
//     };

//     const row = new ActionRowBuilder().addComponents(
//       new ButtonBuilder()
//         .setCustomId("join_event")
//         .setLabel("Участвовать")
//         .setStyle(ButtonStyle.Primary),
//     );

//     const response = await interaction.reply({
//       embeds: [createEmbed()],
//       components: [row],
//       fetchReply: true,
//     });
//     const collector = response.createMessageComponentCollector({
//       componentType: ComponentType.Button,
//       time: 86400000,
//     });

//     collector.on("collect", async (i) => {
//       if (i.customId === "join_event") {
//         if (participants.includes(i.user.id)) {
//           participants = participants.filter((id) => id !== i.user.id);
//         } else {
//           if (participants.length < limit) {
//             participants.push(i.user.id);
//           } else {
//             return i.reply({ content: "Мест больше нет!", ephemeral: true });
//           }
//         }
//         // Редактируем сообщение с обновленным эмбедом
//         await i.update({ embeds: [createEmbed()] });
//       }
//     });
//   },
// };
