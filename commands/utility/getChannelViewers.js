async function getChannelViewers(channel) {
  const data = [];

  const members = await channel.guild.members.fetch();
  members.forEach((member) => {
    if (channel.permissionsFor(member).has("ViewChannel")) {
      data.push(member);
    }
  });

  return data;
}

module.exports = { getChannelViewers };
