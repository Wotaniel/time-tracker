# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Calls are tracked in the background, not only when focused** — a huddle disappeared from tracking the moment you switched to Figma. The engine now reads the list of open windows every 5 seconds: the call window appearing starts the interval, its disappearance (pressing «end call») finishes it, and the end is stamped at the last moment it was seen. For Google Meet, whose tab is not visible in the window list, the old 10-minute safety net remains
- **The `active-win` helper now has a timeout and is killed on hang** — the package called `execFile` without a timeout, so a stuck helper stayed alive while `setInterval` kept spawning new ones. `src/main/active-window.ts` runs the helper itself with a 3-second timeout

### Changed
- **The «Без тега» block disappears when the queue is empty** — it used to take a full card to say «Всё размечено», which is noise on a day when there is nothing to triage. The rules entry point stays in Settings

### Fixed
- **Work time ignored the browser** — «Сегодня» computed work from the app tag only, while «Неделя» used the app **or domain** tag. Because Brave itself is untagged but `jira.int.agrd.dev`, `figma.com` and `github.com` are tagged work, the day card showed 171 min where the week card showed 247. Work is now counted by app **or domain** everywhere, and the «только работа» filter shows each app's work share instead of its whole time

### Added
- **Calls are detected beyond Google Meet** — the detector only knew Meet URLs, so a Slack huddle was invisible even though it is the same parallel conversation. New `src/main/meeting-detect.ts` recognises Meet by link (and no longer treats `meet.google.com/home` as a call), Slack by the `Huddle:` window title (the real one: `Huddle: @person - company - Slack 🎤`, not `Huddle Preview`), Zoom by a `Zoom Meeting`/`Zoom Webinar` window, and Teams by an explicit meeting window. The source is written into the meeting interval. Rules live in one testable place: 12 tests, including titles taken from the real database. For Teams the rule is deliberately conservative — a topic-only window looks exactly like a chat, so a missed call is preferred over a phantom one

### Added
- **`npm run report:day`** — facts about a day in a machine-readable form, so the morning digest has something to read: `--date`, `--days`, `--format md|json`. Prints activity / AFK / not recorded, top apps, top sites, Jira task keys with time, merged meetings, and gaps over 15 minutes. Read-only, runs under `ELECTRON_RUN_AS_NODE=1 electron` because `better-sqlite3` is built for Electron's ABI; the database path can be overridden with `CARPEDIEM_DB`

### Fixed
- **An event crossing midnight vanished from the next day** — day queries filtered by `ts_start` only, so work from 23:50 to 00:30 was counted entirely for yesterday and today lost the tail. Day queries now select by overlap and clamp to the day bounds, and `getDailyStats` splits an event across local days (`splitAcrossLocalDays`)
- **`getTopApps` inflated percentages** — the denominator was the sum of the returned top-N rows, so top-10 always added up to 100%. It now uses the total time of the period
- **`validateDate` accepted `2026-13-99`** — the regex passed and `localDayBounds` then threw `RangeError` deep inside IPC. The check moved to `src/main/validation.ts` and now verifies the calendar day itself

### Added
- **Tests and CI** — the project had zero tests while most of the core was rewritten. Vitest now runs 23 tests in 0.6 s against in-memory SQLite: Jira key and domain parsing, local day bounds, the migration runner (all tables created, second run is a no-op, Google Meet events moved to meetings), `getDailyStats` range and per-day grouping, `getDayCoverage`, `getUntagged`, and meeting range queries. Because `better-sqlite3` is built for Electron's ABI, tests run under `ELECTRON_RUN_AS_NODE=1 electron` — that is why the CI job uses a macOS runner. `npm run typecheck`, `npm run lint` and `npm test` run on every push to `main` and every PR

### Fixed
- **Looking at the stats left a hole in the day** — the engine closed the current event and recorded nothing while CarpeDiem's own window was in front, so the day strip had gaps and the header read «Idle». Own window is now tracked like any other app under the name `CarpeDiem`; it is untagged, so it shows up in the «Без тега» queue instead of inflating work
- **«Приложение не работало» was a wrong label** — a gap means only «no events», which happens when the app was closed, paused, or its own window was open. The tooltip now says «Нет событий» and lists the causes instead of asserting one
- **One call showed as two slivers** — a restart closes the meeting interval, so a single call became two rows with a one-minute gap and the strip drew them as separate strokes. Adjacent intervals of the same meeting are merged (gap ≤ 2 min) for both the strip and the total

### Added
- **Rules and categories in Settings** — the API for categories and automation rules existed from the start (`categories:*`, `rules:*`, seeded by migrations) but had no user entry point at all: rules could not be seen, added or removed. Settings now lists categories with their productivity, lets you create and delete them, shows every rule as «field · match · value → category» and adds new ones with validation. The «Без тега» queue links here, closing the loop: classify a domain once by hand, then let a rule do it automatically
- **«Без тега» — очередь разбора вместо невидимых часов** — new `activities:getUntagged` returns apps and domains that have no tag for the day, with time. «Не записано» and «без тега» are different things: the first means the app was not running, the second means the time exists but its category is unknown. The queue sits above the app list (action before passive reading) and every row carries a tag menu, so a domain can be classified once — for the past and the future

### Changed
- **«Неделя» replaces the old stats screen** — a week is a different question than a day, so it gets a different composition: four KPIs with a delta to the previous week (activity, work, distractions, meetings), a stacked bar chart by day with a legend, top apps, and the heatmap moved behind a toggle. When the previous week has no data the cards show «—» and one line explains why, instead of repeating «нет базы для сравнения» four times. Meetings now have a range query (`meetings:getRange`) so the call KPI works for a period
- **UI hierarchy rebuild, stage 1** — «Сегодня» no longer shows the same day three times at equal weight. New structure: one hero metric (activity + work / meetings / AFK / not recorded), a three-lane day strip (activity, meetings, idle gaps) with an hour scale, a «сейчас» marker and a legend, then the app list; raw events moved behind a button, and the duplicate total card is gone. Navigation is three labelled sections (Сегодня / Неделя / Настройки) instead of four unlabelled icons; «Работа» stopped being a separate screen — it is a «только работа» filter plus a Jira tasks section inside «Сегодня». App colours are now semantic (work / neutral / distracting) instead of a hash palette that meant nothing
- **Day data refreshes together** — meetings and day coverage were fetched once when the screen opened, so a meeting that started later never appeared until the date changed. Everything now refreshes on the same 5-second tick
- **`getDailyStats` returned only today** — the range was computed from `days` and then ignored (bounds were taken from today), so the stats chart showed one filled day and zeros around it. Bounds now come from the real range, and days are grouped in local time instead of UTC

### Added
- **Meetings as a separate track** — a call and work in Figma happen at the same moment, so they must not be summed: that was the Google Meet double count. Meetings now live in their own `meetings` table (migration 007) as actual intervals, opened when `meet.google.com/...` appears and extended while the call is presumably running (10-minute timeout), and shown as a lane above the activity timeline plus a «В созвонах X (входит в активность)» line in the day card. The day total stays a union of activity intervals, so no hour is counted twice

### Fixed
- **A hung `active-win` helper silently killed tracking and leaked processes** — `setInterval` started a new poll every second, each spawn of the helper blocked on a permission check, and within minutes dozens of processes were stuck while the tracker recorded nothing. Ticks no longer overlap, a tick stuck past 10 seconds is dropped with an error, `activeWin` failures are logged once instead of every second, and after 10 failures in a row the UI shows «Активное окно не читается» (`window-access` block reason) instead of an empty timeline
- **Current activity was invisible until the window changed** — an event got its duration only when closed, and every summary is `SUM(duration)`, so the stretch you are in right now counted as 0 minutes. The engine now writes progress (`ts_end` + `duration`) every 5 seconds while the window stays the same, so totals are live and a crash leaves an event with a real duration instead of a zero one
- **A day looked shorter than it was** — the day view showed only active time, so it was impossible to tell where the rest went. New `activities:getDayCoverage` and a breakdown under the total: active / AFK / not recorded / span from the first event
- **Google Meet time counted twice** — a parallel background event ran next to normal events and landed in the same `SUM(duration)`. Its close path also produced negative durations (`ts_end` before `ts_start`) when the meeting ended after the user had already switched away. The background event is gone: while you are on a call, your time is already recorded by the foreground events, and meeting state is still used to suppress AFK
- **Apple Events to the browser were refused** — `active-win` reads the active tab URL through Apple Events, and without `NSAppleEventsUsageDescription` in `Info.plist` macOS refuses the request silently (tccd: `Refusing TCCAccessRequestIndirect ... without NSAppleEvents`). Result: `url` always empty, browsers never split into sites. Added the usage description, so macOS now asks for Automation permission once
- **Build could not sign a bundle inside a synced folder** — iCloud re-adds `com.apple.FinderInfo` to nested `.app`/`.framework` faster than `codesign` runs, so all signing attempts failed with `resource fork, Finder information, or similar detritus not allowed`. Signing now happens in a system temp directory, and the signed bundle is copied back with `ditto --noextattr`
- **`install:mac` failed when LaunchServices answered -609** right after replacing the bundle — launch is retried, and a failed launch no longer fails the build

### Changed
- **AFK threshold defaults to 10 minutes** — 2 minutes cut ordinary reading and thinking into AFK, which made the day look like a fraction of what it was. The setting keeps its 60 s minimum, the slider now goes up to 30 minutes
- **Silent tracking failure when the Accessibility permission is missing** — without the macOS Accessibility permission `active-win` cannot read the active window, so the tracker records nothing. `index.ts` waited for the permission in a `setInterval` with no timeout, no UI and no log after the first line, so a broken app looked exactly like a working one with an empty timeline. New `AccessibilityGate` (`src/main/accessibility-gate.ts`) logs the wait and reminds every minute, exposes the state over IPC (`permissions:getStatus` / `permissions:openSettings`), the window shows a banner with «Открыть настройки», and the tray menu shows a warning item. A granted permission is picked up within 2 seconds — no restart needed
- **App tracked itself** — `SELF_APP_NAMES` was computed at module import, before `app.setName('CarpeDiem')` ran, so the set held `time-tracker` instead of `CarpeDiem` and the app recorded its own window as real work. Self-detection now compares the active window's owner PID with `process.pid` instead of relying on names
- **Broken code signature passed the build** — `after-pack.cjs` signed the bundle but never verified the seal. A single stray xattr (`com.apple.FinderInfo`, or `com.apple.fileprovider.fpfs#P` coming from iCloud Drive in `~/Documents`) makes `codesign --verify --strict` fail, and macOS then stops matching the app with its TCC entry: the Accessibility toggle exists in System Settings, never applies, and nothing is tracked. Signing now strips xattr after signing as well, verifies with `codesign --verify --strict`, and fails the build with remediation text when the seal is invalid
- **Tracking cannot be trusted from a synced folder** — the repo lives in `~/Documents`, which iCloud Drive syncs wholesale, so a freshly built bundle got `com.apple.FinderInfo` / `com.apple.fileprovider.fpfs#P` back within seconds and its seal stopped verifying. New `scripts/install-mac.cjs` (`npm run install:mac`, also run at the end of `npm run package:mac`) copies the built bundle to `/Applications`, strips xattr, verifies the seal and launches it — the correct action is now the only one. `TrackingHealth` additionally verifies its own signature at startup, so when the permission is missing because the seal is broken the UI says exactly that instead of a generic banner
- **Tracking engine stability** — three critical fixes addressing data gaps (4-5 hour holes in tracking data):
  - **try-catch in `poll()`** — any exception in `insertEvent()`, `closeEvent()`, `updateMeetingTracking()` or other DB calls during poll would silently kill the tracking tick. `setInterval` swallows errors from async callbacks, so the tracker appeared to be running but stopped recording. Wrapping the entire `poll()` body in try-catch ensures the next tick continues normally after an error
  - **try-catch in `onAfkStart/onAfkEnd/pause`** — same pattern for AFK and pause handlers. If `insertEvent()` (AFK event recording) or `closeCurrentEvent()` threw, the tracker state would become inconsistent (isAfk=false but event not written). Now catches and logs, state stays consistent
  - **try-catch in AFKDetector `checkIdle()`** — `powerMonitor.getSystemIdleTime()` could throw in edge cases (system sleep/wake race), killing the AFK detection interval silently
  - **Zombie event recovery on startup** — when the app crashed or was force-killed, the current event was left with `duration=0` and `ts_end≈ts_start`. On next startup, a fresh event was created, leaving the old one as a zero-duration zombie. New `recoverZombieEvents()` in `EventRepository` finds these events and closes them (estimates duration if crash was recent < 5 min, marks as 0 otherwise)
  - **File logging** — `safe-log.ts` now writes to `~/Library/Logs/CarpeDiem/main.log` in addition to `console`. In packaged mode, `console.log` goes to nowhere (no terminal), making crash diagnostics impossible. The file logger initializes lazily (waits for `app.isReady()`) and includes ISO timestamps + log level. Uncaught exceptions are also written to the file
- **N+1 queries in getDailyStats and getTagStats** — `getDailyStats(days)` ran 2 SQL queries per day (2N total: at `range=30` that was 60 queries per Stats page load). Replaced with 2 batch queries for the entire range + JS grouping by day. Registered `extractDomainFromUrl` as a SQLite JS function (like `extractTaskKey`) so `getTagStats` can now do tag aggregation in a single SQL query with LEFT JOINs instead of loading all events into JS and iterating row-by-row
- **IPC input validation** — `settings:set` accepted any `key: string` from renderer (untrusted context), allowing arbitrary writes to the `settings` table. Fix: added whitelist of allowed setting keys (`autostart`, `excludedApps`, `idleThreshold`). Also added `targetType`/`tag` validation for tags handlers, `matchType`/`field` whitelists and pattern length limit (500 chars) for category rules — ReDoS protection for regex patterns

### Changed
- **Database decomposed into repository pattern** — `database.ts` (1075 lines) replaced with a 145-line facade composing 5 focused repositories: `EventRepository`, `CategoryRepository`, `TagRepository`, `StatsRepository`, `SettingsRepository` (in `src/main/db/`). Shared helpers (row mappers, timezone utils, extraction functions) extracted to `src/main/db/helpers.ts`. Migration runner extracted to `src/main/db/migrations.ts`. The facade re-exports helpers and provides backward-compatible delegating methods so callers (`tracking-engine`, `ipc-handlers`, `index.ts`) need no changes. No behavior change — pure structural refactor
- **Shared types moved to `src/shared/types.ts`** — types were in `src/main/types.ts` but imported by both main and renderer. Renderer depending on `../../../main/types` was cross-boundary coupling. Moved to `src/shared/types.ts` (single source of truth). `src/main/types.ts` now re-exports for backward compat. tsconfig includes updated accordingly

### Fixed
- **Migration version tracking** — migrations were re-executed on every app launch because there was no `schema_migrations` table to track which had been applied. Schema migrations (001–004) were safe due to `IF NOT EXISTS`, but data migrations like 005 (`DELETE`/`UPDATE` on events) ran every startup — wasteful and risky. Fix: added `schema_migrations` table, atomic migration runner (each migration + its record in a single transaction), and one-time existing-DB detection (marks all prior migrations as applied on first run with the new code). `backfillTaskKeys()` moved from TypeScript into migration 006 (now contains actual `ALTER TABLE` + `UPDATE` SQL instead of a comment)
- **loginwindow tracked as real activity** — when the macOS screen is locked, `active-win` returns `loginwindow` (or `ScreenSaverEngine`) as the active window. The tracker was recording these as real app events with `is_afk=0`. Now `loginwindow` and `ScreenSaverEngine` are detected and treated as "screen locked" — the current event is closed, no new event is recorded, and the UI shows «Screen locked» until the user returns. The AFK detector's `lock-screen` event then records the AFK period normally
### Added
- **Google Meet background tracking** — when a Google Meet call is detected (URL `meet.google.com/{code}`), the tracker keeps recording Meet time even when the user switches to other apps. A parallel "Google Meet" background event runs alongside foreground events. Meeting ends after 10-minute timeout without seeing the Meet tab. AFK is suppressed during active meetings (no keyboard/mouse input is normal on calls)
- **Jira links in Tasks section** — task keys in Work tab «По задачам» are now clickable links opening `jira.int.agrd.dev/browse/{key}` in the default browser. «Остальное» has no link
- **«Остальное» in Tasks section** — Work tab «По задачам» now shows an «Остальное» (Other) bar for work time not tied to any Jira task key. Total for the tasks section now equals total work time instead of only task time
- **«Сегодня» filter** — range selector in Statistics and Work tabs now includes «Сегодня» (Today) as the default option, showing data for the current day only
- **Work tab** — new sidebar tab «Работа» showing statistics for apps/sites tagged as 'work' and a breakdown by Jira task keys (ADG-12144, AGDNS-4264, etc.). Task keys are automatically extracted from window titles and URLs (migration 006). New IPC channels: `stats:getWork`, `stats:getTasks`. Preload exposes `window.api.stats.getWork` and `window.api.stats.getTasks`
- **Code signing** — `scripts/after-pack.cjs` signs the `.app` with a self-signed certificate ("AliSwitcher Code Signing") from the login keychain. macOS TCC (Accessibility permission) tracks by certificate identity, which is stable across rebuilds, so permissions persist across reinstalls and reboots. Falls back to ad-hoc signing if the certificate is unavailable
- **App/domain tags** — manual tagging of apps and websites as work (работа), neutral (нейтральное), or distracting (отвлечение). Three-dots dropdown menu on each app row and browser domain in Timeline. Tag badges displayed inline. Tags persist in DB (`app_tags` table, migration 004). New IPC channels: `tags:getAll`, `tags:set`, `tags:delete`. Preload exposes `window.api.tags`
- **AFK time display in Timeline** — shows total away-from-keyboard time per day below the app list. New IPC channel `activities:getAfkTime`. Preload exposes `window.api.activities.getAfkTime`
- **Tag distribution chart in Statistics** — bar chart showing time breakdown by tag (work/neutral/distracting/untagged) for the selected range. New IPC channel `stats:getTagStats`. Preload exposes `window.api.stats.getTagStats`

### Changed
- **Pie charts replaced with horizontal bars** — all pie charts across the app (StatsView top apps, tag distribution, WorkView apps/tasks) replaced with horizontal bar charts for better readability
- **Single-instance lock hardened** — `app.exit(0)` instead of `app.quit()` for immediate second-instance termination. Existing window is focused/restored when a second launch is attempted

### Removed
- **Productivity score system** — removed the old category-based productivity score (ProductivitySection with score gauge, productivity trend line chart, productive/distracting/neutral breakdown). These duplicated the manual tag system (work/neutral/distracting/untagged) with less precision. Removed IPC channel `stats:getProductivity`, `getProductivityStats()` from database, `ProductivityStat` type. Daily chart now stacks by tag instead of by category

### Fixed
- **localhost domains now show with port** — `extractDomain` functions (renderer + main) now include the port for localhost and IP addresses (e.g., `localhost:3001`, `localhost:8501`, `127.0.0.1:59944`), so different localhost apps are no longer merged into a single `localhost` group in Timeline browser details
- **Tooltips on all tabs** — native `title` tooltips added to bars in Daily Log (timeline + event list), Work tab (apps + tasks), Statistics (top apps + tag distribution), and Timeline (app bars). Hover any bar to see app name, duration, and percentage
- **Traffic lights overlapping sidebar** — macOS window buttons (close, minimize, maximize) were encroaching on the sidebar. Switched `titleBarStyle` from `hiddenInset` to `hidden` with explicit `trafficLightPosition: { x: 10, y: 10 }`, and increased sidebar top padding from 48px to 56px

### Fixed
- **Accessibility permission spam** — `active-win` spawns a native binary using macOS Accessibility API every second in the poll loop. Without permission, macOS showed the system dialog on every call. Fix: check `systemPreferences.isTrustedAccessibilityClient()` before starting the poll loop; show the system prompt ONCE at startup; wait with check-only polling until the user grants permission; guard each `poll()` call
- **Race condition: real events created during AFK** — `poll()` checked `isAfk` at the top, but `await activeWin()` is async. During that await, AFK could start and close the current event. When `poll()` resumed, it created a new real event **during** AFK, causing overlapping time periods (e.g. 27h/day). Fix: re-check `isAfk` after `await activeWin()` returns. Migration `005` cleans up historical overlapping data (deletes phantom events, trims partial overlaps)
- Initial project setup: Electron + React + TypeScript + SQLite
- Project documentation: PRD, SDD, AGENTS.md, copilot-instructions
- Git repository initialized
- **Phase 1: Tracking engine core**
  - `DatabaseManager` — SQLite with WAL mode, auto-migrations, prepared statements
  - `TrackingEngine` — polls `active-win` every 1s, records activity events to DB
  - `AFKDetector` — detects idle (180s threshold), sleep, lock-screen via `powerMonitor`
  - IPC handlers — full contract: tracking, activities, categories, settings, CSV export
  - Preload bridge — typed `window.api` with `onActivityChanged` real-time callback
  - Renderer UI — Day Summary view with live activity indicator, app list with bar charts
  - DB migration `001_initial.sql` — events, categories, category_rules, settings tables
  - `formatDuration` utility for human-readable time display
- **Phase 2: Working prototype — Stats, Settings, Tray**
  - **Timezone fix** — `localDayBounds()` helper, all DB queries now use local day boundaries
  - **Stats implementations** — `getDailyStats()` (N-day trend with per-category breakdown), `getTopApps()` (period top apps)
  - **StatsView** — Recharts stacked bar chart (daily active time by category), pie chart (top apps), summary cards
  - **SettingsView** — autostart toggle (`app.setLoginItemSettings`), idle threshold slider, CSV export button
  - **Tray icon** — 22×22 template PNG clock face, `setTemplateImage(true)` for macOS dark/light adaptation
  - **Window behavior** — close button hides to tray (not quit), `isQuitting` flag for real exit
  - **Autostart** — `app.setLoginItemSettings({ openAtLogin })` toggled from Settings, applied at startup
- **Phase 3: Detailed tracking & app identity**
  - **App name** — `app.setName('CarpeDiem')` + `electron-builder.yml` productName/appId
  - **Self-tracking filter** — tracker skips its own window (`SELF_APP_NAMES` check), keeps last real activity as current
  - **URL extraction** — `active-win` `url` field now stored in events (browser tab URLs on macOS)
  - **Title parser** — `title-parser.ts`: per-app parsing (VS Code project, Figma file, browser domain extraction)
  - **Detailed DaySummary** — `getDaySummaryDetailed()`: per-app + per-window-title breakdown with `DetailedDaySummary` type
  - **Expandable timeline rows** — AppRow expands to show individual windows/tabs with per-title durations
  - **Current activity header** — shows `windowTitle` alongside app name (truncated)
  - **Drag region** — CSS drag region on header, `no-drag` on interactive elements
  - **Preload fix** — `.mjs` extension (ESM `type: module`), ErrorBoundary + `hasApi()` guard
  - `formatLocalDate()` and `formatShort()` helpers in renderer
  - `d3-scale`, `d3-shape`, `d3-array` added for Recharts compatibility with Vite
- **Phase 4: Daily Log view & UI polish**
  - **LogView** — new sidebar tab with chronological event log + visual timeline bar
  - **Visual timeline** — horizontal 00:00→24:00 bar, each event = colored block proportional to duration, hover for details
  - **Event list** — chronological list with start/end times, app name, window title, duration; AFK events dimmed
  - **Color per app** — deterministic hash → curated palette for visual distinction
  - **formatTime()** / **formatTimeSec()** helpers for HH:MM display
  - **Contrast fix** — `tt-muted` #565f89 → #9aa5ce (WCAG 2.4:1 → ~5:1), bar fill opacity /20 → /35
  - **Sidebar padding** — `pt-12` for macOS traffic lights, drag-region on sidebar
  - **Removed** — redundant "Currently tracking" card (header already shows current activity)
- **Phase 5: Auto-categorization engine**
  - **Categorization** — `categorizeEvent()` matches app name/window title/URL/bundle against rules (first match wins)
  - **Rule matcher** — `matchRule()` supports `equals`, `contains`, `startsWith`, `regex` (case-insensitive, safe regex try/catch)
  - **Auto-categorize on insert** — `insertEvent()` now calls `categorizeEvent()` if no explicit category
  - **Rule CRUD** — `getCategoryRules()`, `upsertRule()`, `deleteRule()`, `getRuleById()` DB methods
  - **IPC channels** — `RULES_GET_ALL`, `RULES_UPSERT`, `RULES_DELETE` with full preload bridge
  - **Default rules migration** — `002_default_rules.sql`: Development (Code, Xcode, Terminal, Cursor, Figma), Communication (Slack, Discord, Mail, Telegram, Zoom, Teams), Browsing (Chrome, Safari, Firefox, Arc, Edge + URL rules), Entertainment (Spotify, YouTube, Netflix, Twitch), System (Finder, System Settings, Docker)
- **Phase 6: Productivity score (US8)**
  - **`ProductivityStat` type** — `{ date, score (0-100), totalActive, productiveTime, distractingTime, neutralTime }`
  - **`getProductivityStats()`** — DB method: time-weighted average of category productivity (-2..+2 → 0-100), per-day breakdown by productive/distracting/neutral
  - **IPC** — `STATS_GET_PRODUCTIVITY` channel + handler + preload binding
  - **StatsView UI** — productivity score section: today's score gauge (color-coded), N-day average with productive/distracting breakdown, line chart trend with 50-point reference line
- **Phase 7: Activity heatmap (US11)**
  - **`HeatmapCell` type** — `{ dayOfWeek, hour, seconds }` (7×24 = 168 cells)
  - **`getHeatmap()`** — DB method: fetches events for period, aggregates by local day-of-week × hour using `Date.getDay()` / `getHours()`, returns full 7×24 grid
  - **IPC** — replaced TODO with real `getHeatmap()` call, return type `HeatmapCell[]`
  - **StatsView** — `HeatmapSection` component: 7×24 grid with intensity color (transparent → blue), hover tooltip (day hour → duration), legend
- **Phase 8: Privacy — private tab filtering & exclusion list (US13, US15)**
  - **Private tab detection** — `isPrivateTab()` checks window title for Chrome "Incognito", Safari/Firefox "Private Browsing", Arc "Little Arc"; when detected, tracker closes current event and doesn't record (like self-tracking)
  - **Current activity** — shows "Private browsing" indicator when in private mode (no URL stored)
  - **Exclusion list** — `excludedApps` setting (JSON array in settings table); TrackingEngine loads on start and skips excluded apps entirely
  - **Settings reload** — `tracker.loadExcludedApps()` called when setting is updated via IPC
  - **SettingsView** — exclusion list UI: add app name input, chip list with remove buttons
- **Phase 9: JSON export & Categories management UI (US14)**
  - **JSON export** — `EXPORT_JSON` IPC channel + handler: serializes events with metadata (exportedAt, dateRange, eventCount), saves to Downloads as `.json`
  - **Preload** — `export.json()` method exposed
  - **SettingsView Data section** — separate CSV and JSON export buttons
  - **Categories management section** — lists all categories with color dot, rule count, productivity badge (green +/red -/gray 0)
  - **Rules display** — shows all auto-categorization rules (field · matchType · "value" → category with color)
- **Phase 10: Menu bar quick summary (US5)**
  - **Dynamic tray menu** — `updateTrayMenu()` rebuilds context menu with: today's total active time, current activity (app + window title), top 3 apps with durations
  - **Tray tooltip** — shows "CarpeDiem — 5h 32m today" on hover
  - **Auto-refresh** — menu rebuilt on activity change (via `tracker.on('activity-changed')`) and every 30 seconds (duration grows without activity switch)
  - **Pause/Resume state** — disabled/enabled dynamically based on tracking state
- **Phase 11: Runtime stability fixes**
  - **Safe logger** — `safe-log.ts` module wraps `console.log/warn/error` in try/catch, preventing EIO crash when terminal stdout pipe is broken (VS Code killing terminal, terminal closing)
  - **Global uncaughtException handler** — catches EIO/ERR_STREAM_DESTROYED silently, logs other exceptions without crashing
  - **Dual-window guard** — `createWindow()` now checks `mainWindow?.isDestroyed()` before creating, preventing duplicate windows on `activate` event or double-invocation
  - **Window reference cleanup** — `mainWindow` set to `null` on `closed` event for proper lifecycle management
- **Phase 12: Production packaging fixes**
  - **Migrations bundling** — `extraResources` in `electron-builder.yml` copies SQL migration files to `Resources/migrations/` in packaged .app (was missing — app crashed on startup with "Migrations directory not found")
  - **Tray icon path** — `createTray()` now resolves icon path via `app.isPackaged` for both dev (`__dirname`) and production (`process.resourcesPath`) environments
  - **Single-instance lock** — `app.requestSingleInstanceLock()` prevents launching a second app instance; second launch focuses existing window instead
- **Phase 13: UI contrast & color consistency**
  - **Native dark mode** — added `color-scheme: dark` to globals.css so native controls (range slider, checkboxes, scrollbars) render in dark appearance instead of light
  - **Recharts axis labels** — fixed contrast ratio from 2.3:1 to 6.1:1 by changing stroke color from `#565f89` to `#9aa5ce` (tt-muted) on daily bar chart
  - **Recharts grid lines** — made CartesianGrid more visible: `#2a2e44` → `#334155`
  - **Recharts reference line** — productivity trend 50-point reference line: `#565f89` → `#737aa2` for better visibility
  - **"Today" badge** — normalized opacity across Timeline and Log views (was /20 in one, /30 in other → both /25), added font-medium for readability
- **Phase 14: AFK tracking improvements**
  - **Threshold 180→60s** — AFK detector now triggers after 1 minute of no keyboard/mouse activity (was 3 minutes)
  - **AFK category** — migration `003_afk_category.sql` adds "AFK" category; AFK events now have `categoryId` linked to it (were `null` before, invisible in stats)
  - **Dynamic threshold** — idle threshold loaded from DB settings at startup; `setIdleThreshold()` method on AFKDetector; IPC settings handler updates threshold live when slider changes
  - **`getCategoryByName()`** — new public DB method to look up category by name (used by TrackingEngine for AFK category)
- **Phase 15: Timeline — app icons, website grouping**
  - **App icons** — `app-icons.ts` module: resolves .app path via `mdfind` (Spotlight) by bundleId, falls back to `/Applications/`, uses `app.getFileIcon()` → 32×32 JPEG base64; cached in Map. `useAppIcon` hook fetches via IPC, `AppIcon` component shows icon or fallback (first letter in colored circle)
  - **`appBundleId` in summary** — `DetailedDaySummary` now includes `appBundleId`; SQL query updated; needed for icon resolution
  - **`APPS_GET_ICON` IPC** — new `apps:getIcon` channel + preload `apps.getIcon()` method
  - **Browser domain grouping** — for browser apps (Chrome, Safari, Firefox, Arc, Edge, etc.), Timeline groups by domain (figma.com, jira.com) instead of window titles; `BrowserDetail` component with drill-down to individual tabs
  - **Same tabs merged** — SQL already groups by `app_name, window_title, url`; domain grouping further merges tabs from same site

### Fixed
- **Icon visibility (JPEG→PNG)** — macOS app icons have transparent backgrounds; JPEG format doesn't support alpha channel, making icons invisible (black on dark theme `#16161e`). Changed `toJPEG()` → `toPNG()` in `app-icons.ts`
- **App icons all identical in packaged mode** — `app.getFileIcon()` returns the same generic icon for all apps in unsigned packaged Electron. Rewrote `app-icons.ts` to read `.icns` directly from app bundles: resolves app path via `mdfind`, parses `Info.plist` via `plutil -convert json`, converts `.icns` → PNG 32×32 via `sips` (preserves alpha channel). Uses full paths (`/usr/bin/*`) since packaged app may have empty PATH. Falls back to `getFileIcon()` for apps without `.icns` (system processes)
- **Domain text centering** — `<button>` elements have `text-align: center` by default (UA stylesheet); `BrowserDetail` domain spans with `flex-1` inherited this, causing domain names to appear visually centered. Added `text-left` to AppRow and BrowserDetail buttons
- **Text selection** — added `user-select: text` globally so any text in the app can be selected and copied (drag-region areas keep `user-select: none` for window dragging)
