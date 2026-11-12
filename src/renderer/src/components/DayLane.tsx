import { useState } from 'react'
import type { ActivityEvent, Meeting, TagType } from '../../../shared/types'
import { formatDuration, formatLocalDate, formatTimeSec } from '../lib/format'
import { tagColor } from '../lib/tags'
import { METRIC } from '../lib/colors'

/**
 * Лента дня: три дорожки вместо одной полоски.
 *
 * Раньше самое ценное представление дня занимало 48 px и делило место со
 * списком событий. Здесь активность — основная полоса, созвоны и простои —
 * тонкие дорожки под ней, плюс метка «сейчас».
 *
 * Наведение показывает подробности: полоса из сотен тонких штрихов бесполезна
 * без ответа «а что именно было в этот момент».
 */

interface DayLaneProps {
  events: ActivityEvent[]
  meetings: Meeting[]
  date: string
  tagFor: (appName: string, url: string | null) => TagType | undefined
  categoryFor: (categoryId: number | null | undefined) => string | null
}

interface HoverInfo {
  leftPct: number
  title: string
  meta: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Короткая подпись встречи из ссылки: meet.google.com/meet/abc-defg-hij → abc-defg-hij */
function meetingCode(url: string | null): string | null {
  if (!url) return null
  const match = url.match(/meet\.google\.com\/(?:meet\/)?([a-z-]+)/i)
  return match ? match[1] : null
}

export function DayLane({ events, meetings, date, tagFor, categoryFor }: DayLaneProps): JSX.Element {
  const [hover, setHover] = useState<HoverInfo | null>(null)

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
      hoverInfo: {
        leftPct: clamp(toPct(start + (end - start) / 2)),
        title: `${e.appName} — ${formatDuration(e.duration)}`,
        meta: [
          `${formatTimeSec(e.tsStart)}–${formatTimeSec(e.tsEnd)}`,
          ...(e.windowTitle ? [e.windowTitle] : []),
          ...(e.url ? [e.url] : []),
          ...(tag
            ? [`тег: ${tag === 'work' ? 'работа' : tag === 'neutral' ? 'нейтрально' : 'отвлечение'}`]
            : []),
          ...(categoryFor(e.categoryId) ? [`категория: ${categoryFor(e.categoryId)}`] : [])
        ]
      }
    }
  })

  const meetingBars = meetings.map((m) => {
    const start = new Date(m.tsStart).getTime() - dayStart
    const end = (m.tsEnd ? new Date(m.tsEnd).getTime() : now) - dayStart
    const code = meetingCode(m.url)
    return {
      key: `meeting-${m.id}`,
      left: clamp(toPct(start)),
      width: Math.max(toPct(end - start), 0.3),
      hoverInfo: {
        leftPct: clamp(toPct(start + (end - start) / 2)),
        title: `Созвон — ${formatDuration(Math.round((end - start) / 1000))}`,
        meta: [
          `${formatTimeSec(m.tsStart)}–${m.tsEnd ? formatTimeSec(m.tsEnd) : 'сейчас'}`,
          ...(code ? [`код встречи: ${code}`] : []),
          'не входит в активность, наложен сверху'
        ]
      }
    }
  })

  const afkBars = afk.map((e) => {
    const start = new Date(e.tsStart).getTime() - dayStart
    const end = new Date(e.tsEnd).getTime() - dayStart
    return {
      key: `afk-${e.tsStart}`,
      left: clamp(toPct(start)),
      width: Math.max(toPct(end - start), 0.2),
      hoverInfo: {
        leftPct: clamp(toPct(start + (end - start) / 2)),
        title: `Бездействие — ${formatDuration(e.duration)}`,
        meta: [`${formatTimeSec(e.tsStart)}–${formatTimeSec(e.tsEnd)}`, 'не было ввода']
      }
    }
  })

  // Промежутки, где приложение вообще не работало
  const gaps: { key: string; left: number; width: number; hoverInfo: HoverInfo }[] = []
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
      hoverInfo: {
        leftPct: clamp(toPct((prevEnd + nextStart) / 2 - dayStart)),
        title: `Нет событий — ${formatDuration(gapSec)}`,
        meta: [
          `${formatTimeSec(ordered[i - 1].tsEnd)}–${formatTimeSec(ordered[i].tsStart)}`,
          'приложение было закрыто, на паузе или не отвечало'
        ]
      }
    })
  }

  const hourMarks = [0, 3, 6, 9, 12, 15, 18, 21, 24]

  const hoverProps = (info: HoverInfo): {
    onMouseEnter: () => void
    onMouseLeave: () => void
  } => ({
    onMouseEnter: () => setHover(info),
    onMouseLeave: () => setHover(null)
  })

  return (
    <div className="select-none">
      <div className="relative">
        {/* Активность — главная дорожка */}
        <div className="relative h-16 w-full overflow-hidden rounded bg-tt-bg">
          {activityBars.map((bar) => (
            <div
              key={bar.key}
              className="absolute inset-y-0 cursor-help opacity-85 hover:opacity-100"
              style={{
                left: `${bar.left}%`,
                width: `${bar.width}%`,
                backgroundColor: bar.color
              }}
              {...hoverProps(bar.hoverInfo)}
            />
          ))}
        </div>

        {/* Созвоны */}
        <div className="relative mt-1 h-2 w-full overflow-hidden rounded-sm bg-tt-bg">
          {meetingBars.map((bar) => (
            <div
              key={bar.key}
              className="absolute inset-y-0 cursor-help rounded-sm"
              style={{
                left: `${bar.left}%`,
                width: `${bar.width}%`,
                backgroundColor: METRIC.meeting
              }}
              {...hoverProps(bar.hoverInfo)}
            />
          ))}
        </div>

        {/* Бездействие и простои */}
        <div className="relative mt-1 h-2 w-full overflow-hidden rounded-sm bg-tt-bg">
          {gaps.map((gap) => (
            <div
              key={gap.key}
              className="absolute inset-y-0 cursor-help opacity-40"
              style={{
                left: `${gap.left}%`,
                width: `${gap.width}%`,
                backgroundColor: METRIC.uncovered
              }}
              {...hoverProps(gap.hoverInfo)}
            />
          ))}
          {afkBars.map((bar) => (
            <div
              key={bar.key}
              className="absolute inset-y-0 cursor-help opacity-40"
              style={{
                left: `${bar.left}%`,
                width: `${bar.width}%`,
                backgroundColor: METRIC.afk
              }}
              {...hoverProps(bar.hoverInfo)}
            />
          ))}
        </div>

        {/* Подробности под курсором */}
        {hover && (
          <div
            className="pointer-events-none absolute z-50 w-72 rounded-lg border border-tt-border bg-tt-bg p-3 shadow-2xl"
            style={{
              left: `${Math.min(Math.max(hover.leftPct, 12), 82)}%`,
              top: 'calc(100% + 8px)',
              transform: 'translateX(-50%)'
            }}
          >
            <div className="text-xs font-medium text-tt-text">{hover.title}</div>
            {hover.meta.map((line, idx) => (
              <div key={idx} className="mt-0.5 truncate text-[11px] text-tt-muted" title={line}>
                {line}
              </div>
            ))}
          </div>
        )}

        {/* Часы внутри того же контейнера: линия «сейчас» должна заезжать и на них */}
        <div className="mt-1 flex justify-between text-[10px] text-tt-muted">
          {hourMarks.map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>

        {/* Метка «сейчас» поверх дорожек и шкалы: не обрезается контейнером */}
        {isToday && (
          <div
            className="pointer-events-none absolute -top-2 bottom-0 z-30 w-0.5 -translate-x-1/2"
            style={{
              left: `${clamp(toPct(now - dayStart))}%`,
              backgroundColor: METRIC.neutral
            }}
          >
            <div
              className="absolute -top-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full"
              style={{
                backgroundColor: METRIC.neutral,
                boxShadow: `0 0 0 2px ${METRIC.neutral}33`
              }}
            />
          </div>
        )}
      </div>

      {/* Легенда */}
      <div className="mt-2 flex flex-wrap items-center gap-4 text-[10px] text-tt-muted">
        {(
          [
            ['работа', METRIC.work],
            ['нейтрально', METRIC.neutral],
            ['отвлечение', METRIC.distracting],
            ['созвоны', METRIC.meeting],
            ['AFK', METRIC.afk],
            ['не записано', METRIC.uncovered]
          ] as const
        ).map(([label, color]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} /> {label}
          </span>
        ))}
      </div>
    </div>
  )
}
