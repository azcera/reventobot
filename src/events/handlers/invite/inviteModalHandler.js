const { MessageFlags, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder } = require("discord.js");
const db = require("../../../commands/utility/db.js");
const { logAction, buildContainer } = require("../../../commands/utility/inviteUtils");

async function submitRejectModal(interaction) {
    const targetUserId = interaction.customId.split("_")[3];
    const reason = interaction.fields.getTextInputValue("reject_reason");

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

    await interaction.reply({
        content: `✅ Заявка <@${targetUserId}> отклонена `,
        flags: [MessageFlags.Ephemeral],
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

module.exports = submitRejectModal;
