const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SeparatorSpacingSize,
    MessageFlags,
} = require("discord.js");

const ADMIN_ROLES = process.env.ADMIN_ROLES.split(',');

// Проверка, является ли пользователь администратором заявок
function isApplicationMod(member) {
    return (
        member?.roles.cache.some((role) => ADMIN_ROLES.includes(role.id)) ||
        false
    );
}

// Централизованная отправка логов в аудит-канал

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

// Хранилище цветов для админских действий
const colors = {
    green: 0x2ecc71,
    red: 0xe74c3c,
    orange: 0xe67e22,
};

// Универсальный сборщик контейнеров (V2 Components)
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
    isInterviewDisabled = false,
) {
    const timestamp = Math.floor(Date.now() / 1000);
    let accentColor = null; // Изначально цвета нет
    let title = "# 📝 Заявка в семью\nНиже выведена информация о кандидате.";
    let statusText = `\n**Статус:** На рассмотрении\nВремя отправления: <t:${timestamp}:F> (<t:${timestamp}:R>)`;

    // Динамическая сборка содержимого на основе действия модерации
    if (action === "отправления") {
        title +=
            " Если вы администратор: используйте кнопки ниже для управления заявкой.";
        if (Array.isArray(ADMIN_ROLES) && ADMIN_ROLES.length > 0) {
            statusText +=
                "\n" + ADMIN_ROLES.map((role) => `<@&${role}>`).join(" ");
        }
    } else if (action === "принятия") {
        accentColor = colors.green;
        title = "# ✅ Заявка одобрена";
        statusText = `\n**Статус:** Принят в семью\n**Администратор:** <@${adminId}>\nВремя решения: <t:${timestamp}:F>`;
    } else if (action === "отклонения") {
        accentColor = colors.red;
        title = "# ❌ Заявка отклонена";
        statusText = `\n**Статус:** Отклонено\n**Администратор:** <@${adminId}>\n**Причина:** ${extraInfo || "Не указана"}\nВремя решения: <t:${timestamp}:F>`;
    } else if (action === "обзвона") {
        accentColor = colors.orange;
        title = "# 📞 Вызов на обзвон";
        statusText = `\n**Статус:** Вызван на обзвон\n**Администратор:** <@${adminId}>\n**Комната:** <#${extraInfo}>\nВремя вызова: <t:${timestamp}:F>`;
    }

    const container = new ContainerBuilder()
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

    // Накладываем цветную полоску ТОЛЬКО если это админское действие (принятие/отказ/обзвон)
    if (accentColor) {
        container.setAccentColor(accentColor);
    }

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

        container
            .addSeparatorComponents(
                new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
            )
            .addActionRowComponents(actionRow);
    }
    return container;
}

module.exports = { isApplicationMod, logAction, buildContainer };
