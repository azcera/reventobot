const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ChannelType,
    PermissionFlagsBits,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ContainerBuilder,
    MessageFlags,
    TextDisplayBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
} = require("discord.js");
const db = require("../../commands/utility/db.js");

// Список ID ролей администрации, у которых есть доступ к управлению заявками
const ADMIN_ROLES = require("../../../config.json").adminRoles;

// Вспомогательная функция отправки логов
async function logAction(guild, container) {
    const logChannelId = process.env.LOG_INVITE_CHANNEL_ID;
    if (!logChannelId) return;
    const logChannel = guild.channels.cache.get(logChannelId);
    if (logChannel) {
        await logChannel
            .send({
                components: [container.toJSON()],
                flags: [MessageFlags.IsComponentsV2],
            })
            .catch((err) => console.error("[Log Error]", err));
    }
}

async function buildContainer(
    userId,
    nameInput,
    age,
    f3,
    f4,
    f5,
    action,
    adminId = null,
    extraInfo = null,
) {
    const timestamp = Math.floor(Date.now() / 1000);

    // Дефолтный цвет для отправки заявки (темно-серый)
    let accentColor = 0x34495e;
    let title = "# 📝 Заявка в семью\nНиже выведена информация о кандидате.";
    let statusText = `\n**Статус:** На рассмотрении\nВремя отправления: <t:${timestamp}:F> (<t:${timestamp}:R>)`;

    // Динамически меняем заголовок, цвет полоски и статус на основе действия
    if (action === "отправления") {
        title +=
            " Если вы администратор: используйте кнопки ниже для управления заявкой.";
        if (ADMIN_ROLES && ADMIN_ROLES.length > 0) {
            statusText +=
                "\n" + ADMIN_ROLES.map((role) => `<@&${role}>`).join(" ");
        }
    } else if (action === "принятия") {
        accentColor = 0x2ecc71; // Красивый зеленый
        title = "# ✅ Заявка одобрена";
        statusText = `\n**Статус:** Принят в семью\n**Администратор:** <@${adminId}>\nВремя решения: <t:${timestamp}:F>`;
    } else if (action === "отклонения") {
        accentColor = 0xe74c3c; // Красивый красный
        title = "# ❌ Заявка отклонена";
        statusText = `\n**Статус:** Отклонено\n**Администратор:** <@${adminId}>\n**Причина:** ${extraInfo || "Не указана"}\nВремя решения: <t:${timestamp}:F>`;
    } else if (action === "обзвона") {
        accentColor = 0xe67e22; // Красивый оранжевый
        title = "# 📞 Вызов на обзвон";
        statusText = `\n**Статус:** Вызван на обзвон\n**Администратор:** <@${adminId}>\n**Комната:** <#${extraInfo}>\nВремя вызова: <t:${timestamp}:F>`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(accentColor) // <--- Теперь цвет полоски применяется корректно
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(title))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### Пользователь: <@${userId}>\n### 1. Никнейм\n${nameInput}\n### 2. Возраст (ООС)\n${age}\n### 3. Как узнали о семье, чем заинтересовала?\n${f3}\n### 4. Где ранее играли (проекты, серверы, семьи)?\n${f4}\n### 5. Чего ждете от семьи, чем хотите заниматься?\n${f5}`,
            ),
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(statusText),
        );

    // Кнопки добавляем ТОЛЬКО если это первоначальная отправка в приватный канал заявки
    if (action === "отправления") {
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`invite_accept_${userId}`)
                .setLabel("✅ Принять")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`invite_interview_${userId}`)
                .setLabel("📞 Вызвать на обзвон")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`invite_reject_${userId}`)
                .setLabel("❌ Отклонить")
                .setStyle(ButtonStyle.Danger),
        );

        container
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
            )
            .addActionRowComponents(actionRow);
    }
    return container;
}

class InviteInteractions {
    // 1. Показ модального окна кандидату
    async showModal(interaction) {
        const checkActive = await db.query(
            "SELECT * FROM family_applications WHERE user_id = $1",
            [interaction.user.id],
        );
        if (checkActive.rows.length > 0) {
            return interaction.reply({
                content: "❌ Вы уже подали заявку!",
                flags: MessageFlags.Ephemeral,
            });
        }

        const modal = new ModalBuilder()
            .setCustomId("invite_modal_submit")
            .setTitle("Заявка в семью REVENTO");

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("invite_name")
                    .setLabel("Никнейм без фамилии по форме (Имя | Статик)")
                    .setPlaceholder("Пример: Tony | 132961")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("invite_age")
                    .setLabel("Возраст (ООС)")
                    .setPlaceholder("Возраст 16+ (возможны исключения)")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("invite_f3")
                    .setLabel("Как узнали о семье, чем заинтересовала?")
                    .setPlaceholder("Пример: узнал через маркет, вижу часто")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("invite_f4")
                    .setLabel("Где ранее играли (проекты, серверы, семьи)?")
                    .setPlaceholder("Пример: Revento, Sweet (maj), Gucci (5rp)")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("invite_f5")
                    .setLabel("Чего ждете от семьи, чем хотите заниматься?")
                    .setPlaceholder("Пример: хочу тулиться, развиваться")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true),
            ),
        );

        return interaction.showModal(modal);
    }

    // 2. Обработка отправки модального окна
    async submitModal(interaction) {
        const nameInput = interaction.fields.getTextInputValue("invite_name");
        const ageInput = interaction.fields.getTextInputValue("invite_age");
        const f3 = interaction.fields.getTextInputValue("invite_f3");
        const f4 = interaction.fields.getTextInputValue("invite_f4");
        const f5 = interaction.fields.getTextInputValue("invite_f5");

        // Валидация формата регулярным выражением: "Имя | ЛюбыеЦифры"
        const nameRegex = /^.+\s*\|\s*\d+$/;
        if (!nameRegex.test(nameInput)) {
            return interaction.reply({
                content:
                    "❌ Ошибка! Первый пункт должен быть строго в формате `Имя | Статик` (Пример: Tony | 132961).",
                flags: MessageFlags.Ephemeral,
            });
        }

        // Валидация возраста на число
        const age = parseInt(ageInput);
        if (isNaN(age)) {
            return interaction.reply({
                content: "❌ Ошибка! Возраст должен быть указан числом.",
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            // Изменение никнейма пользователю
            await interaction.member.setNickname(nameInput).catch(() => {
                console.log(
                    `[Invite Error] Не удалось сменить ник для ${interaction.user.tag} (недостаточно прав бота)`,
                );
            });

            // Настройка прав для приватного канала
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
            ADMIN_ROLES.forEach((roleId) => {
                permissionOverwrites.push({
                    id: roleId,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                    ],
                });
            });

            const cleanName = nameInput.replace("| ", "").trim().toLowerCase();

            // Создание приватного текстового канала в категории
            const channel = await interaction.guild.channels.create({
                name: `заявка-${cleanName}`,
                type: ChannelType.GuildText,
                parent: process.env.INVITE_CATEGORY_ID,
                permissionOverwrites,
            });

            // Сохранение записи в PostgreSQL
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
                content: `✅ Ваша заявка успешно зарегистрирована! Перейдите в канал: <#${channel.id}>`,
            });
        } catch (error) {
            console.error(error);
            return interaction.editReply({
                content:
                    "❌ Произошла непредвиденная ошибка при создании заявки.",
            });
        }
    }

    // 3. Обработка динамических админских кнопок (Принять, Вызвать, Отклонить)
    async handleButtons(interaction) {
        const isMod = interaction.member?.roles.cache.some((role) =>
            ADMIN_ROLES.includes(role.id),
        );
        if (!isMod) {
            return interaction.reply({
                content: "❌ У вас нет прав для управления заявками!",
                flags: MessageFlags.Ephemeral,
            });
        }

        const [, actionType, targetUserId] = interaction.customId.split("_");

        // Вытаскиваем полные данные кандидата из БД по его id
        const res = await db.query(
            "SELECT * FROM family_applications WHERE user_id = $1",
            [targetUserId],
        );
        if (res.rows.length === 0) {
            return interaction.reply({
                content: "❌ Данные об этой заявке не найдены в базе данных.",
                flags: MessageFlags.Ephemeral,
            });
        }
        const appData = res.rows[0];

        // КНОПКА: ОТКЛОНИТЬ (Показываем модалку для ввода причины)
        if (actionType === "reject") {
            const modal = new ModalBuilder()
                .setCustomId(`invite_modal_reject_${targetUserId}`)
                .setTitle("Причина отклонения");

            const reasonInput = new TextInputBuilder()
                .setCustomId("reject_reason")
                .setLabel("Укажите причину отказа кандидату")
                .setPlaceholder(
                    "Пример: Не подходит по возрасту / Ошибки в анкету",
                )
                .setStyle(TextInputStyle.Short) // <--- Сделали поле коротким (однострочным)
                .setRequired(true);

            modal.addComponents(
                new ActionRowBuilder().addComponents(reasonInput),
            );
            return interaction.showModal(modal);
        }

        // КНОПКА: ПРИНЯТЬ
        if (actionType === "accept") {
            await interaction.reply({
                content: "Заявка одобрена! Выдаю роль и удаляю канал...",
                flags: MessageFlags.Ephemeral,
            });

            const targetMember = await interaction.guild.members
                .fetch(targetUserId)
                .catch(() => null);
            if (targetMember) {
                await targetMember.roles
                    .add(process.env.AUTO_ROLE_ID)
                    .catch(() => {});
            }
            const targetUser = await interaction.client.users
                .fetch(targetUserId)
                .catch(() => null);

            if (targetUser) {
                const timestamp = Math.floor(Date.now() / 1000);
                const container = new ContainerBuilder()
                    .setAccentColor(0x2ecc71)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `### Одобрение заявки\nВаша заявка в ${interaction.guild.name} одобрена!!`,
                        ),
                    )
                    .addSeparatorComponents(new SeparatorBuilder())
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `> Дата одобрения: <t:${timestamp}:F>`,
                        ),
                    );
                await targetUser
                    .send({
                        components: [container.toJSON()],
                        flags: [MessageFlags.IsComponentsV2],
                    })
                    .catch(() =>
                        console.log(
                            `[Invite] Не удалось отправить ЛС для UID: ${targetUserId} (Закрыто ЛС)`,
                        ),
                    );
            }

            // Генерируем красивый ЗЕЛЕНЫЙ контейнер со всеми переданными данными кандидата из БД
            const logContainer = await buildContainer(
                targetUserId,
                appData.full_name,
                appData.age,
                appData.field3,
                appData.field4,
                appData.field5,
                "принятия",
                interaction.user.id,
            );
            // Отправляем контейнер в логи
            await logAction(interaction.guild, logContainer);

            // Удаляем заявку из БД и закрываем временный канал
            await db.query(
                "DELETE FROM family_applications WHERE user_id = $1",
                [targetUserId],
            );
            setTimeout(
                () => interaction.channel.delete().catch(() => {}),
                5000,
            );
        }

        // КНОПКА: ВЫЗВАТЬ НА ОБЗВОН (Показ селекта комнат)
        if (actionType === "interview") {
            const voiceChannels = interaction.guild.channels.cache.filter(
                (c) =>
                    c.type === ChannelType.GuildVoice && c.name.includes("📞"),
            );

            if (voiceChannels.size === 0) {
                return interaction.reply({
                    content:
                        "Ошибка: Не найдено ни одного голосового канала со значком 📞.",
                    flags: MessageFlags.Ephemeral,
                });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`invite_select_voice_${targetUserId}`)
                .setPlaceholder("Выберите голосовой канал для обзвона");

            voiceChannels.forEach((c) => {
                selectMenu.addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(c.name)
                        .setValue(c.id),
                );
            });

            const row = new ActionRowBuilder().addComponents(selectMenu);
            return interaction.reply({
                content:
                    "Выберите комнату, в которую хотите вызвать кандидата:",
                components: [row],
                flags: MessageFlags.Ephemeral,
            });
        }
    }

    // ОБРАБОТКА МОДАЛКИ ОТКЛОНЕНИЯ (Вызывается при заполнении причины отказа)
    async submitRejectModal(interaction) {
        // Исправлено: Индекс изменен на 3, так как кастомный ID равен "invite_modal_reject_USERID"
        const targetUserId = interaction.customId.split("_")[3];
        const reason = interaction.fields.getTextInputValue("reject_reason");

        const res = await db.query(
            "SELECT * FROM family_applications WHERE user_id = $1",
            [targetUserId],
        );
        if (res.rows.length === 0)
            return interaction.reply({
                content: "Заявка не найдена.",
                flags: MessageFlags.Ephemeral,
            });
        const appData = res.rows[0];

        await interaction.reply({
            content: "Заявка отклонена, канал будет удален через 5 секунд...",
            flags: MessageFlags.Ephemeral,
        });

        const targetUser = await interaction.client.users
            .fetch(targetUserId)
            .catch(() => null);

        if (targetUser) {
            const timestamp = Math.floor(Date.now() / 1000);

            const container = new ContainerBuilder()
                .setAccentColor(0xe74c3c)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `### Отклонение заявки\nВаша заявка в ${interaction.guild.name} отклонена!!`,
                    ),
                )
                .addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `>Причина: ${reason}\n> Дата отклонения: <t:${timestamp}:F>`,
                    ),
                );
            await targetUser
                .send({
                    components: [container.toJSON()],
                    flags: [MessageFlags.IsComponentsV2],
                })
                .catch(() =>
                    console.log(
                        `[Invite] Не удалось отправить ЛС для UID: ${targetUserId} (Закрыто ЛС)`,
                    ),
                );
        }
        // Генерируем красивый КРАСНЫЙ контейнер со всеми сохраненными данными и причиной
        const logContainer = await buildContainer(
            targetUserId,
            appData.full_name,
            appData.age,
            appData.field3,
            appData.field4,
            appData.field5,
            "отклонения",
            interaction.user.id,
            reason,
        );
        await logAction(interaction.guild, logContainer);

        await db.query("DELETE FROM family_applications WHERE user_id = $1", [
            targetUserId,
        ]);
        setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    // 4. ОБРАБОТКА ВЫБОРА ГОЛОСОВОГО КАНАЛА ДЛЯ ОБЗВОНА
    async handleVoiceSelect(interaction) {
        const isMod = interaction.member?.roles.cache.some((role) =>
            ADMIN_ROLES.includes(role.id),
        );
        if (!isMod)
            return interaction.reply({
                content: "Недостаточно прав.",
                flags: MessageFlags.Ephemeral,
            });

        const targetUserId = interaction.customId.split("_")[3];
        const voiceChannelId = interaction.values[0];

        const res = await db.query(
            "SELECT * FROM family_applications WHERE user_id = $1",
            [targetUserId],
        );
        if (res.rows.length === 0)
            return interaction.reply({
                content: "Заявка не найдена.",
                flags: MessageFlags.Ephemeral,
            });
        const appData = res.rows[0];

        // Отправка пинга кандидату прямо в чат его заявки
        await interaction.channel.send({
            content: `📢 <@${targetUserId}>, вы были вызваны на обзвон администратором <@${interaction.user.id}>!\nПожалуйста, перейдите в голосовой канал: <#${voiceChannelId}>`,
        });

        // Отправка личного сообщения кандидату в ЛС
        const targetUser = await interaction.client.users
            .fetch(targetUserId)
            .catch(() => null);
        if (targetUser) {
            const timestamp = Math.floor(Date.now() / 1000);

            const container = new ContainerBuilder()
                .setAccentColor(0xe67e22)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `### Приглашение на обзвон в **${interaction.guild.name}**\nВы были вызваны на обзвон!`,
                    ),
                )
                .addSeparatorComponents(new SeparatorBuilder())
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(
                        `> Вас приглашают присоединиться к голосовому каналу: <#${voiceChannelId}>\n> Дата события: <t:${timestamp}:F>`,
                    ),
                );
            await targetUser
                .send({
                    components: [container.toJSON()],
                    flags: [MessageFlags.IsComponentsV2],
                })
                .catch(() =>
                    console.log(
                        `[Invite] Не удалось отправить ЛС для UID: ${targetUserId} (Закрыто ЛС)`,
                    ),
                );
        }

        // Генерируем красивый ОРАНЖЕВЫЙ контейнер со всеми сохраненными данными и ID комнаты
        const logContainer = await buildContainer(
            targetUserId,
            appData.full_name,
            appData.age,
            appData.field3,
            appData.field4,
            appData.field5,
            "обзвона",
            interaction.user.id,
            voiceChannelId,
        );
        await logAction(interaction.guild, logContainer);

        return interaction.reply({
            content: "Кандидат успешно вызван на обзвон, лог отправлен!",
            flags: MessageFlags.Ephemeral,
        });
    }
}

module.exports = new InviteInteractions();
