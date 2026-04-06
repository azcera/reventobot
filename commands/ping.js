module.exports = {
  name: "ping",
  description: "Пингует бота",
  async execute(message, args) {
    const sent = await message.channel.send("Ping ...");
    const latency = sent.createdTimestamp - message.createdTimestamp;
    await message
      .delete()
      .catch((err) => console.log("Не удалось удалить сообщение:", err));
    return await sent.edit(`Ping ${latency}`);
  },
};
