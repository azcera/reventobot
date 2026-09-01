const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionFlagsBits,
    MessageFlags,
    LabelBuilder,
} = require("discord.js");
const db = require("../../commands/utility/db.js");
const { buildContainer } = require("../../commands/utility/inviteUtils");
const ADMIN_ROLES = process.env.ADMIN_ROLES.split(",");

class InviteCandidate {
    async showModal(interaction) {
        const checkActive = await db.query(
            "SELECT * FROM family_applications WHERE user_id = $1",
            [interaction.user.id],
        );
        if (checkActive.rows.length > 0) {
            return interaction.reply({
                content: "❌ Вы уже подали заявку!",
                flags: [MessageFlags.Ephemeral],
            });
        }

        const modal = new ModalBuilder()
            .setCustomId("invite_modal_submit")
            .setTitle("Заявка в семью REVENTO");

        const nameLabel = new LabelBuilder()
            .setLabel("Никнейм")
            .setDescription("Без фамилии и соответственно форме (Имя | Статик)")
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId("invite_name")
                    .setPlaceholder("Tony | 132961")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true),
            );
        const ageLabel = new LabelBuilder()
            .setLabel("Возраст (ООС)")
            .setDescription("16+ (возможны исключения)")
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId("invite_age")
                    .setPlaceholder("16")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true),
            );
        const infoLabel3 = new LabelBuilder()
            .setLabel("Как узнали о семье?")
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId("invite_f3")
                    .setPlaceholder("узнал через маркет, вижу часто")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true),
            );
        const infoLabel4 = new LabelBuilder()
            .setLabel("Где ранее играли?")
            .setDescription("Указывайте по возможности все проекты и семьи")
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId("invite_f4")
                    .setPlaceholder("Revento, Sweet (maj), Gucci (5rp)")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true),
            );
        const infoLabel5 = new LabelBuilder()
            .setLabel("Чего ждете от семьи?")
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId("invite_f5")
                    .setPlaceholder("хочу тулиться, развиваться")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true),
            );

        modal.addLabelComponents(
            nameLabel,
            ageLabel,
            infoLabel3,
            infoLabel4,
            infoLabel5,
        );
        return interaction.showModal(modal);
    }

    async submitModal(interaction) {
        const nameInput = interaction.fields.getTextInputValue("invite_name");
        const ageInput = interaction.fields.getTextInputValue("invite_age");
        const f3 = interaction.fields.getTextInputValue("invite_f3");
        const f4 = interaction.fields.getTextInputValue("invite_f4");
        const f5 = interaction.fields.getTextInputValue("invite_f5");

        if (!/^.+\s\|\s\d+$/.test(nameInput)) {
            return interaction.reply({
                content:
                    "❌ Формат должен быть строго `Имя | Статик` (обязательно по одному пробелу до и после черты).",
                flags: [MessageFlags.Ephemeral],
            });
        }
        const age = parseInt(ageInput);
        if (isNaN(age)) {
            return interaction.reply({
                content: "❌ Возраст должен быть указан числом.",
                flags: [MessageFlags.Ephemeral],
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await interaction.member.setNickname(nameInput).catch(() => {});

            const permissionOverwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel],
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                    ],
                },
            ];
            ADMIN_ROLES.forEach((roleId) =>
                permissionOverwrites.push({
                    id: roleId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                    ],
                }),
            );

            const cleanName = nameInput.replace("| ", "").trim().toLowerCase();
            const channel = await interaction.guild.channels.create({
                name: `заявка-${cleanName}`,
                type: ChannelType.GuildText,
                parent: process.env.INVITE_CATEGORY_ID,
                permissionOverwrites,
            });

            await db.query(
                "INSERT INTO family_applications (user_id, channel_id, full_name, age, field3, field4, field5) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                [interaction.user.id, channel.id, nameInput, age, f3, f4, f5],
            );

            const container = await buildContainer(
                interaction.user.id,
                nameInput,
                age,
                f3,
                f4,
                f5,
                "отправления",
            );
            await channel.send({
                components: [container.toJSON()],
                flags: [MessageFlags.IsComponentsV2],
            });

            return interaction.editReply({
                content: `✅ Ваша заявка зарегистрирована! <#${channel.id}>`,
            });
        } catch (error) {
            console.error(error);
            return interaction.editReply({
                content: "❌ Произошла ошибка при создании заявки.",
            });
        }
    }
}

module.exports = new InviteCandidate();
