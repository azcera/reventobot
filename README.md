# Revento Discord Bot

Бот для управления семейным сервером Revento (заявки, капты, архивы,
Telegram-интеграция).

## 🚀 Быстрый старт

1. `npm install`
2. Заполните `.env`
3. `node index.js`

Чтобы получать сообщения из Discord от Telegram-бота в личный чат:

1. Создайте бота через [@BotFather](https://t.me/BotFather) и сохраните токен.
2. Откройте созданного бота в Telegram и нажмите «Начать».
3. Откройте `https://api.telegram.org/bot<ТОКЕН>/getUpdates` и найдите
   число в поле `message.chat.id`. Не передавайте токен другим людям.
4. Укажите в `.env` и перезапустите приложение:

```env
DISCORD_NOTIFICATION_CHANNEL_ID=ID_канала_Discord
TG_NOTIFICATION_BOT_TOKEN=токен_бота
TG_NOTIFICATION_CHAT_ID=ID_личного_чата
```

Бот должен видеть канал и иметь доступ к содержимому сообщений. Пересылаются
текст, ссылки на вложения и имя автора; сообщения ботов пропускаются.
Уведомления должны быть включены в настройках чата с Telegram-ботом.

## 📁 Структура проекта

- `src/commands/` — Точки входа для slash- и префиксных команд.
- `src/features/` — **Основная бизнес-логика**, сгруппированная по доменам
- `src/services/` — Глобальные сервисы (PostgreSQL, Telegram API).
- `src/utils/` — Переиспользуемые утилиты.
- `src/events/` — Глобальные слушатели событий Discord.

## 🧩 Как добавить новую фичу

1. Создайте папку в `src/features/your-feature/`.
2. Добавьте обработчики событий в `src/events/interactionCreate.js`.
3. Если нужна новая команда, добавьте её в `src/commands/`.
