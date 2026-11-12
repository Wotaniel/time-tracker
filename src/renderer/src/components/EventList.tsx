import type { ActivityEvent } from '../../../shared/types'
import { formatDuration, formatTimeSec } from '../lib/format'

/**
 * Сырые события дня. Раньше этот список стоял прямо под итогом и занимал
 * пол-экрана, конкурируя с лентой. Теперь он открывается по кнопке:
 * сырые данные — для проверки, а не для первого взгляда.
 */
export function EventList({ events }: { events: ActivityEvent[] }): JSX.Element {
  if (events.length === 0) {
    return <div className="p-6 text-center text-sm text-tt-muted">За этот день событий нет.</div>
  }

  return (
    <div className="divide-y divide-tt-border/50">
      {events.map((e, idx) => (
        <div
          key={`${e.tsStart}-${idx}`}
          className="flex items-center gap-3 px-3 py-1.5 text-xs hover:bg-tt-bg/60"
        >
          <span className="w-20 shrink-0 tabular-nums text-tt-muted">
            {formatTimeSec(e.tsStart)}–{formatTimeSec(e.tsEnd)}
          </span>
          <span className={`w-28 shrink-0 truncate ${e.isAfk ? 'text-tt-muted' : 'text-tt-text'}`}>
            {e.isAfk ? 'AFK' : e.appName}
          </span>
          <span className="flex-1 truncate text-tt-muted" title={e.url ?? undefined}>
            {e.windowTitle || '(empty)'}
          </span>
          <span className="w-14 shrink-0 text-right tabular-nums text-tt-muted">
            {formatDuration(e.duration)}
          </span>
        </div>
      ))}
    </div>
  )
}
