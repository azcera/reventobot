const { StringSelectMenuOptionBuilder } = require("discord.js");

const optionsMap = {
  drop1: { icon: "🎈", target: "ДРОП", time: "12:00" },
  drop2: { icon: "🎈", target: "ДРОП", time: "16:00" },
  drop3: { icon: "🎈", target: "ДРОП", time: "20:00" },
  dillers1: { icon: "💊", target: "ДИЛЛЕРЫ", time: "10:45" },
  dillers2: { icon: "💊", target: "ДИЛЛЕРЫ", time: "18:45" },
  ceha1: { icon: "🚛", target: "ЦЕХА", time: "14:45" },
  ceha2: { icon: "🚛", target: "ЦЕХА", time: "22:45" },
  tainiki1: { icon: "🪙", target: "ТАЙНИКИ", time: "10:00" },
  tainiki2: { icon: "🪙", target: "ТАЙНИКИ", time: "14:00" },
  tainiki3: { icon: "🪙", target: "ТАЙНИКИ", time: "18:00" },
  tainiki4: { icon: "🪙", target: "ТАЙНИКИ", time: "22:00" },
};

let options = [];

for (const key in optionsMap) {
  let item = optionsMap[key];
  options = [
    ...options,
    new StringSelectMenuOptionBuilder()
      .setLabel(item.icon + " " + item.target + " " + item.time)
      .setValue(key),
  ];
}

options = [
  ...options,
  new StringSelectMenuOptionBuilder().setLabel("ДРУГОЕ").setValue("other"),
];

module.exports = { options, optionsMap };
