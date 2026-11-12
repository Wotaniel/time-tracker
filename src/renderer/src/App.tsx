import { useState, useEffect, Component, type ReactNode } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Clock,
  Settings as SettingsIcon,
  Activity
} from 'lucide-react'
import type { CurrentActivity, TrackingHealthStatus } from '../../shared/types'
import { TodayView } from './pages/TodayView'
import WeekView from './pages/WeekView'
import SettingsView from './pages/SettingsView'

// ─── Error Boundary ────────────────────────────────────────────

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: string } {
    return { error: error.message }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-screen flex-col items-center justify-center gap-4 bg-tt-bg p-8 text-center text-tt-text">
          <h1 className="text-xl font-semibold text-tt-red">Что-то пошло не так</h1>
          <p className="max-w-md text-sm text-tt-muted">{this.state.error}</p>
          <p className="text-xs text-tt-muted">
            window.api is{' '}
            {typeof window !== 'undefined' && 'api' in window ? 'available' : 'NOT available'}
          </p>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── API guard ─────────────────────────────────────────────────

function hasApi(): boolean {
  return typeof window !== 'undefined' && !!window.api
}

/** Три раздела с подписями: «Работа» перестала быть отдельным экраном */
type View = 'today' | 'week' | 'settings'

const NAV: { id: View; label: string; icon: typeof Clock }[] = [
  { id: 'today', label: 'Сегодня', icon: Clock },
  { id: 'week', label: 'Неделя', icon: BarChart3 },
  { id: 'settings', label: 'Настройки', icon: SettingsIcon }
]

export default function App(): JSX.Element {
  if (!hasApi()) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-tt-bg p-8 text-center text-tt-text">
        <Clock size={48} className="text-tt-accent" />
        <h1 className="text-xl font-semibold">CarpeDiem</h1>
        <p className="max-w-md text-sm text-tt-muted">
          Preload script не загружен. Если запущено вне Electron, это ожидаемо.
        </p>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}

function AppInner(): JSX.Element {
  const [view, setView] = useState<View>('today')
  const [currentActivity, setCurrentActivity] = useState<CurrentActivity | null>(null)
  const [health, setHealth] = useState<TrackingHealthStatus | null>(null)

  // Почему трекер не пишет: без этого состояния поломка выглядит как работающее
  // приложение с пустой лентой. Состояние приходит из main и обновляется само.
  useEffect(() => {
    window.api.health
      .getStatus()
      .then(setHealth)
      .catch(() => setHealth(null))

    return window.api.health.onChanged(setHealth)
  }, [])

  // Текущая активность в шапке
  useEffect(() => {
    window.api.tracking.getCurrent().then(setCurrentActivity)

    return window.api.tracking.onActivityChanged((activity) => {
      setCurrentActivity(activity as CurrentActivity)
    })
  }, [])

  return (
    <div className="flex h-screen bg-tt-bg text-tt-text">
      {/* Sidebar — подписи под иконками: иконка без подписи не читается */}
      <nav className="drag-region flex w-[78px] shrink-0 flex-col items-center gap-1 border-r border-tt-border bg-tt-surface pt-14 pb-6">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`no-drag flex w-16 flex-col items-center gap-1 rounded-lg py-2 transition-colors ${
              view === id
                ? 'bg-tt-accent/20 text-tt-accent'
                : 'text-tt-muted hover:bg-tt-bg/60 hover:text-tt-text'
            }`}
            onClick={() => setView(id)}
            title={label}
          >
            <Icon size={20} />
            <span className="text-[10px] leading-none">{label}</span>
          </button>
        ))}
      </nav>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="drag-region flex h-12 shrink-0 items-center gap-2 border-b border-tt-border px-6">
          <Activity
            size={12}
            className={
              currentActivity?.isPaused
                ? 'text-tt-yellow'
                : currentActivity?.isAfk
                  ? 'text-tt-muted'
                  : 'text-tt-green'
            }
          />
          <span className="max-w-md truncate text-xs text-tt-muted">
            {currentActivity?.isPaused
              ? '⏸ Пауза'
              : currentActivity?.isAfk
                ? '😴 AFK'
                : currentActivity?.windowTitle
                  ? `${currentActivity.appName} — ${currentActivity.windowTitle}`
                  : `${currentActivity?.appName ?? '—'}`}
          </span>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {health && !health.tracking && <BlockedBanner health={health} />}
          {view === 'today' && <TodayView />}
          {view === 'week' && <WeekView />}
          {view === 'settings' && <SettingsView />}
        </div>
      </main>
    </div>
  )
}

// ─── Blocked banner ────────────────────────────────────────────

/**
 * Почему трекер не пишет. Три причины выглядят одинаково — пустая лента, —
 * поэтому текст должен называть именно ту, что случилась.
 */
function BlockedBanner({ health }: { health: TrackingHealthStatus }): JSX.Element {
  if (health.blockedBy === 'window-access') {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-tt-red/40 bg-tt-red/10 p-4">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-tt-red" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Активное окно не читается — трекинг не пишет данные</p>
          <p className="mt-1 text-xs text-tt-muted">
            Разрешение есть, но система больше не отдаёт список окон: обычно это отозванный
            доступ «Запись экрана» или зависший системный помощник. Проверьте Системные
            настройки → Конфиденциальность и безопасность → Запись экрана, затем перезапустите
            CarpeDiem.
          </p>
        </div>
      </div>
    )
  }

  if (health.blockedBy === 'bundle-integrity') {
    return (
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-tt-red/40 bg-tt-red/10 p-4">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-tt-red" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Подпись приложения повреждена — трекинг не работает</p>
          <p className="mt-1 text-xs text-tt-muted">
            macOS не сопоставит приложение с записью о разрешении, поэтому «Универсальный доступ»
            из Системных настроек не применяется. Обычно причина в том, что приложение запущено
            из папки под iCloud Drive: синхронизация возвращает на бандл посторонние атрибуты и
            ломает подпись.
          </p>
          <p className="mt-1 text-xs text-tt-muted">
            Запускайте копию из /Applications: <code>npm run install:mac</code> собирает её и
            ставит на место.
          </p>
          {health.bundlePath && (
            <p className="mt-1 truncate text-xs text-tt-muted">
              Сейчас запущено из {health.bundlePath}
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-tt-yellow/40 bg-tt-yellow/10 p-4">
      <AlertTriangle size={18} className="mt-0.5 shrink-0 text-tt-yellow" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          Трекинг не работает: нет разрешения «Универсальный доступ»
        </p>
        <p className="mt-1 text-xs text-tt-muted">
          Без него macOS не отдаёт активное окно, поэтому в базу не пишется ни одного события.
          Включите CarpeDiem в Системных настройках → Конфиденциальность и безопасность →
          Универсальный доступ. Разрешение подхватится само, перезапускать приложение не нужно.
        </p>
      </div>
      <button
        className="no-drag shrink-0 rounded-md border border-tt-border px-3 py-1.5 text-xs hover:bg-tt-surface"
        onClick={() => window.api.health.openAccessibilitySettings()}
      >
        Открыть настройки
      </button>
    </div>
  )
}
