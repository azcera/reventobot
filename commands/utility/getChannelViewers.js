async function getChannelViewers(channel) {
  let members = channel.guild.members.cache;

  if (members.size === 0) {
    members = await channel.guild.members.fetch();
  }

  const data = [];

  members.forEach((member) => {
    if (channel.permissionsFor(member).has("ViewChannel")) {
      data.push(member);
    }
  });

  return data;
}

module.exports = { getChannelViewers };
