const {
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ActionRowBuilder,
    ChannelType,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    LabelBuilder,
    SeparatorBuilder,
} = require("discord.js");
const db = require("../../../commands/utility/db.js");
const {
    isApplicationMod,
    logAction,
    buildContainer,
} = require("../../../commands/utility/inviteUtils");

async function handleButtons(interaction) {
    if (!isApplicationMod(interaction.member)) {
        return interaction.reply({
            content: "❌ У вас нет прав для управления заявками!",
            flags: [MessageFlags.Ephemeral],
        });
    }

    const [, actionType, targetUserId] = interaction.customId.split("_");
    const res = await db.query(
        "SELECT * FROM family_applications WHERE user_id = $1",
        [targetUserId],
    );
    if (res.rows.length === 0) {
        return interaction.reply({
            content: "❌ Данные о заявке не найдены.",
            flags: [MessageFlags.Ephemeral],
        });
    }
    const appData = res.rows[0];

    if (actionType === "reject") {
        const modal = new ModalBuilder()
            .setCustomId(`invite_modal_reject_${targetUserId}`)
            .setTitle("Причина отклонения");
        const inputLabel = new LabelBuilder()
            .setLabel("Укажите причину отказа кандидату")
            .setTextInputComponent(
                new TextInputBuilder()
                    .setCustomId("reject_reason")
                    .setPlaceholder("Пример: Ошибки в анкете")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true),
            );
        modal.addLabelComponents(inputLabel);

        return interaction.showModal(modal);
    }

    if (actionType === "accept") {
        // Получаем объект пользователя и участника сервера
        const targetMember = await interaction.guild.members
            .fetch(targetUserId)
            .catch(() => null);

        if (targetMember) {
            const roleId = String(process.env.AUTO_ROLE).trim();
            await targetMember.roles
                .add(roleId)
                .catch((err) =>
                    console.error(
                        `[Role Error] Не удалось выдать роль ${roleId}:`,
                        err,
                    ),
                );
        }

        const targetUser = await interaction.client.users
            .fetch(targetUserId)
            .catch(() => null);
        if (targetUser) {
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
                        `> Дата одобрения: <t:${Math.floor(Date.now() / 1000)}:F>`,
                    ),
                );
            await targetUser
                .send({
                    components: [container.toJSON()],
                    flags: [MessageFlags.IsComponentsV2],
                })
                .catch(() => {});
        }

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
        await logAction(interaction.guild, logContainer);

        await db.query("DELETE FROM family_applications WHERE user_id = $1", [
            targetUserId,
        ]);

        // --- НОВЫЙ ФУНКЦИОНАЛ: ВЫДАЧА ДОПОЛНИТЕЛЬНОЙ РОЛИ ---
        const additionalRolesRaw = process.env.FAMILY_ADDITIONAL_ROLES;
        const additionalRoles = additionalRolesRaw
            ? additionalRolesRaw
                  .split(",")
                  .map((r) => r.trim())
                  .filter(Boolean)
            : [];

        if (additionalRoles.length === 0 || !targetMember) {
            await interaction.reply({
                content: `✅ Заявка <@${targetUserId}> одобрена!`,
                flags: [MessageFlags.Ephemeral],
            });
            return setTimeout(
                () => interaction.channel.delete().catch(() => {}),
                5000,
            );
        }

        // Строим селект-меню с ролями
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`invite_select_additional_${targetUserId}`)
            .setPlaceholder("Выберите дополнительную роль для выдачи");
        const rolesIndex = ["1️⃣", "2️⃣"];
        additionalRoles.forEach((roleId, index) => {
            const role = interaction.guild.roles.cache.get(roleId);
            selectMenu.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(
                        role
                            ? `${rolesIndex[index]} ${role.name}`
                            : `Роль (${roleId})`,
                    )
                    .setValue(roleId),
            );
        });

        // Отправляем эфемерный ответ (видит только этот админ) с компонентом меню
        const response = await interaction.reply({
            content: `✅ Заявка <@${targetUserId}> одобрена! Выберите роль для выдачи (активно 30 секунд):`,
            components: [new ActionRowBuilder().addComponents(selectMenu)],
            flags: [MessageFlags.Ephemeral],
            withResponse: true,
        });

        let isRoleGiven = false;

        const collector = interaction.channel.createMessageComponentCollector({
            filter: (i) =>
                i.user.id === interaction.user.id &&
                i.customId === `invite_select_additional_${targetUserId}`,
            time: 30000,
            max: 1,
        });

        collector.on("collect", async (menuInteraction) => {
            isRoleGiven = true;
            const chosenRoleId = menuInteraction.values[0];

            await targetMember.roles
                .add(chosenRoleId)
                .catch((err) =>
                    console.error(
                        `[Additional Role Error] Не удалось выдать доп. роль ${chosenRoleId}:`,
                        err,
                    ),
                );

            await menuInteraction.reply({
                content: `✅ Роль <@&${chosenRoleId}> успешно выдана участнику <@${targetUserId}>!`,
                flags: [MessageFlags.Ephemeral],
            });

            // Удаляем канал сразу после успешного выбора
            interaction.channel.delete().catch(() => {});
        });

        collector.on("end", async () => {
            if (!isRoleGiven) {
                if (response?.resource?.message) {
                    await response.resource.message.delete().catch(() => {});
                }
                interaction.channel.delete().catch(() => {});
            }
        });
    }

    if (actionType === "interview") {
        // 1. Ищем подходящие голосовые каналы
        const voiceChannels = interaction.guild.channels.cache.filter(
            (c) => c.type === ChannelType.GuildVoice && c.name.includes("📞"), // Убедитесь, что эмодзи совпадает с вашими каналами
        );

        if (voiceChannels.size === 0) {
            return interaction.reply({
                content:
                    "❌ Нет подходящих голосовых каналов для собеседования.",
                flags: [MessageFlags.Ephemeral],
            });
        }

        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        // 2. Создаем меню выбора канала
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`invite_select_voice_${targetUserId}`)
            .setPlaceholder("Выберите комнату для кандидата");

        voiceChannels.forEach((c) =>
            selectMenu.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(c.name)
                    .setValue(c.id),
            ),
        );

        const response = await interaction.editReply({
            content: "Выберите комнату для кандидата (меню активно 1 минуту):",
            components: [new ActionRowBuilder().addComponents(selectMenu)],
        });

        // 3. Создаем сборщик (collector) для обработки выбора
        const collector = interaction.channel.createMessageComponentCollector({
            filter: (i) =>
                i.user.id === interaction.user.id &&
                i.customId === `invite_select_voice_${targetUserId}`,
            time: 60000, // 1 минута на выбор
            max: 1,
        });

        collector.on("collect", async (menuInteraction) => {
            const chosenChannelId = menuInteraction.values[0];
            const targetMember = await interaction.guild.members
                .fetch(targetUserId)
                .catch(() => null);

            // Пытаемся переместить участника
            if (targetMember) {
                try {
                    await targetMember.voice.setChannel(chosenChannelId);
                    await menuInteraction.reply({
                        content: `✅ Кандидат <@${targetUserId}> перемещен в канал. Теперь вы можете принять или отклонить заявку.`,
                        flags: [MessageFlags.Ephemeral],
                    });
                } catch (err) {
                    await menuInteraction.reply({
                        content: `⚠️ Не удалось переместить участника. Возможно, он не в голосовом канале или у бота нет прав.`,
                        flags: [MessageFlags.Ephemeral],
                    });
                }
            } else {
                await menuInteraction.reply({
                    content: "❌ Участник не найден на сервере.",
                    flags: [MessageFlags.Ephemeral],
                });
            }

            // 4. ВОЗВРАЩАЕМ КНОПКИ В АКТИВНОЕ СОСТОЯНИЕ (false = включено)
            // Это позволяет админу нажать "Принять" или "Отклонить" позже
            const enabledContainer = await buildContainer(
                targetUserId,
                appData.full_name,
                appData.age,
                appData.field3,
                appData.field4,
                appData.field5,
                "отправления",
                null,
                null,
                false, // <-- false означает, что кнопки активны
            );

            await interaction.message
                .edit({ components: [enabledContainer.toJSON()] })
                .catch(() => {});

            // Удаляем сообщение с меню выбора, чтобы не засорять чат
            await response.delete().catch(() => {});
        });

        collector.on("end", async (collected) => {
            // Если время вышло, но админ НЕ выбрал канал
            if (collected.size === 0) {
                await response.delete().catch(() => {});

                // Все равно возвращаем кнопки в активное состояние! Заявка НЕ удаляется.
                const enabledContainer = await buildContainer(
                    targetUserId,
                    appData.full_name,
                    appData.age,
                    appData.field3,
                    appData.field4,
                    appData.field5,
                    "отправления",
                    null,
                    null,
                    false,
                );
                await interaction.message
                    .edit({ components: [enabledContainer.toJSON()] })
                    .catch(() => {});

                await interaction.channel
                    .send({
                        content: `⏳ Время выбора комнаты истекло.`,
                    })
                    .catch(() => {});
            }
        });

        return; // Завершаем обработку, не удаляя ничего из БД
    }
}
module.exports = handleButtons;
