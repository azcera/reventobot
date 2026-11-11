# Работа с Revento

## Цель и границы

- Делай минимальное изменение, достаточное для запроса. Сохраняй стиль и архитектуру.
- Не рефакторь, не переименовывай и не форматируй несвязанный код; не добавляй зависимости без необходимости.
- Уточняй только то, без чего нельзя продолжить. Иначе кратко укажи разумное допущение.
- После выполнения задачи и проверки остановись. Не продолжай исследование «на будущее».

## Контекст проекта

Revento — Discord-бот семейного сервера: заявки, капты и группы, архивы,
Telegram, интеграции Majestic RP. Веб-дашборд управляет ботом и сообщениями.

- Сервер: TypeScript (strict), компиляция в CommonJS, discord.js 14, Express 5, PostgreSQL через `pg`.
- Интерфейс: React 19, Vite 6, Tailwind 4; TSX и ES modules.
- `index.ts` создаёт Discord-клиент и Express, подключает дашборд и API,
  рекурсивно загружает `src/commands/` и файлы верхнего уровня `src/events/`.
- `src/events/ready.ts` — точка поиска запуска фоновых сервисов.
- `npm run build` проверяет типы и собирает сервер в `dist/`, общие браузерные модули в `dist/browser/`, интерфейс в `public/dashboard/`. `npm start` запускает `dist/index.js`.
- Подробные сценарии и настройки описаны в тематических разделах `README.md`.
  Эта карта помогает найти код, но не заменяет проверку текущей реализации.

## Карта поиска

| Задача | Начни здесь |
| --- | --- |
| Команды и обработка Discord | `src/commands/`, `src/events/messageCreate.ts`, `src/events/interactionCreate.ts` |
| Заявки и модерация | `src/features/invite/`, `src/services/adminApplicationCommands.ts` |
| Капты, регистрация, группы | `src/features/capture/` |
| Архивы | `src/features/archive/` |
| Расписание событий | `src/services/eventSchedule.ts`, `src/config/eventSchedule.ts`, `src/features/capture/groupOptions.ts` |
| Majestic: получение состава, план и применение синхронизации | `src/services/majesticClient.ts`, `src/features/majestic/syncPreview.ts`, `src/services/majesticSync.ts` |
| Majestic: фоновые задачи, Family Wars, членство | `src/services/majesticNicknameScheduler.ts`, `src/services/familyWars.ts`, `src/services/familyMembership.ts` |
| Telegram | `src/services/telegram*.ts`, `src/events/telegram*.ts` |
| Роли и префиксы ников | `src/services/rolePrefixSync.ts`, `src/utils/adminPrefix.ts`, `src/utils/parseDisplayName.ts` |
| HTTP API дашборда | `src/dashboard/routes.ts`; часть API контейнеров подключена в `index.ts` |
| Вход, права, сессии | `src/dashboard/auth.ts`, `src/dashboard/sessions.ts` |
| Настройки и каталог шаблонов | `src/dashboard/store.ts`, `src/dashboard/templates.json` |
| Редактирование и публикация сообщений | `src/dashboard/messageEditor.ts`, `src/dashboard/permanentMessages.ts`, `src/dashboard/navigationMessages.ts`, `src/services/containerMessageService.ts` |
| База и схема | `src/services/database.ts`; SQL также ищи в сервисе соответствующей функции |
| Оболочка и навигация UI | `frontend/src/App.tsx`, `frontend/src/main.tsx` |
| Страницы UI | `frontend/src/pages/{Templates,Settings,Majestic}.tsx` |
| Редактор, предпросмотр, общие элементы | `frontend/src/components/`, `frontend/src/lib/` |
| Стили и подсказки UI | `frontend/src/styles.css`, `frontend/src/guides.tsx`, `public/theme.css` |
| Общий Markdown и документы шаблонов | `public/markdown.ts`, `public/component-markdown.ts`, `public/template-document.ts`, `public/template-layout.ts`, `src/services/markdownContainer.ts` |
| Диагностика Majestic | `scripts/check-majestic.ts`, `scripts/preview-majestic.ts`; назначение и ограничения — в README |

## Как экономить контекст

1. Начни с `git status --short`, затем выбери область по карте. Не перезаписывай чужие изменения.
2. Найди символ или строку через `rg -n` в выбранном файле/каталоге.
   Для списка файлов используй `rg --files src/нужная-область tests`.
3. Читай найденный участок, его непосредственные зависимости и соответствующий тест.
   Не читай весь `routes.ts`, `store.ts`, `App.tsx` или README ради одного обработчика.
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
  Общие исходники `public/*.ts` используются сервером и браузером;
  проверь обоих потребителей перед изменением. Генерируемые `dist/` не редактируй.
- Настройки и шаблоны проходят через `src/dashboard/store.ts`; учитывай значения
  по умолчанию, сохранённые данные и валидацию в маршрутах.
- Сохраняй проверки авторизации, прав, CSRF и аудит при изменении API.
- Схема PostgreSQL инициализируется кодом; сохраняй совместимость существующих данных.
- `npm start` запускает реальные подключения и обработчики. Не используй его
  как проверку синтаксиса. Скрипты интеграций могут обращаться к внешним сервисам.
- Проверки выполняй на фикстурах и моках; не меняй рабочие роли, ники,
  сообщения Discord или данные БД ради тестирования без явного запроса.

## Проверки

- Сначала ближайший тест: `npm run build:test`, затем `node --test dist/tests/<имя>.test.js`.
  Тесты используют встроенный `node:test`; ищи файл по имени области или импорту модуля.
- Общий прогон серверных тестов: `npm test`.
- После изменения интерфейса: `npm run build`.
- Браузерная проверка: `npm run test:dashboard` (автоматически выполняет сборку).
  Для точечного сценария: после сборки `npx playwright test tests/browser/dashboard.spec.ts -g "название"`.
  Конфигурация проверяет desktop и mobile, сервер фикстур — `tests/browser/server.ts` (компилируется в `dist/`), порт 4173.
  Chromium при необходимости устанавливается через `npx playwright install chromium`.
- Общие фикстуры дашборда: `tests/helpers/dashboardFixture.ts`.
- Проверка типов: `npm run typecheck` (сервер, React, тесты и конфигурации). Отдельного lint нет.
- Для правок только документации достаточно проверить точность путей, команд и diff;
  прогон приложения не нужен. Не расширяй проверки после достаточного подтверждения.

## Ответ после изменений

Коротко: 1–3 пункта об изменении и причине, изменённые файлы, выполненные проверки
и способ проверки. Риски и непроверенные места укажи, если они есть.
При изменении структуры или команд обновляй только соответствующую часть этой карты;
не превращай AGENTS.md в журнал работ и не дублируй подробности README.
