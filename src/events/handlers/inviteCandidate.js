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

// 🎯 КОНФИГУРАЦИЯ ПОЛЕЙ МОДАЛЬНОГО ОКНА
const MODAL_FIELDS = [
    {
        customId: "invite_name",
        label: "Имя",
        description: "Только имя (без фамилии и статика)",
        placeholder: "Tony",
        style: TextInputStyle.Short,
        required: true,
        validate: (value) => {
            if (!/^[A-Za-z]+$/.test(value)) {
                return "❌ Имя должно содержать только английские буквы (A-Z, a-z).";
            }
            return null;
        },
    },
    {
        customId: "invite_static",
        label: "Статик ID",
        description: "Ваш уникальный числовой идентификатор",
        placeholder: "132961",
        style: TextInputStyle.Short,
        required: true,
        validate: (value) => {
            if (!/^\d+$/.test(value)) {
                return "❌ Статик должен содержать только цифры.";
            }
            return null;
        },
    },
    {
        customId: "invite_age",
        label: "Возраст (ООС)",
        description: "Возраст от 10 до 90 лет",
        placeholder: "18",
        style: TextInputStyle.Short,
        required: true,
        validate: (value) => {
            const age = parseInt(value);
            if (isNaN(age)) {
                return "❌ Возраст должен быть числом.";
            }
            if (age < 10 || age > 90) {
                return "❌ Возраст должен быть от 10 до 90 лет.";
            }
            return null;
        },
    },
    {
        customId: "invite_info",
        label: "Как узнали о семье и чего ждете?",
        description: "Расскажите, как вы узнали о нас и ваши ожидания",
        placeholder:
            "узнал через маркет, хочу развиваться и участвовать в жизни семьи",
        style: TextInputStyle.Paragraph,
        required: true,
        validate: () => null, // Любой ввод
    },
    {
        customId: "invite_history",
        label: "Где ранее играли?",
        description: "Указывайте по возможности все проекты и семьи",
        placeholder: "Revento, Sweet (maj), Gucci (5rp)",
        style: TextInputStyle.Paragraph,
        required: true,
        validate: () => null, // Любой ввод
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

        // 🔄 Автоматическая сборка полей из массива
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

            if (field.description) {
                label.setDescription(field.description);
            }

            return label;
        });

        modal.addLabelComponents(...labels);
        return interaction.showModal(modal);
    }

    async submitModal(interaction) {
        // 🔄 Автоматическое извлечение значений
        const values = {};
        MODAL_FIELDS.forEach((field) => {
            values[field.customId] = interaction.fields
                .getTextInputValue(field.customId)
                .trim();
        });

        // 🔄 Автоматическая валидация
        for (const field of MODAL_FIELDS) {
            if (field.validate) {
                const error = field.validate(values[field.customId]);
                if (error) {
                    return sendEphemeralWithAutoDelete(interaction, {
                        content: error,
                    });
                }
            }
        }

        const fullName = `${values.invite_name} | ${values.invite_static}`;
        const age = parseInt(values.invite_age);
        const info = values.invite_info;
        const history = values.invite_history;

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

            // Сохраняем в БД с новой структурой полей
            await db.query(
                `INSERT INTO family_applications 
                 (user_id, channel_id, full_name, age, field3, field4, field5) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    interaction.user.id,
                    channel.id,
                    fullName,
                    age,
                    info, // field3 теперь = как узнали + чего ждете
                    history, // field4 = где ранее играли
                    "", // field5 теперь пустой (объединен с field3)
                ],
            );

            const container = await buildContainer(
                interaction.user.id,
                fullName,
                age,
                info,
                history,
                "",
                "отправления",
            );

            await channel.send({
                components: [container.toJSON()],
                flags: [MessageFlags.IsComponentsV2],
            });

            return await editReplyWithAutoDelete({
                content: `✅ Ваша заявка зарегистрирована! <#${channel.id}>`,
            });
        } catch (error) {
            console.error("[InviteCandidate] Ошибка создания заявки:", error);
            return await editReplyWithAutoDelete({
                content: "❌ Произошла ошибка при создании заявки.",
            });
        }
    }
}

module.exports = new InviteCandidate();
