# Time Tracker

Автоматический трекер активности для macOS. Молча записывает какие приложения и вкладки использовались, сколько времени на каждое. Локально, приватно, без облака.

## Stack

- **Electron** + **React** + **TypeScript**
- **SQLite** (better-sqlite3) — локальное хранение
- **Vite** + **TailwindCSS** + **Recharts**
- `active-win` — получение активного окна macOS
- `powerMonitor` — AFK / idle detection

## Возможности

- 🔍 Автоматический трекинг приложений и заголовков окон
- 📊 Timeline дня с цветными блоками по приложениям
- 😴 AFK / idle detection (перерывы помечаются автоматически)
- 📈 Статистика и графики динамики (неделя/месяц)
- 🏷️ Категории и авто-правила категоризации
- 🔒 100% локально, данные не покидают устройство

## Запуск

```bash
npm install
npm run dev
```

## Документация

- [PRD.md](PRD.md) — продуктовые требования
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — как всё устроено по коду
- [docs/UI-PLAN.md](docs/UI-PLAN.md) и [docs/NEXT-PLAN.md](docs/NEXT-PLAN.md) — планы работ
- [AGENTS.md](AGENTS.md) — инструкции для AI-агентов
- [CHANGELOG.md](CHANGELOG.md) — история изменений

## License

MIT
