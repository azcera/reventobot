const { MessageFlags } = require("discord.js");
const { adminRoles } = require("../../config.json");

async function createChannel(
    interaction,
    { channelName, memberID, guild, categoryID },
) {
    const newChannel = await guild.channels.create({
        name: channelName,
        type: 0,
        parent: categoryID,
        permissionOverwrites: [
            {
                id: guild.roles.everyone.id,
                deny: ["ViewChannel"],
            },
            {
                id: memberID,
                allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"],
            },
            ...adminRoles
                .filter((roleId) => guild.roles.cache.has(roleId))
                .map((roleId) => ({
                    id: roleId,
                    allow: [
                        "ViewChannel",
                        "SendMessages",
                        "ReadMessageHistory",
                    ],
                })),
        ],
    });
    await interaction.reply({
        content: `Архив для <@${memberID}> создан - ${newChannel}`,
        flags: MessageFlags.Ephemeral,
    });
    return newChannel;
}

module.exports = { createChannel };
