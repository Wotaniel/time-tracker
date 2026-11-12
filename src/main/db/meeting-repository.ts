/**
 * Meeting repository — интервалы созвонов (meetings table).
 *
 * Зачем отдельная таблица, а не события: созвон идёт параллельно с работой
 * (человек в Figma и в звонке одновременно). Если писать его событием, время
 * сложится дважды — это уже случалось с Google Meet. Здесь интервал созвона
 * живёт отдельно и накладывается на шкалу активности, не входя в сумму.
 */
import type Database from 'better-sqlite3'
import type { Meeting } from '../../shared/types'
import { localDayBounds, type RawMeetingRow } from './helpers'

function rowToMeeting(row: RawMeetingRow): Meeting {
  return {
    id: row.id,
    tsStart: row.ts_start,
    tsEnd: row.ts_end,
    url: row.url,
    title: row.title
  }
}

export class MeetingRepository {
  constructor(private db: Database.Database) {}

  /** Открывает интервал созвона. ts_end остаётся NULL, пока звонок идёт */
  startMeeting(tsStart: string, url: string | null, title: string | null): number {
    const result = this.db
      .prepare('INSERT INTO meetings (ts_start, ts_end, url, title) VALUES (?, NULL, ?, ?)')
      .run(tsStart, url, title)
    return Number(result.lastInsertRowid)
  }

  /** Продлевает идущий созвон: вызывается, пока вкладка встречи видна */
  extendMeeting(id: number, tsEnd: string): void {
    this.db.prepare('UPDATE meetings SET ts_end = ? WHERE id = ?').run(tsEnd, id)
  }

  /** Закрывает интервал (таймаут, выход из приложения) */
  closeMeeting(id: number, tsEnd: string): void {
    this.db.prepare('UPDATE meetings SET ts_end = ? WHERE id = ?').run(tsEnd, id)
  }

  /** Созвоны, пересекающиеся с диапазоном дат (для недельной сводки) */
  getMeetingsByRange(fromDate: string, toDate: string): Meeting[] {
    const { start } = localDayBounds(fromDate)
    const { end } = localDayBounds(toDate)
    const rows = this.db
      .prepare(
        `SELECT * FROM meetings
         WHERE ts_start <= ? AND COALESCE(ts_end, ts_start) >= ?
         ORDER BY ts_start ASC`
      )
      .all(end, start) as RawMeetingRow[]
    return rows.map(rowToMeeting)
  }

  /** Созвоны, начавшиеся в этот день */
  getMeetingsByDay(date: string): Meeting[] {
    const { start, end } = localDayBounds(date)
    const rows = this.db
      .prepare('SELECT * FROM meetings WHERE ts_start >= ? AND ts_start <= ? ORDER BY ts_start ASC')
      .all(start, end) as RawMeetingRow[]
    return rows.map(rowToMeeting)
  }
}
