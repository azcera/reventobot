// src/events/handlers/inviteAdmin.js
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
    SeparatorBuilder,
} = require("discord.js");
const db = require("../../commands/utility/db.js");
const {
    isApplicationMod,
    logAction,
    buildContainer,
} = require("../../commands/utility/inviteUtils");

class InviteAdmin {
    async handleButtons(interaction) {
        if (!isApplicationMod(interaction.member)) {
            return interaction.reply({
                content: "❌ У вас нет прав для управления заявками!",
                flags: MessageFlags.Ephemeral,
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
                flags: MessageFlags.Ephemeral,
            });
        }
        const appData = res.rows[0];

        if (actionType === "reject") {
            const modal = new ModalBuilder()
                .setCustomId(`invite_modal_reject_${targetUserId}`)
                .setTitle("Причина отклонения");
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId("reject_reason")
                        .setLabel("Укажите причину отказа кандидату")
                        .setPlaceholder("Пример: Ошибки в анкете")
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true),
                ),
            );
            return interaction.showModal(modal);
        }

        if (actionType === "accept") {
            await interaction.reply({
                content: "Заявка одобрена! Выдаю роль...",
                flags: MessageFlags.Ephemeral,
            });
            const targetMember = await interaction.guild.members
                .fetch(targetUserId)
                .catch(() => null);
            if (targetMember)
                await targetMember.roles
                    .add(process.env.AUTO_ROLE_ID)
                    .catch(() => {});

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

            await db.query(
                "DELETE FROM family_applications WHERE user_id = $1",
                [targetUserId],
            );
            setTimeout(
                () => interaction.channel.delete().catch(() => {}),
                5000,
            );
        }

        if (actionType === "interview") {
            const voiceChannels = interaction.guild.channels.cache.filter(
                (c) =>
                    c.type === ChannelType.GuildVoice && c.name.includes("📞"),
            );
            if (voiceChannels.size === 0) {
                return interaction.reply({
                    content: "Ошибка: Нет голосовых каналов со значком 📞.",
                    flags: MessageFlags.Ephemeral,
                });
            }

            // 1. Блокируем кнопку (передаем true в самый конец)
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
                true,
            );

            // Обновляем сообщение в канале, делая кнопку серой
            const mainMessage = interaction.message;
            await mainMessage
                .edit({ components: [disabledContainer.toJSON()] })
                .catch(() => {});

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

            // 2. Отправляем меню выбора комнат кандидату и сохраняем ссылку на ответ
            await interaction.reply({
                content:
                    "Выберите комнату для кандидата (меню активно 1 минуту):",
                components: [new ActionRowBuilder().addComponents(selectMenu)],
                flags: MessageFlags.Ephemeral,
                fetchReply: true, // Обязательно для получения объекта сообщения
            });

            // 3. Запускаем таймаут на 60 секунд для автоматической разблокировки
            setTimeout(async () => {
                // Проверяем в БД, не удалена ли еще заявка (если админ уже принял/отклонил или успешно выбрал войс)
                const checkStatus = await db.query(
                    "SELECT * FROM family_applications WHERE user_id = $1",
                    [targetUserId],
                );
                if (checkStatus.rows.length === 0) return;

                // Удаляем эфемерное меню выбора у администратора, так как время вышло
                await interaction.deleteReply().catch(() => {});

                // Пересобираем контейнер с АКТИВНОЙ кнопкой (передаем false)
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

                // Возвращаем кнопке рабочий статус в канале заявки
                await mainMessage
                    .edit({ components: [enabledContainer.toJSON()] })
                    .catch(() => {});

                // Опционально: пингуем в чат заявки, что выбор отменен по таймауту
                await interaction.channel
                    .send({
                        content: `⚠️ Время выбора комнаты истекло. Кнопка обзвона снова активна.`,
                    })
                    .catch(() => {});
            }, 60000); // 60000 мс = 1 минута

            return;
        }
    }

    async submitRejectModal(interaction) {
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
            content: "Заявка отклонена, канал удаляется...",
            flags: MessageFlags.Ephemeral,
        });

        const targetUser = await interaction.client.users
            .fetch(targetUserId)
            .catch(() => null);
        if (targetUser) {
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
                        `> Причина: ${reason}\n> Дата отклонения: <t:${Math.floor(Date.now() / 1000)}:F>`,
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

    async handleVoiceSelect(interaction) {
        if (!isApplicationMod(interaction.member)) {
            return interaction.reply({
                content: "Недостаточно прав.",
                flags: MessageFlags.Ephemeral,
            });
        }

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

        await interaction.channel.send({
            content: `📢 <@${targetUserId}>, вы были вызваны на обзвон администратором <@${interaction.user.id}>!\nГолосовой канал: <#${voiceChannelId}>`,
        });

        const targetUser = await interaction.client.users
            .fetch(targetUserId)
            .catch(() => null);
        if (targetUser) {
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
                        `> Голосовой канал: <#${voiceChannelId}>\n> Дата события: <t:${Math.floor(Date.now() / 1000)}:F>`,
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
            "обзвона",
            interaction.user.id,
            voiceChannelId,
        );
        await logAction(interaction.guild, logContainer);

        return interaction.reply({
            content: "Кандидат успешно вызван на обзвон!",
            flags: MessageFlags.Ephemeral,
        });
    }
}

module.exports = new InviteAdmin();
