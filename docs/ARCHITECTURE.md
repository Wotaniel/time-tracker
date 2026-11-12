# Architecture

Фактическое устройство CarpeDiem на 2026-11-12. Документ описывает код, а не
намерения: если расходится — прав код.

## Что это

Локальный трекер активности для macOS. Никаких сетевых запросов, вся база —
в `~/Library/Application Support/CarpeDiem/timetracker.db`. Стек: Electron 32,
React 18, TypeScript (strict), better-sqlite3, Vite + Tailwind. Около 6 900
строк в `src/`.

## Процессы

| процесс | где | что делает |
|---|---|---|
| main | `src/main/` | трекинг, БД, IPC, tray, окно |
| preload | `src/preload/index.ts` | `contextBridge` → `window.api`, типы из `src/shared` |
| renderer | `src/renderer/src/` | React, только через `window.api` |

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: false`
(нужен доступ к Node из preload), CSP задан в `index.html`. Renderer не пишет
в SQLite и не хранит данные в `localStorage`.

## Main: модули

| файл | ответственность |
|---|---|
| `index.ts` | жизненный цикл: окно, tray, autostart, порядок инициализации |
| `tracking-engine.ts` | опрос активного окна раз в секунду, склейка событий, прогресс раз в 5 с, созвоны, фильтры (self, lock, private, excluded) |
| `active-window.ts` | запуск нативного хелпера `active-win` с таймаутом 3 с; активное окно и список всех окон |
| `meeting-detect.ts` | чистые правила: Meet по ссылке и заголовку, Slack huddle по `Huddle:`, Zoom и Teams по окну встречи |
| `afk-detector.ts` | `powerMonitor`, порог из настроек, события AFK |
| `tracking-health.ts` | почему трекер не пишет: разрешение, подпись бандла, доступ к окнам |
| `database.ts` | открытие SQLite, PRAGMA, JS-функции для SQL, миграции, фасад над репозиториями |
| `ipc-handlers.ts` | 34 канала, валидация входа |
| `validation.ts` | строгая проверка даты (формат и существование дня) |
| `app-icons.ts` | иконки приложений через `mdfind`/`plutil`/`sips`, кэш |
| `safe-log.ts` | лог в файл `~/Library/Logs/CarpeDiem/main.log`, перехват `uncaughtException` и `unhandledRejection` |

### Как пишется событие

`poll()` раз в секунду: `getActiveWindow()` → смена app/title → закрыть прошлое
событие, создать новое с `duration: 0`. Пока окно не меняется, раз в 5 секунд
`updateEventProgress()` пишет `ts_end` и `duration` — так текущий кусок виден
в сводках, а краш не оставляет событие нулевым.

Созвон пишется не событием, а интервалом в `meetings`: раз в 5 секунд читается
**список всех окон**, появление окна созвона начинает интервал, исчезновение
закрывает. Для Meet (вкладка в браузере не видна в списке окон) допуск 20 минут.

## Данные

### Таблицы

| таблица | назначение |
|---|---|
| `events` | активность: `ts_start`, `ts_end`, `duration`, `app_name`, `app_bundle`, `window_title`, `url`, `category_id`, `task_key`, `is_afk`, `is_private` |
| `meetings` | созвоны отдельно от времени: `ts_start`, `ts_end` (NULL, пока идёт), `url`, `source` (чем поймали), `title` (название встречи или участник хаддла) |
| `categories` | категории продуктивности: `name`, `color`, `productivity` |
| `category_rules` | правила категоризации: `field`, `match_type`, `value` → категория, первое совпадение выигрывает |
| `app_tags` | теги work/neutral/distracting по приложению или домену |
| `settings` | key-value: `autostart`, `excludedApps`, `idleThreshold` |
| `schema_migrations` | применённые миграции |

### Правила времени

- Время хранится в UTC (ISO), дни считаются по локальной зоне.
- Событие через полночь принадлежит двум дням: дневные запросы выбирают по
  пересечению интервалов и обрезают по границам суток, `getDailyStats` режет
  событие по дням (`splitAcrossLocalDays`).
- Созвоны **не входят** в сумму активности: это наложение. День = объединение
  интервалов активности, созвоны показываются поверх.
- «Работа» = событие, у которого тег work у приложения **или** у домена.

### Миграции

`src/main/migrations/*.sql`, раннер — `src/main/db/migrations.ts`: каждая
миграция и запись в `schema_migrations` в одной транзакции. В сборке файлы
лежат в `Resources/migrations` (`extraResources`).

## IPC

34 канала, имена `domain:action`, единственный источник — `IPC_CHANNELS`
в `src/shared/types.ts`.

| домен | каналы |
|---|---|
| tracking | `getCurrent`, `pause`, `resume` |
| activities | `getDay`, `getRange`, `getSummary`, `getSummaryDetailed`, `getAfkTime`, `getDayCoverage`, `getUntagged` |
| stats | `getDaily`, `getTopApps`, `getHeatmap`, `getTagStats`, `getWork`, `getTasks` |
| meetings | `getDay`, `getRange` |
| categories | `getAll`, `upsert`, `delete` |
| rules | `getAll`, `upsert`, `delete`, `getUsage` |
| tags | `getAll`, `set`, `delete` |
| settings | `get`, `set` |
| export | `csv`, `json` |
| apps | `getIcon` |
| health | `getStatus`, `openAccessibilitySettings`, `changed` (push) |
| tracking | `activityChanged` (push) |

Валидация на стороне main: whitelist ключей настроек, `targetType`/`tag`,
`field`/`matchType` с лимитом длины, строгая проверка даты, clamp `days` 1..90.

## Renderer

| файл | что это |
|---|---|
| `App.tsx` | каркас: три раздела с подписями, шапка с текущей активностью, баннеры «почему не пишет» |
| `pages/TodayView.tsx` | «Сегодня»: герой, лента, «без тега», приложения, задачи дня, события |
| `pages/WeekView.tsx` | «Неделя»: 4 KPI с дельтой, бары по дням, топ приложений, heatmap |
| `pages/SettingsView.tsx` | настройки: autostart, порог AFK, экспорт, исключения, правила и категории |
| `components/DayLane.tsx` | лента дня: три дорожки, масштаб колесом, тултипы, метка «сейчас» |
| `components/EventList.tsx` | сырые события дня |
| `components/RulesSection.tsx` | категории и правила с числом срабатываний |
| `lib/` | палитра (`colors`), теги (`tags`), иконки (`app-icons`), домены (`domains`), форматирование (`format`) |

Сводки обновляются раз в 5 секунд; ничего не кэшируется между экранами, кроме
иконок приложений.

## Сборка и запуск

`npm run package:mac` = vite build → electron-builder → `scripts/install-mac.cjs`.

Подпись — самоподписанный сертификат `AliSwitcher Code Signing`, без Apple
Developer. Apple Events разрешены через `NSAppleEventsUsageDescription`
(`electron-builder.yml`), иначе браузер не отдаёт адрес вкладки.

Почему приложение ставится в `/Applications` скриптом: репозиторий лежит
в `~/Documents`, а iCloud Drive возвращает xattr на бандл через секунды после
сборки и ломает печать подписи — macOS перестаёт сопоставлять приложение
с записью в TCC. `afterPack` подписывает во временной папке и проверяет печать,
`install-mac` ставит копию наружу и проверяет заново.

## Проверки

- `npm test` — Vitest под `ELECTRON_RUN_AS_NODE=1 electron` (better-sqlite3
  собран под ABI Electron): чистые функции, репозитории на in-memory SQLite,
  раннер миграций, склейка созвонов, детектор созвонов.
- `npm run typecheck`, `npm run lint`, CI на push в `main` и на PR.
- `npm run report:day` — факты дня в markdown/JSON, вход для утреннего дайджеста.

## Известные ограничения

- Вкладку Meet в фоне не видно в списке окон — для неё допуск 20 минут.
- Событие, начавшееся до полуночи, попадает в оба дня, но события, у которых
  `ts_end` в другом дне, в сыром списке дня обрезаны по границе.
- Категорию можно назначить только правилом: ручного выбора в интерфейсе нет.
