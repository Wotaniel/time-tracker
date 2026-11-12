import type { ActivityEvent, Meeting, TagType } from '../../../shared/types'
import { formatDuration, formatLocalDate, formatTime } from '../lib/format'
import { tagColor } from '../lib/tags'

/**
 * Лента дня: три дорожки вместо одной полоски.
 *
 * Раньше самое ценное представление дня занимало 48 px и делило место со
 * списком событий. Здесь активность — основная полоса, созвоны и простои —
 * тонкие дорожки под ней, плюс метка «сейчас».
 */

interface DayLaneProps {
  events: ActivityEvent[]
  meetings: Meeting[]
  date: string
  tagFor: (appName: string, url: string | null) => TagType | undefined
}

const DAY_MS = 24 * 60 * 60 * 1000

export function DayLane({ events, meetings, date, tagFor }: DayLaneProps): JSX.Element {
  const dayStart = new Date(`${date}T00:00:00`).getTime()
  const now = Date.now()
  const isToday = date === formatLocalDate(new Date())

  const toPct = (ms: number): number => (ms / DAY_MS) * 100
  const clamp = (value: number): number => Math.min(Math.max(value, 0), 100)

  const active = events.filter((e) => !e.isAfk)
  const afk = events.filter((e) => e.isAfk)

  const activityBars = active.map((e) => {
    const start = new Date(e.tsStart).getTime() - dayStart
    const end = new Date(e.tsEnd).getTime() - dayStart
    const tag = tagFor(e.appName, e.url ?? null)
    return {
      key: `${e.tsStart}-${e.appName}`,
      left: clamp(toPct(start)),
      width: Math.max(toPct(end - start), 0.15),
      color: tagColor(tag),
      title: `${e.appName} — ${formatDuration(e.duration)} (${formatTime(e.tsStart)}–${formatTime(e.tsEnd)})${
        e.windowTitle ? `\n${e.windowTitle}` : ''
      }`
    }
  })

  const meetingBars = meetings.map((m) => {
    const start = new Date(m.tsStart).getTime() - dayStart
    const end = (m.tsEnd ? new Date(m.tsEnd).getTime() : now) - dayStart
    return {
      key: `meeting-${m.id}`,
      left: clamp(toPct(start)),
      width: Math.max(toPct(end - start), 0.3),
      title: `Созвон — ${formatDuration(Math.round((end - start) / 1000))} (${formatTime(
        m.tsStart
      )}–${m.tsEnd ? formatTime(m.tsEnd) : 'сейчас'})`
    }
  })

  const afkBars = afk.map((e) => {
    const start = new Date(e.tsStart).getTime() - dayStart
    const end = new Date(e.tsEnd).getTime() - dayStart
    return {
      key: `afk-${e.tsStart}`,
      left: clamp(toPct(start)),
      width: Math.max(toPct(end - start), 0.2),
      title: `Бездействие — ${formatDuration(e.duration)} (${formatTime(e.tsStart)}–${formatTime(e.tsEnd)})`
    }
  })

  // Промежутки, где приложение вообще не работало: без них день выглядит полным
  const gaps: { key: string; left: number; width: number; title: string }[] = []
  const ordered = [...events].sort((a, b) => a.tsStart.localeCompare(b.tsStart))
  for (let i = 1; i < ordered.length; i++) {
    const prevEnd = new Date(ordered[i - 1].tsEnd).getTime()
    const nextStart = new Date(ordered[i].tsStart).getTime()
    const gapSec = Math.round((nextStart - prevEnd) / 1000)
    if (gapSec < 60) continue
    gaps.push({
      key: `gap-${i}`,
      left: clamp(toPct(prevEnd - dayStart)),
      width: Math.max(toPct(nextStart - prevEnd), 0.2),
      title: `Не записано — ${formatDuration(gapSec)} (${formatTime(ordered[i - 1].tsEnd)}–${formatTime(
        ordered[i].tsStart
      )})`
    })
  }

  const hourMarks = [0, 3, 6, 9, 12, 15, 18, 21, 24]

  return (
    <div className="select-none">
      <div className="relative">
        {/* Активность — главная дорожка */}
        <div className="relative h-16 w-full overflow-hidden rounded bg-tt-bg">
          {activityBars.map((bar) => (
            <div
              key={bar.key}
              className="absolute inset-y-0 cursor-help opacity-85 hover:opacity-100"
              style={{ left: `${bar.left}%`, width: `${bar.width}%`, backgroundColor: bar.color }}
              title={bar.title}
            />
          ))}

          {/* Метка «сейчас» */}
          {isToday && (
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-tt-text/70"
              style={{ left: `${clamp(toPct(now - dayStart))}%` }}
            />
          )}
        </div>

        {/* Созвоны */}
        <div className="relative mt-1 h-2 w-full overflow-hidden rounded-sm bg-tt-bg">
          {meetingBars.map((bar) => (
            <div
              key={bar.key}
              className="absolute inset-y-0 cursor-help rounded-sm bg-tt-purple"
              style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
              title={bar.title}
            />
          ))}
        </div>

        {/* Бездействие и простои */}
        <div className="relative mt-1 h-2 w-full overflow-hidden rounded-sm bg-tt-bg">
          {gaps.map((gap) => (
            <div
              key={gap.key}
              className="absolute inset-y-0 cursor-help bg-tt-red/40"
              style={{ left: `${gap.left}%`, width: `${gap.width}%` }}
              title={gap.title}
            />
          ))}
          {afkBars.map((bar) => (
            <div
              key={bar.key}
              className="absolute inset-y-0 cursor-help bg-tt-muted/40"
              style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
              title={bar.title}
            />
          ))}
        </div>
      </div>

      {/* Часы */}
      <div className="mt-1 flex justify-between text-[10px] text-tt-muted">
        {hourMarks.map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>

      {/* Легенда */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-tt-muted">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-tt-green" /> работа
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-tt-accent" /> нейтрально
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-tt-red" /> отвлечение
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-tt-purple" /> созвоны
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-tt-muted/40" /> AFK
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-tt-red/40" /> не записано
        </span>
      </div>
    </div>
  )
}
