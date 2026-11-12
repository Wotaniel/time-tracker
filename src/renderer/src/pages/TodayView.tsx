import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, List } from 'lucide-react'
import type {
  ActivityEvent,
  Category,
  DayCoverage,
  DetailedDaySummary,
  Meeting,
  TagTargetType,
  TagType,
  TaskStat,
  UntaggedEntry,
  WindowEntry
} from '../../../shared/types'
import { formatDuration, formatLocalDate } from '../lib/format'
import { AppIcon } from '../lib/app-icons'
import { TagBadge, TagMenu, tagColor, useAppTags } from '../lib/tags'
import { METRIC } from '../lib/colors'
import { extractDomain, groupByDomain, isBrowser } from '../lib/domains'
import { mergeMeetings, meetingSeconds } from '../../../shared/meetings'
import { sunTimes, type SunTimes } from '../../../shared/sun'
import { DayLane } from '../components/DayLane'
import { EventList } from '../components/EventList'

/**
 * «Сегодня» — четыре слоя с явной иерархией:
 * итог → лента дня → куда ушло → список приложений.
 * Сырые события — по кнопке: это проверка, а не первый взгляд.
 */

type Filter = 'all' | 'work'

export function TodayView({ onOpenSettings }: { onOpenSettings?: () => void }): JSX.Element {
  const [selectedDate, setSelectedDate] = useState(() => formatLocalDate(new Date()))
  const [summary, setSummary] = useState<DetailedDaySummary[]>([])
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [coverage, setCoverage] = useState<DayCoverage | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [showEvents, setShowEvents] = useState(false)
  const [showTasks, setShowTasks] = useState(false)
  const [tasks, setTasks] = useState<TaskStat[]>([])
  const [untagged, setUntagged] = useState<UntaggedEntry[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [goalSeconds, setGoalSeconds] = useState(0)
  const [location, setLocation] = useState<{ lat: number; lon: number } | null>(null)
  const { tags, setTag, deleteTag } = useAppTags()

  // Всё, что показывает день, обновляется вместе: раньше созвоны и покрытие
  // запрашивались один раз при открытии и не появлялись, пока не сменишь дату.
  const load = useCallback(async () => {
    const [sum, ev, cov, meet, unt] = await Promise.all([
      window.api.activities.getSummaryDetailed(selectedDate),
      window.api.activities.getDay(selectedDate),
      window.api.activities.getDayCoverage(selectedDate),
      window.api.meetings.getDay(selectedDate),
      window.api.activities.getUntagged(selectedDate)
    ])
    setSummary(sum)
    setEvents(ev)
    setCoverage(cov)
    setMeetings(meet)
    setUntagged(unt)
  }, [selectedDate])

  useEffect(() => {
    void load()
    const interval = setInterval(() => void load(), 5000)
    return () => clearInterval(interval)
  }, [load])

  // Категории приходят из правил: показываем их, иначе работа правил не видна
  useEffect(() => {
    window.api.categories.getAll().then(setCategories)
    window.api.settings.get('dailyWorkGoal').then((value) => {
      const minutes = typeof value === 'number' ? value : parseInt(String(value ?? '0')) || 0
      setGoalSeconds(minutes * 60)
    })
    Promise.all([window.api.settings.get('locationLat'), window.api.settings.get('locationLon')]).then(
      ([lat, lon]) => {
        const latNum = typeof lat === 'number' ? lat : parseFloat(String(lat ?? ''))
        const lonNum = typeof lon === 'number' ? lon : parseFloat(String(lon ?? ''))
        if (Number.isFinite(latNum) && Number.isFinite(lonNum)) {
          setLocation({ lat: latNum, lon: lonNum })
        }
      }
    )
  }, [])

  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const categoryFor = useCallback(
    (id: number | null | undefined): string | null => {
      if (!id) return null
      return categoryById.get(id)?.name ?? null
    },
    [categories]
  )

  useEffect(() => {
    if (!showTasks) return
    window.api.stats.getTasks(selectedDate, selectedDate).then(setTasks)
  }, [showTasks, selectedDate])

  const tagFor = useCallback(
    (appName: string, url: string | null): TagType | undefined => {
      const appTag = tags.get(`app:${appName}`)
      if (appTag) return appTag
      if (!url) return undefined
      try {
        const host = new URL(url).hostname.replace(/^www\./, '')
        return tags.get(`domain:${host}`)
      } catch {
        return undefined
      }
    },
    [tags]
  )

  // Перезапуск приложения рвал один звонок на два интервала — склеиваем соседние
  const mergedMeetings = mergeMeetings(meetings)

  const sun: SunTimes | null = location
    ? sunTimes(selectedDate, location.lat, location.lon)
    : null

  const totalActive = summary.reduce((sum, item) => sum + item.totalTime, 0)
  const meetingTime = mergedMeetings.reduce((sum, m) => sum + meetingSeconds(m), 0)

  // Работа = тег приложения ИЛИ тег домена. Раньше учитывался только тег
  // приложения, поэтому вся работа в браузере (jira, figma.com, github) не
  // попадала в цифру: «Сегодня» показывало 171 мин там, где «Неделя» — 247.
  const workByApp = new Map<string, number>()
  for (const item of summary) {
    if (tags.get(`app:${item.appName}`) === 'work') {
      workByApp.set(item.appName, item.totalTime)
      continue
    }
    let seconds = 0
    for (const win of item.windows) {
      const domain = extractDomain(win.url)
      if (domain && tags.get(`domain:${domain}`) === 'work') seconds += win.totalTime
    }
    if (seconds > 0) workByApp.set(item.appName, seconds)
  }

  const workTime = [...workByApp.values()].reduce((sum, seconds) => sum + seconds, 0)

  const visible = filter === 'work' ? summary.filter((item) => workByApp.has(item.appName)) : summary
  const secondsFor = (item: DetailedDaySummary): number =>
    filter === 'work' ? workByApp.get(item.appName) ?? 0 : item.totalTime
  const maxTime = Math.max(...visible.map(secondsFor), 1)

  // Браузер как приложение не показываем: его время уже разложено по доменам
  const untaggedRows = untagged.filter(
    (row) => row.targetType === 'domain' || !isBrowser(row.targetKey)
  )
  const untaggedTotal = untaggedRows.reduce((sum, row) => sum + row.seconds, 0)

  // Задачи + остальное + созвоны должны сходиться с рабочим временем:
  // остальное — это работа, не попавшая ни в одну задачу, без созвонов
  // (созвоны идут отдельной строкой, чтобы не считать их дважды).
  const tasksTotal = tasks.reduce((sum, task) => sum + task.seconds, 0)
  const meetingsInsideWork = Math.min(meetingTime, workTime)
  const otherWork = Math.max(0, workTime - tasksTotal - meetingsInsideWork)
  const tasksMax = Math.max(tasksTotal ? tasks[0].seconds : 0, otherWork, meetingsInsideWork, 1)

  const today = formatLocalDate(new Date())
  const shiftDate = (days: number): void => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    setSelectedDate(formatLocalDate(d))
  }

  return (
    <div className="space-y-5">
      {/* ─── Слой 1: дата и герой-показатель ─────────────────── */}
      <section className="rounded-lg border border-tt-border bg-tt-surface p-5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => shiftDate(-1)}
            className="no-drag rounded-md p-1 text-tt-muted hover:bg-tt-bg hover:text-tt-text"
            title="Предыдущий день"
          >
            <ChevronLeft size={18} />
          </button>
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-tt-muted">{selectedDate}</span>
            {selectedDate === today && (
              <span className="rounded bg-tt-accent/25 px-2 py-0.5 text-[10px] font-medium text-tt-accent">
                сегодня
              </span>
            )}
          </div>
          <button
            onClick={() => shiftDate(1)}
            disabled={selectedDate === today}
            className="no-drag rounded-md p-1 text-tt-muted hover:bg-tt-bg hover:text-tt-text disabled:opacity-30"
            title="Следующий день"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-2">
          <div>
            <div className="pb-1 text-xs leading-tight text-tt-muted">Активность</div>
            <div className="text-5xl font-semibold leading-none text-tt-text">
              {formatDuration(totalActive)}
            </div>
          </div>

          {/* Цель по работе */}
          {goalSeconds > 0 && (
            <div className="w-full max-w-md pb-1">
              <div className="mb-1 flex items-baseline justify-between text-[11px] text-tt-muted">
                <span>
                  цель {formatDuration(goalSeconds)}
                  {workTime >= goalSeconds ? (
                    <span className="ml-2" style={{ color: METRIC.work }}>
                      выполнена
                    </span>
                  ) : (
                    <span className="ml-2">
                      осталось {formatDuration(goalSeconds - workTime)}
                    </span>
                  )}
                </span>
                <span>{Math.round((workTime / goalSeconds) * 100)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-tt-bg">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${Math.min((workTime / goalSeconds) * 100, 100)}%`,
                    backgroundColor: METRIC.work
                  }}
                />
              </div>
            </div>
          )}

          {/* Слой 3: куда ушло остальное */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 pb-1 text-xs text-tt-muted">
            <span>
              работа{' '}
              <span style={{ color: METRIC.work }}>{formatDuration(workTime)}</span>
            </span>
            <span>
              созвоны{' '}
              <span
                style={{ color: METRIC.meeting }}
                title="Входят в активность, не прибавляются к ней"
              >
                {formatDuration(meetingTime)}
              </span>
            </span>
            {coverage && (
              <>
                <span>
                  AFK{' '}
                  <span style={{ color: METRIC.afk }}>{formatDuration(coverage.afk)}</span>
                </span>
                <span>
                  не записано{' '}
                  <span style={{ color: METRIC.uncovered }}>
                    {formatDuration(coverage.uncovered)}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ─── Слой 2: лента дня ──────────────────────────────── */}
      <section className="rounded-lg border border-tt-border bg-tt-surface p-5">
        <DayLane
          events={events}
          meetings={mergedMeetings}
          date={selectedDate}
          tagFor={tagFor}
          categoryFor={categoryFor}
          sun={sun}
        />
      </section>

      {/* ─── Слой «без тега»: время есть, категории нет ──────── */}
      {/* Пустую очередь не показываем: блок без содержимого только занимает место */}
      {untaggedRows.length > 0 && (
        <section className="rounded-lg border border-tt-border bg-tt-surface">
          <div className="flex items-baseline justify-between px-4 py-2.5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-tt-muted">Без тега</h2>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-tt-muted">
                {untaggedRows.length} · {formatDuration(untaggedTotal)}
              </span>
              {onOpenSettings && (
                <button
                  onClick={onOpenSettings}
                  className="no-drag text-[11px] text-tt-accent hover:underline"
                  title="Правила и категории"
                >
                  правила →
                </button>
              )}
            </div>
          </div>
          <div className="border-t border-tt-border">
            <p className="px-4 pt-2 text-[11px] text-tt-muted">
              Время есть, но неизвестно, работа это или отвлечение. Тег применится к приложению
              или домену целиком — сразу и на будущее.
            </p>
            <div className="divide-y divide-tt-border/50">
              {untaggedRows.map((row) => {
                const key = `${row.targetType}:${row.targetKey}`
                return (
                  <div key={key} className="flex items-center gap-3 px-4 py-1.5 text-xs">
                    <span
                      className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-tt-muted"
                      title={row.targetType === 'domain' ? 'домен' : 'приложение'}
                    >
                      {row.targetType === 'domain' ? 'домен' : 'прил.'}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{row.targetKey}</span>
                    {tags.get(key) && <TagBadge tag={tags.get(key)!} />}
                    <span className="w-16 text-right tabular-nums text-tt-muted">
                      {formatDuration(row.seconds)}
                    </span>
                    <TagMenu
                      currentTag={tags.get(key)}
                      onSelect={async (tag) => {
                        await setTag(row.targetType, row.targetKey, tag)
                        void load()
                      }}
                      onClear={async () => {
                        await deleteTag(row.targetType, row.targetKey)
                        void load()
                      }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* ─── Слой 4: приложения ─────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-tt-muted">Приложения</h2>
          <div className="flex items-center gap-1 rounded-md border border-tt-border p-0.5 text-[11px]">
            <button
              onClick={() => setFilter('all')}
              className={`rounded px-2 py-0.5 ${
                filter === 'all' ? 'bg-tt-accent/25 text-tt-accent' : 'text-tt-muted'
              }`}
            >
              все
            </button>
            <button
              onClick={() => setFilter('work')}
              className={`rounded px-2 py-0.5 ${
                filter === 'work' ? 'bg-tt-accent/25 text-tt-accent' : 'text-tt-muted'
              }`}
            >
              только работа
            </button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="rounded-lg border border-tt-border bg-tt-surface p-8 text-center text-sm text-tt-muted">
            {filter === 'work' ? 'Рабочих приложений за этот день нет.' : 'Нет данных за этот день.'}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-tt-border bg-tt-surface">
            {visible.map((item, idx) => (
              <AppRow
                key={`${item.appName}-${idx}`}
                item={item}
                seconds={secondsFor(item)}
                category={
                  item.categoryId ? categoryById.get(item.categoryId) ?? null : null
                }
                maxTime={maxTime}
                tags={tags}
                onSetTag={setTag}
                onDeleteTag={deleteTag}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─── Задачи по Jira (вместо отдельного экрана «Работа») ── */}
      <section className="rounded-lg border border-tt-border bg-tt-surface">
        <button
          onClick={() => setShowTasks((v) => !v)}
          className="no-drag flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-tt-muted hover:text-tt-text"
        >
          <ChevronDown
            size={14}
            className={`transition-transform ${showTasks ? 'rotate-180' : ''}`}
          />
          Задачи за день
        </button>
        {showTasks && (
          <div className="border-t border-tt-border px-4 py-3">
            <div className="space-y-1.5">
              {tasks.map((task) => (
                <TaskRow
                  key={task.taskKey}
                  label={task.taskKey}
                  seconds={task.seconds}
                  max={tasksMax}
                  color={METRIC.work}
                  href={`https://jira.int.agrd.dev/browse/${task.taskKey}`}
                />
              ))}

              <TaskRow
                label="Остальное"
                seconds={otherWork}
                max={tasksMax}
                color={METRIC.afk}
                hint="работа без ключа задачи"
              />

              <TaskRow
                label="Созвоны"
                seconds={meetingsInsideWork}
                max={tasksMax}
                color={METRIC.meeting}
                hint="идут параллельно работе, в сумму задач не входят"
              />
            </div>

            <p className="mt-2 border-t border-tt-border/60 pt-2 text-[11px] text-tt-muted">
              Работа за день: <span className="text-tt-text">{formatDuration(workTime)}</span> —
              задачи {formatDuration(tasksTotal)}, остальное {formatDuration(otherWork)}, созвоны{' '}
              {formatDuration(meetingsInsideWork)}
            </p>
          </div>
        )}
      </section>

      {/* ─── Сырые события — по кнопке ──────────────────────── */}
      <section className="rounded-lg border border-tt-border bg-tt-surface">
        <button
          onClick={() => setShowEvents((v) => !v)}
          className="no-drag flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-tt-muted hover:text-tt-text"
        >
          <List size={14} />
          События дня ({events.length})
        </button>
        {showEvents && (
          <div className="max-h-96 overflow-auto border-t border-tt-border">
            <EventList events={events} />
          </div>
        )}
      </section>
    </div>
  )
}

// ─── Строка задачи/остального/созвонов ─────────────────────────

function TaskRow({
  label,
  seconds,
  max,
  color,
  href,
  hint
}: {
  label: string
  seconds: number
  max: number
  color: string
  href?: string
  hint?: string
}): JSX.Element {
  return (
    <div className="flex items-center gap-3 text-xs" title={hint}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="w-28 shrink-0 truncate text-tt-accent hover:underline"
        >
          {label}
        </a>
      ) : (
        <span className="w-28 shrink-0 truncate text-tt-text/80">{label}</span>
      )}
      <div className="h-1.5 flex-1 overflow-hidden rounded bg-tt-bg">
        <div
          className="h-full rounded"
          style={{
            width: `${Math.max((seconds / max) * 100, seconds > 0 ? 0.5 : 0)}%`,
            backgroundColor: color
          }}
        />
      </div>
      <span className="w-16 text-right tabular-nums text-tt-muted">
        {formatDuration(seconds)}
      </span>
    </div>
  )
}

// ─── Строка приложения ─────────────────────────────────────────

function AppRow({
  item,
  seconds,
  category,
  maxTime,
  tags,
  onSetTag,
  onDeleteTag
}: {
  item: DetailedDaySummary
  seconds: number
  category: Category | null
  maxTime: number
  tags: Map<string, TagType>
  onSetTag: (targetType: TagTargetType, targetKey: string, tag: TagType) => Promise<void>
  onDeleteTag: (targetType: TagTargetType, targetKey: string) => Promise<void>
}): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const browser = isBrowser(item.appName)
  const detailCount = browser ? groupByDomain(item.windows).length : item.windows.length
  const hasDetail = detailCount > 1
  const appTag = tags.get(`app:${item.appName}`)
  const barWidth = (seconds / maxTime) * 100

  return (
    <div className="border-b border-tt-border/60 last:border-b-0">
      <div
        onClick={() => hasDetail && setExpanded(!expanded)}
        className={`flex items-center gap-2 px-3 py-2 ${
          hasDetail ? 'cursor-pointer hover:bg-tt-bg/50' : 'cursor-default'
        }`}
      >
        <div className="w-4 shrink-0">
          {hasDetail && (
            <ChevronRight
              size={14}
              className={`text-tt-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          )}
        </div>
        <AppIcon appName={item.appName} bundleId={item.appBundleId} />
        <div className="relative h-7 min-w-0 flex-1 overflow-hidden rounded">
          <div
            className="absolute inset-y-0 left-0 rounded"
            style={{
              width: `${Math.max(barWidth, 0.5)}%`,
              backgroundColor: tagColor(appTag),
              opacity: 0.3
            }}
          />
          <div className="relative flex h-full items-center gap-2 px-2">
            <span className="truncate text-sm">{item.appName}</span>
            {appTag && <TagBadge tag={appTag} />}
            {category && (
              <span
                className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px]"
                style={{ color: category.color, backgroundColor: `${category.color}22` }}
                title={`Категория «${category.name}» — проставлена правилом`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                {category.name}
              </span>
            )}
          </div>
        </div>
        <span className="w-16 text-right text-sm tabular-nums text-tt-muted">
          {formatDuration(seconds)}
        </span>
        <TagMenu
          currentTag={appTag}
          onSelect={(tag) => onSetTag('app', item.appName, tag)}
          onClear={() => onDeleteTag('app', item.appName)}
        />
      </div>

      {expanded && hasDetail && (
        <div className="border-t border-tt-border/50 px-3 pb-2 pt-1">
          {browser ? (
            <BrowserDetail
              windows={item.windows}
              tags={tags}
              onSetTag={onSetTag}
              onDeleteTag={onDeleteTag}
            />
          ) : (
            <WindowList windows={item.windows} />
          )}
        </div>
      )}
    </div>
  )
}

/** Окна приложения (не браузер) */
function WindowList({ windows }: { windows: WindowEntry[] }): JSX.Element {
  return (
    <div>
      {windows.map((win, idx) => (
        <div key={idx} className="flex items-center gap-2 py-1 pl-10">
          <span className="min-w-0 flex-1 truncate text-xs text-tt-text/70">
            {win.windowTitle || '(empty)'}
          </span>
          <span className="w-16 text-right text-xs tabular-nums text-tt-muted">
            {formatDuration(win.totalTime)}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Браузер: домены с раскрытием до вкладок и тегом на домен */
function BrowserDetail({
  windows,
  tags,
  onSetTag,
  onDeleteTag
}: {
  windows: WindowEntry[]
  tags: Map<string, TagType>
  onSetTag: (targetType: TagTargetType, targetKey: string, tag: TagType) => Promise<void>
  onDeleteTag: (targetType: TagTargetType, targetKey: string) => Promise<void>
}): JSX.Element {
  const groups = groupByDomain(windows)
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)

  return (
    <div>
      {groups.map((group) => {
        const showTabs = expandedDomain === group.domain
        const multiTabs = group.tabs.length > 1
        const domainTag = tags.get(`domain:${group.domain}`)

        return (
          <div key={group.domain} className="py-1 pl-10">
            <div
              onClick={() => multiTabs && setExpandedDomain(showTabs ? null : group.domain)}
              className={`flex items-center gap-1.5 ${multiTabs ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {multiTabs ? (
                <ChevronRight
                  size={12}
                  className={`shrink-0 text-tt-muted transition-transform ${
                    showTabs ? 'rotate-90' : ''
                  }`}
                />
              ) : (
                <div className="w-3 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-tt-text/80">
                {group.domain}
              </span>
              {domainTag && <TagBadge tag={domainTag} />}
              <span className="w-16 text-right text-xs tabular-nums text-tt-muted">
                {formatDuration(group.totalTime)}
              </span>
              <TagMenu
                currentTag={domainTag}
                onSelect={(tag) => onSetTag('domain', group.domain, tag)}
                onClear={() => onDeleteTag('domain', group.domain)}
              />
            </div>

            {showTabs && multiTabs && (
              <div className="ml-4 mt-0.5 space-y-0.5 border-l border-tt-border/50 pl-3">
                {group.tabs.map((tab, idx) => (
                  <div key={idx} className="flex items-center gap-1 py-0.5">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-tt-muted">
                      {tab.windowTitle || tab.url || '(empty)'}
                    </span>
                    <span className="w-16 text-right text-[11px] tabular-nums text-tt-muted">
                      {formatDuration(tab.totalTime)}
                    </span>
                    <div className="w-6" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
