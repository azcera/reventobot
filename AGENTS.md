# Работа с Revento

## Цель и границы

- Делай минимальное изменение, достаточное для запроса. Сохраняй стиль и архитектуру.
- Не рефакторь, не переименовывай и не форматируй несвязанный код; не добавляй зависимости без необходимости.
- Уточняй только то, без чего нельзя продолжить. Иначе кратко укажи разумное допущение.
- После выполнения задачи и проверки остановись. Не продолжай исследование «на будущее».

## Контекст проекта

Revento — Discord-бот семейного сервера: заявки, капты и группы, архивы,
Telegram, интеграции Majestic RP. Веб-дашборд управляет ботом и сообщениями.

- Сервер: JavaScript CommonJS, discord.js 14, Express 5, PostgreSQL через `pg`.
- Интерфейс: React 19, Vite 6, Tailwind 4; JSX и ES modules.
- `index.js` создаёт Discord-клиент и Express, подключает дашборд и API,
  рекурсивно загружает `src/commands/` и файлы верхнего уровня `src/events/`.
- `src/events/ready.js` — точка поиска запуска фоновых сервисов.
- `npm run build` собирает `frontend/` в `public/dashboard/`; бот отдаёт сборку.
- Подробные сценарии и настройки описаны в тематических разделах `README.md`.
  Эта карта помогает найти код, но не заменяет проверку текущей реализации.

## Карта поиска

| Задача | Начни здесь |
| --- | --- |
| Команды и обработка Discord | `src/commands/`, `src/events/messageCreate.js`, `src/events/interactionCreate.js` |
| Заявки и модерация | `src/features/invite/`, `src/services/adminApplicationCommands.js` |
| Капты, регистрация, группы | `src/features/capture/` |
| Архивы | `src/features/archive/` |
| Расписание событий | `src/services/eventSchedule.js`, `src/config/eventSchedule.js`, `src/features/capture/groupOptions.js` |
| Majestic: получение состава, план и применение синхронизации | `src/services/majesticClient.js`, `src/features/majestic/syncPreview.js`, `src/services/majesticSync.js` |
| Majestic: фоновые задачи, Family Wars, членство | `src/services/majesticNicknameScheduler.js`, `src/services/familyWars.js`, `src/services/familyMembership.js` |
| Telegram | `src/services/telegram*.js`, `src/events/telegram*.js` |
| Роли и префиксы ников | `src/services/rolePrefixSync.js`, `src/utils/adminPrefix.js`, `src/utils/parseDisplayName.js` |
| HTTP API дашборда | `src/dashboard/routes.js`; часть API контейнеров подключена в `index.js` |
| Вход, права, сессии | `src/dashboard/auth.js`, `src/dashboard/sessions.js` |
| Настройки и каталог шаблонов | `src/dashboard/store.js`, `src/dashboard/templates.json` |
| Редактирование и публикация сообщений | `src/dashboard/messageEditor.js`, `src/dashboard/permanentMessages.js`, `src/dashboard/navigationMessages.js`, `src/services/containerMessageService.js` |
| База и схема | `src/services/database.js`; SQL также ищи в сервисе соответствующей функции |
| Оболочка и навигация UI | `frontend/src/App.jsx`, `frontend/src/main.jsx` |
| Страницы UI | `frontend/src/pages/{Builder,Templates,Settings,Majestic}.jsx` |
| Редактор, предпросмотр, общие элементы | `frontend/src/components/`, `frontend/src/lib/` |
| Стили и подсказки UI | `frontend/src/styles.css`, `frontend/src/guides.jsx`, `public/theme.css` |
| Общий Markdown и документы шаблонов | `public/markdown.js`, `public/component-markdown.js`, `public/template-document.js`, `public/template-layout.js`, `src/services/markdownContainer.js` |
| Диагностика Majestic | `scripts/check-majestic.js`, `scripts/preview-majestic.js`; назначение и ограничения — в README |

## Как экономить контекст

1. Начни с `git status --short`, затем выбери область по карте. Не перезаписывай чужие изменения.
2. Найди символ или строку через `rg -n` в выбранном файле/каталоге.
   Для списка файлов используй `rg --files src/нужная-область tests`.
3. Читай найденный участок, его непосредственные зависимости и соответствующий тест.
   Не читай весь `routes.js`, `store.js`, `App.jsx` или README ради одного обработчика.
4. README сначала просматривай по заголовкам: `rg -n '^##' README.md`.
5. Поиск по всему репозиторию нужен, если локальный не дал ответа или меняется общий контракт.
   Объединяй независимые поиски, ограничивай вывод; не выгружай целые каталоги.
6. Не читай для ориентации `node_modules/`, `package-lock.json`, `public/dashboard/`,
   `output/`, `test-results/`, `playwright-report/`, `.git/`, бинарные ресурсы.
   Lockfile открывай только для задачи о зависимостях.
7. Не открывай `.env`, `.env.majestic.local`, `.majestic-preview.json` ради знакомства
   с проектом и не выводи секреты. Названия параметров смотри в `.env*.example`
   и по обращениям к `process.env` в нужном модуле.

## Правки и ограничения

- `public/dashboard/` — генерируемая сборка, правь исходники `frontend/`.
  Остальные JS-файлы в `public/` могут быть исходными общими модулями,
  используемыми сервером и браузером; проверь потребителей перед изменением.
- Настройки и шаблоны проходят через `src/dashboard/store.js`; учитывай значения
  по умолчанию, сохранённые данные и валидацию в маршрутах.
- Сохраняй проверки авторизации, прав, CSRF и аудит при изменении API.
- Схема PostgreSQL инициализируется кодом; сохраняй совместимость существующих данных.
- `npm start` запускает реальные подключения и обработчики. Не используй его
  как проверку синтаксиса. Скрипты интеграций могут обращаться к внешним сервисам.
- Проверки выполняй на фикстурах и моках; не меняй рабочие роли, ники,
  сообщения Discord или данные БД ради тестирования без явного запроса.

## Проверки

- Сначала ближайший тест: `node --test tests/<имя>.test.js`.
  Тесты используют встроенный `node:test`; ищи файл по имени области или импорту модуля.
- Общий прогон серверных тестов: `npm test`.
- После изменения интерфейса: `npm run build`.
- Браузерная проверка: `npm run test:dashboard` (автоматически выполняет сборку).
  Для точечного сценария: после сборки `npx playwright test tests/browser/dashboard.spec.mjs -g "название"`.
  Конфигурация проверяет desktop и mobile, сервер фикстур — `tests/browser/server.cjs`, порт 4173.
  Chromium при необходимости устанавливается через `npx playwright install chromium`.
- Общие фикстуры дашборда: `tests/helpers/dashboardFixture.js`.
- Скриптов lint/typecheck в `package.json` сейчас нет. Не придумывай команды.
- Для правок только документации достаточно проверить точность путей, команд и diff;
  прогон приложения не нужен. Не расширяй проверки после достаточного подтверждения.

## Ответ после изменений

Коротко: 1–3 пункта об изменении и причине, изменённые файлы, выполненные проверки
и способ проверки. Риски и непроверенные места укажи, если они есть.
При изменении структуры или команд обновляй только соответствующую часть этой карты;
не превращай AGENTS.md в журнал работ и не дублируй подробности README.
