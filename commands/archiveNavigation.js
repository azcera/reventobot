const { getComponents } = require("./utility/createButtons");
const { getMemberByStat } = require("./utility/getChannelViewers");

module.exports = {
  name: "narchive",
  description: "Создает навигацию для конкретного пользователя",
  async execute(message, args) {
    await message
      .delete()
      .catch((err) => console.log("Не удалось удалить сообщение:", err));

    const channelName = message.channel.name;
    const stat = channelName.split("-").at(-1);

    // Находим пользователя по stat
    const member = await getMemberByStat(message.channel, stat);

    if (!member) {
      return message.channel.send("Пользователь не найден.");
    }

    await message.channel.send({
      content: `<@${member.id}>, это твой личный канал-архив, куда ты можешь отправлять:

**- Откаты с мероприятий
- Откаты с каптов
- Заявки на повышение
- Задавать вопросы хай-составу**
**Зачем отправлять откаты?**

Это все нужно для получения TIER, который показывает уровень твоей игры в нашей семье. Ниже ты можешь увидеть кнопки с навигацией, которые помогут тебе быстро найти нужный контент. 

Просто попробуй - дальше научишься. Первым заданием для тебя будет отправить скриншот своих персонажей (можно сделать, когда входишь в игру) и скрин с планшета (нужно найти себя в списке коллег), где видно кто и когда тебя принял.`,
      allowedMentions: { users: [member.id] },
      components: getComponents(),
    });
  },
};
