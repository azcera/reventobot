const {
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
} = require("discord.js");
const db = require("../../../commands/utility/db.js");
const {
    isApplicationMod,
    logAction,
    buildContainer,
} = require("../../../commands/utility/inviteUtils");

async function handleVoiceSelect(interaction) {
    if (!isApplicationMod(interaction.member)) {
        return interaction.reply({
            content: "❌ Недостаточно прав.",
            flags: [MessageFlags.Ephemeral],
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
            content: "❌ Заявка не найдена.",
            flags: [MessageFlags.Ephemeral],
        });
    const appData = res.rows[0];

    await interaction.channel.send({
        content: `> 📢 <@${targetUserId}>, вы были вызваны на обзвон.\n> Администратор: <@${interaction.user.id}>!\n> Голосовой канал: <#${voiceChannelId}>`,
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
        content: "✅ Кандидат успешно вызван на обзвон!",
        flags: [MessageFlags.Ephemeral],
    });
}

module.exports = handleVoiceSelect;
