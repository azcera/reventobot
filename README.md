# Revento Discord Bot

Бот для управления семейным сервером Revento (заявки, капты, архивы,
Telegram-интеграция).

## 🚀 Быстрый старт

1. `npm install`
2. Заполните `.env`
3. `node index.js`

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
