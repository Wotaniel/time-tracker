import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type {
  DailyStat,
  DaySummary,
  HeatmapCell,
  Meeting,
  TagStat,
  WorkDayStat
} from '../../../shared/types'
import { formatDuration, formatLocalDate, formatShort } from '../lib/format'
import { TAG_CONFIG } from '../lib/tags'
import { METRIC } from '../lib/colors'
import { reachedTier, WEEKLY_GOAL_HOURS } from '../../../shared/goal'
import { mergeMeetings, meetingSeconds } from '../../../shared/meetings'

/**
 * «Неделя» — экран анализа, а не второй «Сегодня».
 *
 * Другой состав, потому что другой вопрос: не «что было», а «как изменилось».
 * Четыре KPI с дельтой к прошлой неделе, распределение по дням и топ приложений.
 * Heatmap — отдельным переключателем, а не пятым блоком на первом плане.
 *
 * Неделя календарная, Пн–Вс: по умолчанию открывается текущая, стрелками
 * можно листать предыдущие. Вперёд за текущую неделю не уходим.
 */

type Tone = 'good' | 'bad' | 'neutral'

const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

/** Сдвиг даты на N дней; дата — локальная «YYYY-MM-DD» */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return formatLocalDate(d)
}

/** Понедельник недели, в которую попадает дата (getDay: 0 — воскресенье) */
function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return formatLocalDate(d)
}

/** «Пн 17» — подпись дня на графике */
function weekdayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  return `${WEEKDAY_SHORT[(d.getDay() + 6) % 7]} ${Number(date.slice(8))}`
}

function sumMeetings(meetings: Meeting[]): number {
  // Склеиваем так же, как «Сегодня»: иначе KPI недели и день показывают разное
  return mergeMeetings(meetings).reduce((sum, m) => sum + meetingSeconds(m), 0)
}

function tagSeconds(stats: TagStat[], tag: TagStat['tag']): number {
  return stats.find((s) => s.tag === tag)?.seconds ?? 0
}

export default function WeekView(): JSX.Element {
  const [weekOffset, setWeekOffset] = useState(0)

  const today = formatLocalDate(new Date())
  // 0 — текущая неделя, -1 — прошлая и т.д.
  const weekStart = addDays(startOfWeek(today), weekOffset * 7)
  const weekEnd = addDays(weekStart, 6)
  const prevFrom = addDays(weekStart, -7)
  const prevTo = addDays(weekStart, -1)
  // Серия считается по прошедшим дням: будущие дни текущей недели её бы рвали
  const streakTo = weekEnd > today ? today : weekEnd

  const [daily, setDaily] = useState<DailyStat[]>([])
  const [tagCurrent, setTagCurrent] = useState<TagStat[]>([])
  const [tagPrev, setTagPrev] = useState<TagStat[]>([])
  const [topApps, setTopApps] = useState<DaySummary[]>([])
  const [heatmap, setHeatmap] = useState<HeatmapCell[]>([])
  const [meetCurrent, setMeetCurrent] = useState<Meeting[]>([])
  const [meetPrev, setMeetPrev] = useState<Meeting[]>([])
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [workDays, setWorkDays] = useState<WorkDayStat[]>([])
  const [goalSeconds, setGoalSeconds] = useState(0)
  const [weekGoalSeconds, setWeekGoalSeconds] = useState(WEEKLY_GOAL_HOURS * 3600)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    Promise.all([
      // Обе недели одним запросом: они идут подряд
      window.api.stats.getDailyRange(prevFrom, weekEnd),
      window.api.stats.getTagStats(weekStart, weekEnd),
      window.api.stats.getTagStats(prevFrom, prevTo),
      window.api.stats.getTopApps(weekStart, weekEnd, 10),
      window.api.stats.getHeatmap(weekStart, weekEnd),
      window.api.meetings.getRange(weekStart, weekEnd),
      window.api.meetings.getRange(prevFrom, prevTo),
      window.api.stats.getWorkByDay(addDays(weekStart, -29), streakTo),
      window.api.settings.get('dailyWorkGoal'),
      window.api.settings.get('weeklyWorkGoal')
    ]).then(([d, tc, tp, top, heat, mc, mp, wd, goal, weekGoal]) => {
      setDaily(d)
      setTagCurrent(tc)
      setTagPrev(tp)
      setTopApps(top)
      setHeatmap(heat)
      setMeetCurrent(mc)
      setMeetPrev(mp)
      setWorkDays(wd as WorkDayStat[])
      const goalMinutes = typeof goal === 'number' ? goal : parseInt(String(goal ?? '0')) || 0
      setGoalSeconds(goalMinutes * 60)
      const weekGoalMinutes =
        typeof weekGoal === 'number' ? weekGoal : parseInt(String(weekGoal ?? '')) || WEEKLY_GOAL_HOURS * 60
      setWeekGoalSeconds(weekGoalMinutes * 60)
    })
  }, [weekStart, weekEnd, prevFrom, prevTo, streakTo])

  const weekRows = useMemo(
    () => daily.filter((d) => d.date >= weekStart && d.date <= weekEnd),
    [daily, weekStart, weekEnd]
  )
  const prevRows = useMemo(
    () => daily.filter((d) => d.date >= prevFrom && d.date <= prevTo),
    [daily, prevFrom, prevTo]
  )

  const activeCurrent = weekRows.reduce((s, d) => s + d.totalActive, 0)
  const activePrev = prevRows.reduce((s, d) => s + d.totalActive, 0)
  const workCurrent = tagSeconds(tagCurrent, 'work')
  const workPrev = tagSeconds(tagPrev, 'work')
  const distractingCurrent = tagSeconds(tagCurrent, 'distracting')
  const distractingPrev = tagSeconds(tagPrev, 'distracting')
  const meetingCurrent = sumMeetings(meetCurrent)
  const meetingPrev = sumMeetings(meetPrev)

  const chartData = weekRows.map((row) => {
    const label = weekdayLabel(row.date)
    const byTag = (tag: string): number =>
      row.byTag.find((t) => t.tag === tag)?.seconds ?? 0
    return {
      label,
      work: byTag('work'),
      neutral: byTag('neutral'),
      distracting: byTag('distracting'),
      untagged: byTag('untagged')
    }
  })

  // Серия: сегодня ещё идёт, поэтому не рвём серию из-за незакрытого дня
  const streak = ((): number => {
    if (goalSeconds <= 0) return 0
    let count = 0
    for (let i = workDays.length - 1; i >= 0; i--) {
      const met = workDays[i].seconds >= goalSeconds
      if (met) count++
      else if (i === workDays.length - 1) continue
      else break
    }
    return count
  })()

  const weekWork = weekRows.reduce(
    (sum, row) => sum + (workDays.find((d) => d.date === row.date)?.seconds ?? 0),
    0
  )
  const weekGoal = weekGoalSeconds

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-medium">Неделя</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-tt-muted">
            <button
              onClick={() => setWeekOffset((offset) => offset - 1)}
              className="no-drag rounded-md p-0.5 hover:bg-tt-surface hover:text-tt-text"
              title="Предыдущая неделя"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="tabular-nums text-tt-text">
              {weekStart} — {weekEnd}
            </span>
            {weekOffset === 0 && (
              <span className="rounded bg-tt-accent/25 px-2 py-0.5 text-[10px] font-medium text-tt-accent">
                текущая
              </span>
            )}
            <button
              onClick={() => setWeekOffset((offset) => offset + 1)}
              disabled={weekOffset >= 0}
              className="no-drag rounded-md p-0.5 hover:bg-tt-surface hover:text-tt-text disabled:opacity-30"
              title="Следующая неделя"
            >
              <ChevronRight size={14} />
            </button>
            <span>
              · сравнение с {prevFrom} — {prevTo}
            </span>
          </div>
        </div>
        <button
          onClick={() => {
            window.api.report.copyWeek(weekStart, weekEnd).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            })
          }}
          className="no-drag shrink-0 rounded-md border border-tt-border px-3 py-1.5 text-xs hover:bg-tt-surface"
          title="Скопировать текстовый отчёт за неделю в буфер"
        >
          {copied ? 'скопировано ✓' : 'скопировать отчёт'}
        </button>
      </div>

      {/* Четыре KPI с дельтой */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Активность"
          value={formatDuration(activeCurrent)}
          delta={deltaLabel(activeCurrent, activePrev)}
          tone="good"
          color={METRIC.activity}
        />
        <KpiCard
          label="Работа"
          value={formatDuration(workCurrent)}
          delta={deltaLabel(workCurrent, workPrev)}
          tone="good"
          color={METRIC.work}
        />
        <KpiCard
          label="Отвлечения"
          value={formatDuration(distractingCurrent)}
          delta={deltaLabel(distractingCurrent, distractingPrev)}
          tone="bad"
          color={METRIC.distracting}
        />
        <KpiCard
          label="Созвоны"
          value={formatDuration(meetingCurrent)}
          delta={deltaLabel(meetingCurrent, meetingPrev)}
          tone="neutral"
          color={METRIC.meeting}
        />
      </div>

      {!deltaLabel(activeCurrent, activePrev) && (
        <p className="-mt-2 text-[11px] text-tt-muted">
          Дельты появятся, когда наберётся прошлая неделя: тогда же станет видно, растем
          или падаем.
        </p>
      )}

      {weekGoal > 0 && (
        <section className="rounded-lg border border-tt-border bg-tt-surface p-5">
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-tt-muted">
              Цель недели <span className="text-tt-text">{formatDuration(weekGoal)}</span> — сделано{' '}
              <span style={{ color: METRIC.work }}>{formatDuration(weekWork)}</span>
              {(() => {
                const tier = reachedTier(weekWork, weekGoal)
                if (!tier) return null
                const color =
                  tier.tier === 'gold' ? '#e0af68' : tier.tier === 'silver' ? '#c0caf5' : '#cd7f32'
                return (
                  <span className="ml-2" style={{ color }}>
                    {tier.label}
                  </span>
                )
              })()}
            </span>
            {goalSeconds > 0 && (
              <span className="text-tt-muted">
                серия <span className="text-tt-text">{streak}</span>{' '}
                {streak === 1 ? 'день' : streak >= 2 && streak <= 4 ? 'дня' : 'дней'} подряд
              </span>
            )}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-tt-bg">
            <div
              className="h-full rounded"
              style={{
                width: `${Math.min((weekWork / weekGoal) * 100, 100)}%`,
                backgroundColor: METRIC.work
              }}
            />
          </div>
        </section>
      )}

      {/* Распределение по дням */}
      <section className="rounded-lg border border-tt-border bg-tt-surface p-5">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-tt-muted">
          По дням
        </h2>
        {activeCurrent === 0 ? (
          <div className="py-10 text-center text-sm text-tt-muted">За эту неделю данных нет.</div>
        ) : (
          <BarChart width={860} height={260} data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#414868" vertical={false} />
            <XAxis dataKey="label" stroke="#9aa5ce" fontSize={11} tickLine={false} />
            <YAxis
              stroke="#9aa5ce"
              fontSize={11}
              tickLine={false}
              tickFormatter={(v: number) => formatShort(v)}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#1f2335', border: '1px solid #414868', fontSize: 12 }}
              labelStyle={{ color: '#c0caf5' }}
              formatter={(value: number, name: string) => [formatDuration(value), name]}
            />
            <Bar dataKey="work" stackId="a" fill={TAG_CONFIG.work.color} name="Работа" />
            <Bar dataKey="neutral" stackId="a" fill={TAG_CONFIG.neutral.color} name="Нейтр." />
            <Bar
              dataKey="distracting"
              stackId="a"
              fill={TAG_CONFIG.distracting.color}
              name="Отвлечение"
            />
            <Bar dataKey="untagged" stackId="a" fill="#414868" name="Без тега" />
          </BarChart>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-[10px] text-tt-muted">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: TAG_CONFIG.work.color }} />
            работа
          </span>
          <span className="flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: TAG_CONFIG.neutral.color }}
            />
            нейтрально
          </span>
          <span className="flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-sm"
              style={{ backgroundColor: TAG_CONFIG.distracting.color }}
            />
            отвлечение
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-[#414868]" />
            без тега
          </span>
        </div>
      </section>

      {/* Топ приложений */}
      <section className="rounded-lg border border-tt-border bg-tt-surface p-5">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-tt-muted">
          По приложениям
        </h2>
        {topApps.length === 0 ? (
          <div className="py-6 text-center text-sm text-tt-muted">Нет данных.</div>
        ) : (
          <div className="space-y-1.5">
            {topApps.map((app) => {
              const max = topApps[0]?.totalTime ?? 1
              return (
                <div key={app.appName} className="flex items-center gap-3 text-xs">
                  <span className="w-36 shrink-0 truncate" title={app.appName}>
                    {app.appName}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded bg-tt-bg">
                    <div
                      className="h-full rounded bg-tt-accent/70"
                      style={{ width: `${Math.max((app.totalTime / max) * 100, 0.5)}%` }}
                    />
                  </div>
                  <span className="w-16 text-right tabular-nums text-tt-muted">
                    {formatDuration(app.totalTime)}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Heatmap — отдельным режимом */}
      <section className="rounded-lg border border-tt-border bg-tt-surface">
        <button
          onClick={() => setShowHeatmap((v) => !v)}
          className="no-drag flex w-full items-center justify-between px-5 py-3 text-left"
        >
          <span className="text-xs font-medium uppercase tracking-wide text-tt-muted">
            Когда работаю
          </span>
          <span className="text-[11px] text-tt-muted">{showHeatmap ? 'скрыть' : 'показать'}</span>
        </button>
        {showHeatmap && (
          <div className="border-t border-tt-border p-5">
            <Heatmap heatmap={heatmap} />
          </div>
        )}
      </section>
    </div>
  )
}

// ─── KPI ───────────────────────────────────────────────────────

function deltaLabel(current: number, previous: number): string | null {
  if (previous <= 0) return null
  const pct = Math.round(((current - previous) / previous) * 100)
  return `${pct > 0 ? '+' : ''}${pct}%`
}

function KpiCard({
  label,
  value,
  delta,
  tone,
  color
}: {
  label: string
  value: string
  delta: string | null
  tone: Tone
  color: string
}): JSX.Element {
  const isUp = delta?.startsWith('+') ?? false
  const good = tone === 'neutral' ? null : tone === 'good' ? isUp : !isUp
  const deltaClass = good === null ? 'text-tt-muted' : good ? 'text-tt-green' : 'text-tt-red'

  return (
    <div className="rounded-lg border border-tt-border bg-tt-surface p-4">
      <div className="text-xs text-tt-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold leading-none" style={{ color }}>
        {value}
      </div>
      <div className={`mt-2 text-[11px] ${deltaClass}`} title="К прошлой неделе">
        {delta ?? '—'}
      </div>
    </div>
  )
}

// ─── Heatmap ───────────────────────────────────────────────────

const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

function Heatmap({ heatmap }: { heatmap: HeatmapCell[] }): JSX.Element {
  if (heatmap.length === 0) {
    return <p className="text-xs text-tt-muted">Данных для heatmap нет.</p>
  }

  const max = Math.max(...heatmap.map((c) => c.seconds), 0)
  const grid: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const cell of heatmap) {
    grid[cell.dayOfWeek][cell.hour] = cell.seconds
  }

  return (
    <div>
      <div className="flex">
        <div className="w-8" />
        {Array.from({ length: 24 }, (_, hour) => (
          <div key={hour} className="flex-1 text-center text-[9px] text-tt-muted">
            {hour % 3 === 0 ? hour : ''}
          </div>
        ))}
      </div>
      {grid.map((row, dayIdx) => (
        <div key={dayIdx} className="flex items-center">
          <div className="w-8 text-[10px] text-tt-muted">{DAYS[dayIdx]}</div>
          {row.map((seconds, hour) => (
            <div
              key={hour}
              className="m-[1px] h-4 flex-1 rounded-sm"
              style={{
                backgroundColor:
                  seconds > 0 && max > 0
                    ? `rgba(122, 162, 247, ${0.15 + (seconds / max) * 0.85})`
                    : '#1f2335'
              }}
              title={`${DAYS[dayIdx]} ${hour}:00 — ${formatDuration(seconds)}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
