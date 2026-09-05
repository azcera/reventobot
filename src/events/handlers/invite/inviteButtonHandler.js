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
const {
    sendEphemeralWithAutoDelete,
    followUpEphemeralWithAutoDelete,
} = require("../../../commands/utility/autoDelete.js");
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
        // 1. СРАЗУ отвечаем на взаимодействие, чтобы Discord не считал его "зависшим" (Unknown interaction)
        await interaction
            .deferReply({ flags: [MessageFlags.Ephemeral] })
            .catch(() => {});

        try {
            const targetMember = await interaction.guild.members
                .fetch(targetUserId)
                .catch(() => null);
            if (targetMember) {
                // Используем MAIN_ROLE_ID, если он есть, иначе fallback на AUTO_ROLE
                const roleId = String(
                    process.env.MAIN_ROLE_ID || process.env.AUTO_ROLE,
                ).trim();
                await targetMember.roles.add(roleId).catch(console.error);
            }

            const targetUser = await interaction.client.users
                .fetch(targetUserId)
                .catch(() => null);
            if (targetUser) {
                const container = new ContainerBuilder()
                    .setAccentColor(0x2ecc71)
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent(
                            `### Одобрение заявки\nВаша заявка в ${interaction.guild.name} одобрена!`,
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

            // Удаляем из БД
            await db.query(
                "DELETE FROM family_applications WHERE user_id = $1",
                [targetUserId],
            );

            const additionalRolesRaw = process.env.FAMILY_ADDITIONAL_ROLES;
            const additionalRoles = additionalRolesRaw
                ? additionalRolesRaw
                      .split(",")
                      .map((r) => r.trim())
                      .filter(Boolean)
                : [];

            // Если доп. ролей нет, просто удаляем канал и завершаем
            if (additionalRoles.length === 0 || !targetMember) {
                await followUpEphemeralWithAutoDelete(interaction, {
                    content: `✅ Заявка <@${targetUserId}> одобрена! Канал будет удален.`,
                });
                setTimeout(
                    () => interaction.channel.delete().catch(console.error),
                    2000,
                );
                return;
            }

            // Если есть доп. роли, показываем меню
            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`invite_select_additional_${targetUserId}`)
                .setPlaceholder("Выберите дополнительную роль для выдачи");

            additionalRoles.forEach((roleId, index) => {
                const role = interaction.guild.roles.cache.get(roleId);
                selectMenu.addOptions(
                    new StringSelectMenuOptionBuilder()
                        .setLabel(
                            role
                                ? `${index + 1}️⃣ ${role.name}`
                                : `Роль (${roleId})`,
                        )
                        .setValue(roleId),
                );
            });

            await interaction.followUp({
                content: `✅ Заявка <@${targetUserId}> одобрена! Выберите роль (активно 30 сек):`,
                components: [new ActionRowBuilder().addComponents(selectMenu)],
                flags: [MessageFlags.Ephemeral],
            });

            const collector =
                interaction.channel.createMessageComponentCollector({
                    filter: (i) =>
                        i.user.id === interaction.user.id &&
                        i.customId ===
                            `invite_select_additional_${targetUserId}`,
                    time: 30000,
                    max: 1,
                });

            collector.on("collect", async (menuInteraction) => {
                await menuInteraction.deferUpdate(); // Отвечаем на меню, чтобы не было ошибки
                const chosenRoleId = menuInteraction.values[0];
                if (targetMember)
                    await targetMember.roles
                        .add(chosenRoleId)
                        .catch(console.error);

                await interaction.channel.send({
                    content: `✅ Роль <@&${chosenRoleId}> выдана участнику <@${targetUserId}>!`,
                });
                setTimeout(
                    () => interaction.channel.delete().catch(console.error),
                    1500,
                );
            });

            collector.on("end", async (collected) => {
                if (collected.size === 0) {
                    // Если роль не выбрали, все равно удаляем канал, так как заявка уже одобрена и удалена из БД
                    setTimeout(
                        () => interaction.channel.delete().catch(console.error),
                        1500,
                    );
                }
            });
        } catch (error) {
            console.error("Ошибка при принятии заявки:", error);
            await interaction
                .followUp({
                    content: "❌ Произошла ошибка при обработке заявки.",
                    flags: [MessageFlags.Ephemeral],
                })
                .catch(() => {});
        }
    }

    if (actionType === "interview") {
        const voiceChannels = interaction.guild.channels.cache.filter(
            (c) => c.type === ChannelType.GuildVoice && c.name.includes("📞"),
        );
        if (voiceChannels.size === 0) {
            return interaction.reply({
                content: "❌ Нет подходящих голосовых каналов.",
                flags: [MessageFlags.Ephemeral],
            });
        }

        // 1. СРАЗУ делаем кнопку неактивной, используя встроенную логику buildContainer
        const disabledContainer = await buildContainer(
            targetUserId,
            appData.full_name,
            appData.age,
            appData.field3,
            appData.field4,
            appData.field5,
            "отправления",
            null,
            null,
            true, // <-- 10-й аргумент: isInterviewDisabled = true (кнопка станет серой)
        );

        const mainMessage = interaction.message;
        // Обновляем сообщение новыми компонентами
        await mainMessage
            .edit({ components: [disabledContainer] })
            .catch(console.error);

        // 2. Показываем меню выбора канала
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`invite_select_voice_${targetUserId}`)
            .setPlaceholder("Выберите голосовой канал");

        voiceChannels.forEach((c) =>
            selectMenu.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(c.name)
                    .setValue(c.id),
            ),
        );

        await interaction.reply({
            content: "Выберите комнату для кандидата (меню активно 1 минуту):",
            components: [new ActionRowBuilder().addComponents(selectMenu)],
            flags: [MessageFlags.Ephemeral],
        });

        // 3. Собираем выбор администратора
        const collector = interaction.channel.createMessageComponentCollector({
            filter: (i) =>
                i.user.id === interaction.user.id &&
                i.customId === `invite_select_voice_${targetUserId}`,
            time: 60000,
            max: 1,
        });

        collector.on("collect", async (menuInteraction) => {
            await menuInteraction.reply({
                content: "✅ Кандидат вызван! Кнопка обзвона деактивирована.",
                flags: [MessageFlags.Ephemeral],
            });
            await interaction.deleteReply().catch(() => {}); // Удаляем сообщение с меню выбора, чтобы не мешало
        });

        collector.on("end", async (collected) => {
            if (collected.size === 0) {
                // Время вышло. Возвращаем кнопку "Обзвон" в активное состояние
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
                    false, // <-- 10-й аргумент: isInterviewDisabled = false (кнопка снова активна)
                );
                await mainMessage
                    .edit({ components: [enabledContainer] })
                    .catch(console.error);

                // ИСПРАВЛЕНИЕ: Сообщение видно ТОЛЬКО администратору (Ephemeral)
                await interaction
                    .followUp({
                        content: `⏳ Время выбора комнаты истекло. Кнопка вызова снова активна.`,
                        flags: [MessageFlags.Ephemeral],
                    })
                    .catch(() => {});
            }
        });
        return;
    }
}
module.exports = handleButtons;
