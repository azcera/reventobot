// src/commands/utility/inviteUtils.js
const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const ADMIN_ROLES = require("../../../config.json").adminRoles;

/**
 * Проверка, является ли пользователь администратором заявок
 */
function isApplicationMod(member) {
    return member?.roles.cache.some((role) => ADMIN_ROLES.includes(role.id)) || false;
}

/**
 * Централизованная отправка красивых логов в канал аудита
 */
async function logAction(guild, container) {
    const logChannelId = process.env.LOG_INVITE_CHANNEL_ID;
    if (!logChannelId) return;
    const logChannel = guild.channels.cache.get(logChannelId);
    if (logChannel) {
        await logChannel.send({
            components: [container.toJSON()],
            flags: [MessageFlags.IsComponentsV2],
        }).catch((err) => console.error("[Log Error]", err));
    }
}

/**
 * Универсальный сборщик контейнеров (V2 Components) с защитой от дублирования кода
 */
async function buildContainer(userId, nameInput, age, f3, f4, f5, action, adminId = null, extraInfo = null, isInterviewDisabled = false) {
    const timestamp = Math.floor(Date.now() / 1000);
    let accentColor = 0x34495e; // Серый дефолтный
    let title = "# 📝 Заявка в семью\nНиже выведена информация о кандидате.";
    let statusText = `\n**Статус:** На рассмотрении\nВремя отправления: <t:${timestamp}:F> (<t:${timestamp}:R>)`;

    if (action === "отправления" && ADMIN_ROLES?.length > 0) {
        title += " Если вы администратор: используйте кнопки ниже для управления заявкой.";
        statusText += "\n" + ADMIN_ROLES.map((role) => `<@&${role}>`).join(" ");
    } else if (action === "принятия") {
        accentColor = 0x2ecc71; // Зеленый
        title = "# ✅ Заявка одобрена";
        statusText = `\n**Статус:** Принят в семью\n**Администратор:** <@${adminId}>\nВремя решения: <t:${timestamp}:F>`;
    } else if (action === "отклонения") {
        accentColor = 0xe74c3c; // Красный
        title = "# ❌ Заявка отклонена";
        statusText = `\n**Статус:** Отклонено\n**Администратор:** <@${adminId}>\n**Причина:** ${extraInfo || "Не указана"}\nВремя решения: <t:${timestamp}:F>`;
    } else if (action === "обзвона") {
        accentColor = 0xe67e22; // Оранжевый
        title = "# 📞 Вызов на обзвон";
        statusText = `\n**Статус:** Вызван на обзвон\n**Администратор:** <@${adminId}>\n**Комната:** <#${extraInfo}>\nВремя вызова: <t:${timestamp}:F>`;
    }

    const container = new ContainerBuilder()
        .setAccentColor(accentColor)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(title))
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `### Пользователь: <@${userId}>\n### 1. Никнейм\n${nameInput}\n### 2. Возраст (ООС)\n${age}\n### 3. Как узнали о семье, чем заинтересовала?\n${f3}\n### 4. Где ранее играли (проекты, серверы, семьи)?\n${f4}\n### 5. Чего ждете от семьи, чем хотите заниматься?\n${f5}`,
            ),
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));

    if (action === "отправления") {
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`invite_accept_${userId}`)
                .setLabel("✅ Принять")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`invite_interview_${userId}`)
                .setLabel("📞 Вызвать на обзвон")
                .setStyle(ButtonStyle.Primary)
                .setDisabled(isInterviewDisabled), 
            new ButtonBuilder()
                .setCustomId(`invite_reject_${userId}`)
                .setLabel("❌ Отклонить")
                .setStyle(ButtonStyle.Danger),
        );
        container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large)).addActionRowComponents(actionRow);
    }
    return container;
}

module.exports = { isApplicationMod, logAction, buildContainer };
