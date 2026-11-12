import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, List } from 'lucide-react'
import type {
  ActivityEvent,
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
import { groupByDomain, isBrowser } from '../lib/domains'
import { DayLane } from '../components/DayLane'
import { EventList } from '../components/EventList'

/**
 * «Сегодня» — четыре слоя с явной иерархией:
 * итог → лента дня → куда ушло → список приложений.
 * Сырые события — по кнопке: это проверка, а не первый взгляд.
 */

type Filter = 'all' | 'work'

export function TodayView(): JSX.Element {
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

  const totalActive = summary.reduce((sum, item) => sum + item.totalTime, 0)
  const meetingTime = meetings.reduce((sum, m) => {
    const end = m.tsEnd ? new Date(m.tsEnd).getTime() : Date.now()
    return sum + Math.max(0, Math.round((end - new Date(m.tsStart).getTime()) / 1000))
  }, 0)

  const workApps = summary.filter((item) => tags.get(`app:${item.appName}`) === 'work')
  const workTime = workApps.reduce((sum, item) => sum + item.totalTime, 0)

  const visible = filter === 'work' ? workApps : summary
  const maxTime = visible[0]?.totalTime ?? 1

  // Браузер как приложение не показываем: его время уже разложено по доменам
  const untaggedRows = untagged.filter(
    (row) => row.targetType === 'domain' || !isBrowser(row.targetKey)
  )
  const untaggedTotal = untaggedRows.reduce((sum, row) => sum + row.seconds, 0)

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

          {/* Слой 3: куда ушло остальное */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 pb-1 text-xs text-tt-muted">
            <span>
              работа <span className="text-tt-text">{formatDuration(workTime)}</span>
            </span>
            <span>
              созвоны{' '}
              <span className="text-tt-purple" title="Входят в активность, не прибавляются к ней">
                {formatDuration(meetingTime)}
              </span>
            </span>
            {coverage && (
              <>
                <span>
                  AFK <span className="text-tt-text">{formatDuration(coverage.afk)}</span>
                </span>
                <span>
                  не записано{' '}
                  <span className="text-tt-red">{formatDuration(coverage.uncovered)}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ─── Слой 2: лента дня ──────────────────────────────── */}
      <section className="rounded-lg border border-tt-border bg-tt-surface p-5">
        <DayLane events={events} meetings={meetings} date={selectedDate} tagFor={tagFor} />
      </section>

      {/* ─── Слой «без тега»: время есть, категории нет ──────── */}
      <section className="rounded-lg border border-tt-border bg-tt-surface">
        <div className="flex items-baseline justify-between px-4 py-2.5">
          <h2 className="text-xs font-medium uppercase tracking-wide text-tt-muted">Без тега</h2>
          <span className="text-[11px] text-tt-muted">
            {untaggedRows.length === 0
              ? 'очередь пуста'
              : `${untaggedRows.length} · ${formatDuration(untaggedTotal)}`}
          </span>
        </div>
        {untaggedRows.length === 0 ? (
          <p className="border-t border-tt-border px-4 py-3 text-xs text-tt-muted">
            Всё размечено: за этот день не осталось времени без категории.
          </p>
        ) : (
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
        )}
      </section>

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
            {tasks.length === 0 ? (
              <p className="text-xs text-tt-muted">За этот день задач с ключом Jira нет.</p>
            ) : (
              <div className="space-y-1.5">
                {tasks.map((task) => (
                  <div key={task.taskKey} className="flex items-center gap-3 text-xs">
                    <a
                      href={`https://jira.int.agrd.dev/browse/${task.taskKey}`}
                      target="_blank"
                      rel="noreferrer"
                      className="w-28 shrink-0 text-tt-accent hover:underline"
                    >
                      {task.taskKey}
                    </a>
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-tt-bg">
                      <div
                        className="h-full rounded bg-tt-green/70"
                        style={{ width: `${Math.min(task.percentage, 100)}%` }}
                      />
                    </div>
                    <span className="w-16 text-right tabular-nums text-tt-muted">
                      {formatDuration(task.seconds)}
                    </span>
                  </div>
                ))}
              </div>
            )}
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

// ─── Строка приложения ─────────────────────────────────────────

function AppRow({
  item,
  maxTime,
  tags,
  onSetTag,
  onDeleteTag
}: {
  item: DetailedDaySummary
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
  const barWidth = (item.totalTime / maxTime) * 100

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
          </div>
        </div>
        <span className="w-16 text-right text-sm tabular-nums text-tt-muted">
          {formatDuration(item.totalTime)}
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
