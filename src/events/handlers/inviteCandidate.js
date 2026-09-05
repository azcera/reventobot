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
const {
    sendEphemeralWithAutoDelete,
    editReplyWithAutoDelete,
} = require("../../commands/utility/autoDelete.js");

const ADMIN_ROLES = process.env.ADMIN_ROLES
    ? process.env.ADMIN_ROLES.split(",")
    : [];

const MODAL_FIELDS = [
    {
        customId: "invite_name",
        label: "Никнейм",
        description: "Только имя (без фамилии и статика)",
        placeholder: "Tony",
        style: TextInputStyle.Short,
        required: true,
        validate: (value) =>
            /^[A-Za-z]+$/.test(value)
                ? null
                : "❌ Имя должно содержать только английские буквы.",
    },
    {
        customId: "invite_static",
        label: "Статик ID",
        description:
            "Ваш уникальный числовой идентификатор (можно посмотреть справа вверху в игре после символа '#')",
        placeholder: "132961",
        style: TextInputStyle.Short,
        required: true,
        validate: (value) =>
            /^\d+$/.test(value)
                ? null
                : "❌ Статик должен содержать только цифры.",
    },
    {
        customId: "invite_age",
        label: "Возраст (ООС)",
        placeholder: "18",
        style: TextInputStyle.Short,
        required: true,
        validate: (value) => {
            const age = parseInt(value);
            if (isNaN(age) || age < 10 || age > 90)
                return "❌ Возраст должен быть введен верным числом.";
            return null;
        },
    },
    {
        customId: "invite_info",
        label: "Как узнали о семье и чего ждете?",
        description: "Расскажите о ваших ожиданиях",
        placeholder: "Узнал через маркет, хочу развиваться",
        style: TextInputStyle.Paragraph,
        required: true,
        validate: () => null,
    },
    {
        customId: "invite_history",
        label: "Где ранее играли?",
        description: "Указывайте проекты и семьи",
        placeholder: "Revento, Sweet, Gucci (5rp)",
        style: TextInputStyle.Paragraph,
        required: true,
        validate: () => null,
    },
];

class InviteCandidate {
    async showModal(interaction) {
        const checkActive = await db.query(
            "SELECT * FROM family_applications WHERE user_id = $1",
            [interaction.user.id],
        );
        if (checkActive.rows.length > 0) {
            return sendEphemeralWithAutoDelete(interaction, {
                content: "❌ Вы уже подали заявку!",
            });
        }

        const modal = new ModalBuilder()
            .setCustomId("invite_modal_submit")
            .setTitle("Заявка в семью REVENTO");

        const labels = MODAL_FIELDS.map((field) => {
            const label = new LabelBuilder()
                .setLabel(field.label)
                .setTextInputComponent(
                    new TextInputBuilder()
                        .setCustomId(field.customId)
                        .setPlaceholder(field.placeholder)
                        .setStyle(field.style)
                        .setRequired(field.required),
                );
            if (field.description) label.setDescription(field.description);
            return label;
        });

        modal.addLabelComponents(...labels);
        return interaction.showModal(modal);
    }

    async submitModal(interaction) {
        const values = {};
        MODAL_FIELDS.forEach((field) => {
            values[field.customId] = interaction.fields
                .getTextInputValue(field.customId)
                .trim();
        });

        for (const field of MODAL_FIELDS) {
            const error = field.validate(values[field.customId]);
            if (error)
                return sendEphemeralWithAutoDelete(interaction, {
                    content: error,
                });
        }

        const fullName = `${values.invite_name} | ${values.invite_static}`;
        const age = parseInt(values.invite_age);

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        try {
            await interaction.member.setNickname(fullName).catch(() => {});

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

            const cleanName = fullName.replace("| ", "").trim().toLowerCase();
            const channel = await interaction.guild.channels.create({
                name: `заявка-${cleanName}`,
                type: ChannelType.GuildText,
                parent: process.env.INVITE_CATEGORY_ID,
                permissionOverwrites,
            });

            await db.query(
                `INSERT INTO family_applications 
                 (user_id, channel_id, full_name, age, about_and_expectations, previous_experience) 
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    interaction.user.id,
                    channel.id,
                    fullName,
                    age,
                    values.invite_info,
                    values.invite_history,
                ],
            );

            const container = await buildContainer(
                interaction.user.id,
                fullName,
                age,
                values.invite_info,
                values.invite_history,
                "отправления",
            );

            await channel.send({
                components: [container.toJSON()],
                flags: [MessageFlags.IsComponentsV2],
            });

            return await editReplyWithAutoDelete(interaction, {
                content: `✅ Ваша заявка зарегистрирована! <#${channel.id}>`,
            });
        } catch (error) {
            console.error("[InviteCandidate] Ошибка создания заявки:", error);
            return await editReplyWithAutoDelete(interaction, {
                content: "❌ Произошла ошибка при создании заявки.",
            });
        }
    }
}

const inviteCandidateInstance = new InviteCandidate();

inviteCandidateInstance.MODAL_FIELDS = MODAL_FIELDS;

module.exports = inviteCandidateInstance;
