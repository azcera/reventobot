const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
require("dotenv").config();

const apiId = 25984937; // Ваш API ID из .env
const apiHash = "ca79edeb3041ffb1ec655fa00de11af1"; // Ваш API Hash из .env
const stringSession = new StringSession("");

const client = new TelegramClient(stringSession, apiId, apiHash, {
  connectionRetries: 5,
});

async function main() {
  console.log("Запуск авторизации...");
  await client.start({
    phoneNumber: async () =>
      await new Promise((resolve) => {
        const readline = require("readline").createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        readline.question(
          "Введите номер телефона (например, 79959868231): ",
          (phone) => {
            readline.close();
            resolve(phone);
          },
        );
      }),
    password: async () =>
      await new Promise((resolve) => {
        const readline = require("readline").createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        readline.question(
          "Введите 2FA пароль (если есть, иначе нажмите Enter): ",
          (pass) => {
            readline.close();
            resolve(pass);
          },
        );
      }),
    phoneCode: async () =>
      await new Promise((resolve) => {
        const readline = require("readline").createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        readline.question("Введите код из Telegram: ", (code) => {
          readline.close();
          resolve(code);
        });
      }),
    onError: (err) => console.log(err),
  });

  console.log(
    "\n✅ УСПЕХ! Скопируйте строку ниже и вставьте её в TG_SESSION на Replit:\n",
  );
  console.log(client.session.save());
  console.log("\n========================================\n");
  process.exit(0);
}

main();
