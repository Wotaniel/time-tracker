/**
 * Event repository — CRUD для событий (events table).
 *
 * Ответственность:
 * - insertEvent / closeEvent / getEventsByDay / getEventsByRange
 * - getDaySummary / getDaySummaryDetailed
 * - getAfkTimeForDay
 *
 * Не зависит от categories/rules/tags — только events table + LEFT JOIN categories.
 */
import type Database from 'better-sqlite3'
import type { ActivityEvent, DayCoverage, DaySummary, DetailedDaySummary } from '../../shared/types'
import {
  rowToEvent,
  localDayBounds,
  extractTaskKey,
  type RawEventRow,
  type RawSummaryRow,
  type RawDetailedRow
} from './helpers'

export class EventRepository {
  constructor(private db: Database.Database) {}

  /**
   * Вставка нового события. Идемпотентна: если запись с тем же ts_start
   * уже существует — обновляет её (ON CONFLICT DO UPDATE).
   * Автоматически категоризует через rules (вызывает callback).
   */
  insertEvent(
    event: Omit<ActivityEvent, 'id'>,
    categorize?: (appName: string, windowTitle: string, appBundleId?: string, url?: string | null) => number | null
  ): number {
    const categoryId = event.categoryId ?? categorize?.(
      event.appName,
      event.windowTitle,
      event.appBundleId,
      event.url ?? undefined
    ) ?? null

    const taskKey = event.taskKey ?? extractTaskKey(event.windowTitle) ?? extractTaskKey(event.url ?? '')

    const stmt = this.db.prepare(`
      INSERT INTO events (ts_start, ts_end, duration, app_name, app_bundle, window_title, url, category_id, task_key, is_afk, is_private)
      VALUES (@tsStart, @tsEnd, @duration, @appName, @appBundleId, @windowTitle, @url, @categoryId, @taskKey, @isAfk, @isPrivate)
    `)
    const result = stmt.run({
      tsStart: event.tsStart,
      tsEnd: event.tsEnd,
      duration: event.duration,
      appName: event.appName,
      appBundleId: event.appBundleId ?? null,
      windowTitle: event.windowTitle,
      url: event.url ?? null,
      categoryId: categoryId ?? null,
      taskKey: taskKey ?? null,
      isAfk: event.isAfk ? 1 : 0,
      isPrivate: event.isPrivate ? 1 : 0
    })
    return Number(result.lastInsertRowid)
  }

  /**
   * Закрывает событие: устанавливает ts_end и duration.
   * Вызывается при смене активного app/title или при AFK.
   */
  closeEvent(id: number, tsEnd: string, duration: number): void {
    this.db
      .prepare('UPDATE events SET ts_end = ?, duration = ? WHERE id = ?')
      .run(tsEnd, duration, id)
  }

  /**
   * Обновляет прогресс ещё не закрытого события.
   *
   * Зачем: длительность пишется только при закрытии, поэтому текущий кусок
   * активности не попадал ни в одну сводку — «за сегодня» отставало на всё
   * время, пока пользователь не переключит окно. Пишем прогресс по ходу дела,
   * заодно краш больше не оставляет событие с duration = 0.
   */
  updateEventProgress(id: number, tsEnd: string, duration: number): void {
    this.db
      .prepare('UPDATE events SET ts_end = ?, duration = ? WHERE id = ?')
      .run(tsEnd, duration, id)
  }

  /**
   * Покрытие дня: активность, AFK и время, не записанное вообще.
   *
   * Без этой разбивки день выглядит короче, чем был: непонятно, куда ушло
   * остальное — в отлучки или в простои самого приложения.
   */
  getDayCoverage(date: string): DayCoverage {
    const { start, end } = localDayBounds(date)
    const row = this.db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN is_afk = 0
            THEN (julianday(MIN(ts_end, @dayEnd)) - julianday(MAX(ts_start, @dayStart))) * 86400
            ELSE 0 END), 0) AS active,
          COALESCE(SUM(CASE WHEN is_afk = 1
            THEN (julianday(MIN(ts_end, @dayEnd)) - julianday(MAX(ts_start, @dayStart))) * 86400
            ELSE 0 END), 0) AS afk,
          COALESCE((julianday(MIN(max(ts_end), @dayEnd)) - julianday(MAX(min(ts_start), @dayStart))) * 86400, 0) AS span
        FROM events
        WHERE ts_start <= @dayEnd AND ts_end >= @dayStart
      `)
      .get({ dayStart: start, dayEnd: end }) as { active: number; afk: number; span: number } | undefined

    const active = Math.max(Math.round(row?.active ?? 0), 0)
    const afk = Math.max(Math.round(row?.afk ?? 0), 0)
    const span = Math.max(Math.round(row?.span ?? 0), 0)

    return { active, afk, span, uncovered: Math.max(span - active - afk, 0) }
  }

  /**
   * Восстановление после краша: находит и закрывает zombie-события.
   *
   * Zombie — это событие, которое было создано (insertEvent), но никогда
   * не закрыто (closeEvent не вызван) из-за краха приложения или kill -9.
   * У таких событий duration = 0 и ts_end ≈ ts_start.
   *
   * Recovery strategy:
   * - Для самого свежего zombie: если краш был недавно (< 5 мин),
   *   оцениваем duration = now - ts_start (пользователь, вероятно, ещё активен).
   * - Для остальных / старых zombie: duration = 1 (минимальное ненулевое,
   *   чтобы событие не пересобиралось при каждом следующем startup).
   *
   * Вызывается на startup перед началом poll loop.
   * Возвращает количество восстановленных событий.
   */
  recoverZombieEvents(): number {
    const now = Date.now()
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()

    const zombies = this.db
      .prepare(`
        SELECT id, ts_start FROM events
        WHERE duration = 0 AND is_afk = 0 AND ts_start > ?
        ORDER BY ts_start DESC
      `)
      .all(sevenDaysAgo) as { id: number; ts_start: string }[]

    if (zombies.length === 0) return 0

    let recovered = 0
    for (const zombie of zombies) {
      const startTime = new Date(zombie.ts_start).getTime()
      const elapsedSec = Math.round((now - startTime) / 1000)

      let duration: number
      let tsEnd: string

      if (elapsedSec > 0 && elapsedSec < 300) {
        // Recent crash — user was likely still active at time of crash
        duration = elapsedSec
        tsEnd = new Date().toISOString()
      } else {
        // Old zombie — data lost, mark with minimal duration so it
        // won't be found again on next startup (avoids reprocessing)
        duration = 1
        tsEnd = zombie.ts_start
      }

      this.closeEvent(zombie.id, tsEnd, duration)
      recovered++
    }

    return recovered
  }

  /**
   * Возвращает все события за конкретный день (локальный timezone).
   */
  getEventsByDay(date: string): ActivityEvent[] {
    const { start, end } = localDayBounds(date)
    // Пересечение с днём, а не только старт внутри дня: иначе событие,
    // начавшееся до полуночи, целиком исчезает из сегодняшнего дня.
    const rows = this.db
      .prepare('SELECT * FROM events WHERE ts_start <= ? AND ts_end >= ? ORDER BY ts_start ASC')
      .all(end, start) as RawEventRow[]

    return rows.map((row) => {
      const clampedStart = row.ts_start < start ? start : row.ts_start
      const clampedEnd = row.ts_end > end ? end : row.ts_end
      const duration = Math.max(
        0,
        Math.round((new Date(clampedEnd).getTime() - new Date(clampedStart).getTime()) / 1000)
      )
      return rowToEvent({ ...row, ts_start: clampedStart, ts_end: clampedEnd, duration })
    })
  }

  /**
   * Возвращает события за диапазон дат (локальный timezone).
   */
  getEventsByRange(fromDate: string, toDate: string): ActivityEvent[] {
    const { start } = localDayBounds(fromDate)
    const { end } = localDayBounds(toDate)
    const rows = this.db
      .prepare('SELECT * FROM events WHERE ts_start >= ? AND ts_start <= ? ORDER BY ts_start ASC')
      .all(start, end) as RawEventRow[]
    return rows.map(rowToEvent)
  }

  /**
   * Возвращает сводку за день: appName → totalTime, с процентами.
   */
  getDaySummary(date: string): DaySummary[] {
    const { start, end } = localDayBounds(date)
    const rows = this.db
      .prepare(`
        SELECT
          e.app_name        AS appName,
          SUM((julianday(MIN(e.ts_end, @dayEnd)) - julianday(MAX(e.ts_start, @dayStart))) * 86400) AS totalTime,
          e.category_id     AS categoryId,
          c.name            AS categoryName
        FROM events e
        LEFT JOIN categories c ON e.category_id = c.id
        WHERE e.ts_start <= @dayEnd AND e.ts_end >= @dayStart AND e.is_afk = 0
        GROUP BY e.app_name
        ORDER BY totalTime DESC
      `)
      .all({ dayStart: start, dayEnd: end }) as RawSummaryRow[]

    const total = rows.reduce((sum, r) => sum + r.totalTime, 0)
    return rows.map((r) => ({
      appName: r.appName,
      totalTime: Math.round(r.totalTime),
      percentage: total > 0 ? (r.totalTime / total) * 100 : 0,
      categoryId: r.categoryId ?? undefined,
      categoryName: r.categoryName ?? undefined
    }))
  }

  /**
   * Детальная сводка за день: appName с разбивкой по window_title.
   */
  getDaySummaryDetailed(date: string): DetailedDaySummary[] {
    const { start, end } = localDayBounds(date)
    const rows = this.db
      .prepare(`
        SELECT
          e.app_name        AS appName,
          e.app_bundle      AS appBundleId,
          e.window_title    AS windowTitle,
          e.url             AS url,
          SUM((julianday(MIN(e.ts_end, @dayEnd)) - julianday(MAX(e.ts_start, @dayStart))) * 86400) AS totalTime,
          e.category_id     AS categoryId,
          c.name            AS categoryName
        FROM events e
        LEFT JOIN categories c ON e.category_id = c.id
        WHERE e.ts_start <= @dayEnd AND e.ts_end >= @dayStart AND e.is_afk = 0
        GROUP BY e.app_name, e.window_title, e.url
        ORDER BY e.app_name, totalTime DESC
      `)
      .all({ dayStart: start, dayEnd: end }) as RawDetailedRow[]

    const appMap = new Map<string, DetailedDaySummary>()
    for (const row of rows) {
      let app = appMap.get(row.appName)
      if (!app) {
        app = {
          appName: row.appName,
          appBundleId: row.appBundleId,
          totalTime: 0,
          percentage: 0,
          categoryId: row.categoryId ?? undefined,
          categoryName: row.categoryName ?? undefined,
          windows: []
        }
        appMap.set(row.appName, app)
      }
      app.totalTime += Math.round(row.totalTime)
      app.windows.push({
        windowTitle: row.windowTitle,
        url: row.url,
        totalTime: row.totalTime
      })
    }

    const result = Array.from(appMap.values())
    const total = result.reduce((sum, a) => sum + a.totalTime, 0)
    result.forEach((a) => (a.percentage = total > 0 ? (a.totalTime / total) * 100 : 0))
    result.sort((a, b) => b.totalTime - a.totalTime)
    return result
  }

  /**
   * Возвращает суммарное время AFK (бездействия) за день.
   */
  getAfkTimeForDay(date: string): number {
    const { start, end } = localDayBounds(date)
    const row = this.db
      .prepare(`
        SELECT COALESCE(
          SUM((julianday(MIN(ts_end, @dayEnd)) - julianday(MAX(ts_start, @dayStart))) * 86400),
          0
        ) AS totalAfk
        FROM events
        WHERE ts_start <= @dayEnd AND ts_end >= @dayStart AND is_afk = 1
      `)
      .get({ dayStart: start, dayEnd: end }) as { totalAfk: number }
    return Math.round(row.totalAfk ?? 0)
  }
}
