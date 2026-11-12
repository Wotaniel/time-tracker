import { useEffect, useRef, useState } from 'react'
import type { ActivityEvent, Meeting, PlannedEvent, TagType } from '../../../shared/types'
import { formatDuration, formatLocalDate, formatTimeSec } from '../lib/format'
import { tagColor } from '../lib/tags'
import { Moon, Sun } from 'lucide-react'
import { METRIC } from '../lib/colors'
import type { SunTimes } from '../../../shared/sun'
import type { City } from '../../../shared/cities'

/**
 * Лента дня: три дорожки, масштаб и подробности.
 *
 * 24 часа на всю ширину — это треть экрана на рабочий отрезок и штрихи по 1–2 px.
 * Поэтому окно можно сузить до 12/6/3/1 часа и подвинуть: тогда видно отдельные
 * окна и разрывы без тултипа.
 */

interface DayLaneProps {
  events: ActivityEvent[]
  meetings: Meeting[]
  date: string
  tagFor: (appName: string, url: string | null) => TagType | undefined
  categoryFor: (categoryId: number | null | undefined) => string | null
  /** Основной город — подпись и солнце на нижней шкале */
  primaryCity?: City | null
  /** Рассвет и закат основного города — на нижней шкале */
  sunPrimary?: SunTimes | null
  /** Запланированные встречи из календаря */
  planned?: PlannedEvent[]
  /** Второй город: его шкала сверху и его солнце */
  secondaryCity?: City | null
  sunSecondary?: SunTimes | null
}

interface HoverInfo {
  leftPct: number
  title: string
  meta: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
/** Пределы масштаба: от часа до суток */
const MIN_VIEW_MS = HOUR_MS
const MAX_VIEW_MS = DAY_MS
/** Шаг колеса: 20% за щелчок */
const ZOOM_STEP = 1.2

/** Заголовок созвона: имя встречи, для хаддла — с кем */
function meetingLabel(meeting: Meeting): string {
  if (meeting.source === 'Slack huddle' && meeting.title) return `Созвон в Slack: ${meeting.title}`
  if (meeting.title) return meeting.title
  return meeting.source ?? 'Созвон'
}

/** Короткая подпись встречи: meet.google.com/meet/abc-defg-hij → abc-defg-hij */
function meetingCode(url: string | null): string | null {
  if (!url) return null
  const match = url.match(/meet\.google\.com\/(?:meet\/)?([a-z-]+)/i)
  return match ? match[1] : null
}

export function DayLane({
  events,
  meetings,
  date,
  tagFor,
  categoryFor,
  primaryCity = null,
  planned = [],
  sunPrimary = null,
  secondaryCity = null,
  sunSecondary = null
}: DayLaneProps): JSX.Element {
  const [hover, setHover] = useState<HoverInfo | null>(null)
  // Масштаб — доля суток: колесо мыши сужает окно вокруг курсора
  const [viewMs, setViewMs] = useState(DAY_MS)
  const [windowStart, setWindowStart] = useState<number | null>(null)
  const laneRef = useRef<HTMLDivElement>(null)

  const dayStart = new Date(`${date}T00:00:00`).getTime()
  const now = Date.now()
  const isToday = date === formatLocalDate(new Date())

  const clampStart = (value: number, span: number): number =>
    Math.min(Math.max(value, dayStart), dayStart + DAY_MS - span)

  const centerOnNow = (span = viewMs): number => (isToday ? now - span / 2 : dayStart + 9 * HOUR_MS)

  const rawStart = windowStart ?? (viewMs >= DAY_MS ? dayStart : centerOnNow())
  const start = clampStart(rawStart, viewMs)
  const end = start + viewMs

  const place = (fromMs: number, toMs: number): { left: number; width: number } | null => {
    const from = Math.max(fromMs, start)
    const to = Math.min(toMs, end)
    if (to <= from) return null
    const left = Math.min(Math.max(((from - start) / viewMs) * 100, 0), 100)
    return { left, width: Math.max(((to - from) / viewMs) * 100, 0.15) }
  }

  const active = events.filter((e) => !e.isAfk)
  const afk = events.filter((e) => e.isAfk)

  const activityBars = active.flatMap((e) => {
    const geometry = place(new Date(e.tsStart).getTime(), new Date(e.tsEnd).getTime())
    if (!geometry) return []
    const tag = tagFor(e.appName, e.url ?? null)
    const category = categoryFor(e.categoryId)
    return [
      {
        key: `${e.tsStart}-${e.appName}`,
        ...geometry,
        color: tagColor(tag),
        hoverInfo: {
          leftPct: geometry.left + geometry.width / 2,
          title: `${e.appName} — ${formatDuration(e.duration)}`,
          meta: [
            `${formatTimeSec(e.tsStart)}–${formatTimeSec(e.tsEnd)}`,
            ...(e.windowTitle ? [e.windowTitle] : []),
            ...(e.url ? [e.url] : []),
            ...(tag
              ? [
                  `тег: ${
                    tag === 'work' ? 'работа' : tag === 'neutral' ? 'нейтрально' : 'отвлечение'
                  }`
                ]
              : []),
            ...(category ? [`категория: ${category}`] : [])
          ]
        }
      }
    ]
  })

  // План из календаря: отдельная дорожка, чтобы не путать с фактическими созвонами
  const plannedBars = planned.flatMap((event, index) => {
    const from = new Date(event.start).getTime()
    const to = new Date(event.end).getTime()
    const geometry = place(from, to)
    if (!geometry) return []
    return [
      {
        key: `planned-${index}`,
        ...geometry,
        hoverInfo: {
          leftPct: geometry.left + geometry.width / 2,
          title: `Запланировано: ${event.title}`,
          meta: [
            `${formatTimeSec(event.start)}–${formatTimeSec(event.end)}`,
            'из календаря, не фактическая активность'
          ]
        }
      }
    ]
  })

  const meetingBars = meetings.flatMap((m) => {
    const from = new Date(m.tsStart).getTime()
    const to = m.tsEnd ? new Date(m.tsEnd).getTime() : now
    const geometry = place(from, to)
    if (!geometry) return []
    const code = meetingCode(m.url)
    return [
      {
        key: `meeting-${m.id}`,
        ...geometry,
        hoverInfo: {
          leftPct: geometry.left + geometry.width / 2,
          title: meetingLabel(m),
          meta: [
            `${formatTimeSec(m.tsStart)}–${m.tsEnd ? formatTimeSec(m.tsEnd) : 'сейчас'} · ${formatDuration(
              Math.round((to - from) / 1000)
            )}`,
            ...(m.title ? [m.title] : []),
            ...(m.source ? [`источник: ${m.source}`] : []),
            ...(code ? [`код встречи: ${code}`] : []),
            'не входит в активность, наложен сверху'
          ]
        }
      }
    ]
  })

  const afkBars = afk.flatMap((e) => {
    const from = new Date(e.tsStart).getTime()
    const to = new Date(e.tsEnd).getTime()
    const geometry = place(from, to)
    if (!geometry) return []
    return [
      {
        key: `afk-${e.tsStart}`,
        ...geometry,
        hoverInfo: {
          leftPct: geometry.left + geometry.width / 2,
          title: `Бездействие — ${formatDuration(e.duration)}`,
          meta: [`${formatTimeSec(e.tsStart)}–${formatTimeSec(e.tsEnd)}`, 'не было ввода']
        }
      }
    ]
  })

  // Промежутки, где приложение вообще не работало
  const gaps: { key: string; left: number; width: number; hoverInfo: HoverInfo }[] = []
  const ordered = [...events].sort((a, b) => a.tsStart.localeCompare(b.tsStart))
  for (let i = 1; i < ordered.length; i++) {
    const prevEnd = new Date(ordered[i - 1].tsEnd).getTime()
    const nextStart = new Date(ordered[i].tsStart).getTime()
    const gapSec = Math.round((nextStart - prevEnd) / 1000)
    if (gapSec < 60) continue
    const geometry = place(prevEnd, nextStart)
    if (!geometry) continue
    gaps.push({
      key: `gap-${i}`,
      ...geometry,
      hoverInfo: {
        leftPct: geometry.left + geometry.width / 2,
        title: `Нет событий — ${formatDuration(gapSec)}`,
        meta: [
          `${formatTimeSec(ordered[i - 1].tsEnd)}–${formatTimeSec(ordered[i].tsStart)}`,
          'приложение было закрыто, на паузе или не отвечало'
        ]
      }
    })
  }

  // Часы второго пояса, поставленные на нашу шкалу: сдвиг между поясами
  const systemOffsetMinutes = -new Date().getTimezoneOffset()
  const secondaryHourMarks = secondaryCity
    ? Array.from({ length: 24 }, (_, hour) => hour)
        .map((hour) => {
          const delta = secondaryCity.utcOffsetMinutes - systemOffsetMinutes
          const systemMinutes = (((hour * 60 - delta) % 1440) + 1440) % 1440
          const at = dayStart + systemMinutes * 60_000
          return { hour, left: ((at - start) / viewMs) * 100 }
        })
        .filter((mark) => mark.left >= -2 && mark.left <= 102)
    : []

  // Подпись на каждый час: 24 подписи помещаются на ширине ленты (проверено),
  // а при сильном приближении в окне остаётся один-два часа
  const hourStep = 1
  const hoursInView = Array.from({ length: 24 }, (_, h) => h).filter((h) => {
    const at = dayStart + h * HOUR_MS
    return at >= start - HOUR_MS / 2 && at <= end + HOUR_MS / 2 && h % hourStep === 0
  })

  const pan = (direction: -1 | 1): void => {
    setWindowStart(clampStart(start + direction * (viewMs / 2), viewMs))
  }

  /**
   * Колесо над лентой: вверх — крупнее, вниз — мельче, точка под курсором
   * остаётся на месте. Слушаем нативно, потому что React вешает wheel
   * пассивным и preventDefault не сработает — страница начала бы скроллиться.
   */
  useEffect(() => {
    const el = laneRef.current
    if (!el) return

    const onWheel = (event: WheelEvent): void => {
      // Зажат shift или это трекпадная горизонталь — двигаем окно
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault()
        const delta = (event.deltaX || event.deltaY) * (viewMs / 800)
        setWindowStart(clampStart(start + delta, viewMs))
        return
      }

      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
      const anchorMs = start + ratio * viewMs
      const nextMs = Math.min(
        Math.max(viewMs * (event.deltaY > 0 ? ZOOM_STEP : 1 / ZOOM_STEP), MIN_VIEW_MS),
        MAX_VIEW_MS
      )
      setViewMs(nextMs)
      setWindowStart(clampStart(anchorMs - ratio * nextMs, nextMs))
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [viewMs, start])

  /**
   * Солнце — рассвет, луна — закат. Ставим прямо на шкалу, чтобы было видно,
   * к какому поясу относится: раньше это были вертикальные линии, и по ним
   * нельзя было понять, чей это рассвет.
   */
  const sunIcons = (times: SunTimes | null, cityName: string | null): JSX.Element[] => {
    if (!times) return []
    return (
      [
        ['рассвет', times.sunrise, Sun],
        ['закат', times.sunset, Moon]
      ] as const
    ).flatMap(([label, at, Icon]) => {
      if (at === null || at < start || at > end) return []
      const left = Math.min(Math.max(((at - start) / viewMs) * 100, 1), 99)
      return [
        <span
          key={`${label}-${cityName ?? 'city'}`}
          className="absolute -translate-x-1/2 text-tt-muted"
          style={{ left: `${left}%` }}
          title={`${label}${cityName ? ` (${cityName})` : ''} — ${formatTimeSec(
            new Date(at).toISOString()
          )}`}
        >
          <Icon size={11} />
        </span>
      ]
    })
  }

  const hoverProps = (info: HoverInfo): { onMouseEnter: () => void; onMouseLeave: () => void } => ({
    onMouseEnter: () => setHover(info),
    onMouseLeave: () => setHover(null)
  })

  return (
    <div className="select-none">
      {/* Масштаб — колесом; кнопками только панорама */}
      <div className="mb-2 flex items-center justify-between text-[11px] text-tt-muted">
        <span>
          масштаб <span className="text-tt-text">{(viewMs / HOUR_MS).toFixed(0)}ч</span>
          <span className="ml-2 opacity-70">колесо — приблизить, shift+колесо или › ‹ — сдвинуть</span>
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => pan(-1)}
            disabled={viewMs >= DAY_MS || start <= dayStart}
            className="no-drag rounded px-1.5 py-0.5 hover:text-tt-text disabled:opacity-30"
            title="Раньше"
          >
            ‹
          </button>
          <button
            onClick={() => {
              setViewMs(DAY_MS)
              setWindowStart(dayStart)
            }}
            disabled={viewMs >= DAY_MS}
            className="no-drag rounded px-1.5 py-0.5 hover:text-tt-text disabled:opacity-30"
            title="Показать весь день"
          >
            весь день
          </button>
          <button
            onClick={() => {
              setViewMs(3 * HOUR_MS)
              setWindowStart(clampStart(centerOnNow(3 * HOUR_MS), 3 * HOUR_MS))
            }}
            className="no-drag rounded px-1.5 py-0.5 hover:text-tt-text"
            title="Около текущего времени"
          >
            сейчас
          </button>
          <button
            onClick={() => pan(1)}
            disabled={viewMs >= DAY_MS || start >= dayStart + DAY_MS - viewMs}
            className="no-drag rounded px-1.5 py-0.5 hover:text-tt-text disabled:opacity-30"
            title="Позже"
          >
            ›
          </button>
        </div>
      </div>

      <div className="relative" ref={laneRef}>
        {/* Верхняя шкала — второй часовой пояс и его солнце */}
        {secondaryCity && (
          <div className="mb-1">
            {/* Название города отдельной строкой: в строке чисел оно
                наезжало на крайнюю подпись */}
            <div className="text-right text-[9px] uppercase tracking-wide text-tt-muted opacity-80">
              {secondaryCity.name}
            </div>
            <div className="relative h-3">
              {sunIcons(sunSecondary, secondaryCity.name)}
            </div>
            <div className="relative h-1.5">
              {secondaryHourMarks.map((mark) => (
                <span
                  key={`top-${mark.hour}`}
                  className="absolute top-0 h-full w-px"
                  style={{
                    left: `${mark.left}%`,
                    backgroundColor: mark.hour % 6 === 0 ? METRIC.afk : '#414868'
                  }}
                />
              ))}
            </div>
            <div className="relative mt-0.5 h-3 text-[9px] leading-none text-tt-muted">
              {secondaryHourMarks.map((mark) => (
                <span
                  key={`top-label-${mark.hour}`}
                  className={mark.hour % 6 === 0 ? 'absolute font-semibold text-tt-text' : 'absolute'}
                  style={{ left: `${mark.left}%`, transform: 'translateX(-50%)' }}
                >
                  {mark.hour}
                </span>
              ))}
            </div>
          </div>
        )}

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

        {/* План из календаря */}
        {plannedBars.length > 0 && (
          <div className="relative mt-1 h-2 w-full overflow-hidden rounded-sm bg-tt-bg">
            {plannedBars.map((bar) => (
              <div
                key={bar.key}
                className="absolute inset-y-0 cursor-help rounded-sm border border-tt-border"
                style={{
                  left: `${bar.left}%`,
                  width: `${bar.width}%`,
                  backgroundColor: '#414868'
                }}
                {...hoverProps(bar.hoverInfo)}
              />
            ))}
          </div>
        )}

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

        {/* Солнце и луна основного города — на его шкале */}
        <div className="relative mt-1 h-3">{sunIcons(sunPrimary, primaryCity?.name ?? null)}</div>

        {/* Часы внутри того же контейнера: линия «сейчас» должна заезжать и на них */}
        <div className="relative h-1.5">
          {hoursInView.map((h) => {
            const at = dayStart + h * HOUR_MS
            return (
              <span
                key={h}
                className="absolute top-0 h-full w-px"
                style={{
                  left: `${((at - start) / viewMs) * 100}%`,
                  backgroundColor: h % 6 === 0 ? METRIC.afk : '#414868'
                }}
              />
            )
          })}
        </div>

        <div className="relative mt-0.5 h-3 text-[9px] leading-none">
          {hoursInView.map((h) => {
            const at = dayStart + h * HOUR_MS
            return (
              <span
                key={h}
                className={`absolute ${
                  h % 6 === 0 ? 'font-semibold text-tt-text' : 'text-tt-muted'
                }`}
                style={{
                  left: `${((at - start) / viewMs) * 100}%`,
                  transform: h === 0 ? 'none' : 'translateX(-50%)'
                }}
              >
                {h}
              </span>
            )
          })}
        </div>

        {/* Метка «сейчас» поверх дорожек и шкалы */}
        {isToday && now >= start && now <= end && (
          <div
            className="pointer-events-none absolute -top-2 bottom-0 z-30 w-0.5 -translate-x-1/2"
            style={{
              left: `${((now - start) / viewMs) * 100}%`,
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
            ['не записано', METRIC.uncovered],
            ['план', '#414868']
          ] as const
        ).map(([label, color]) => (
          <span key={label} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: color }} /> {label}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <Sun size={10} /> рассвет
        </span>
        <span className="flex items-center gap-1">
          <Moon size={10} /> закат
        </span>
      </div>
    </div>
  )
}
