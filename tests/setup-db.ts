import Database from 'better-sqlite3'
import { resolve } from 'path'
import { runMigrations } from '../src/main/db/migrations'
import { extractDomainFromUrl, extractTaskKey } from '../src/main/db/helpers'

/** Миграции берём из src: в тестах нет ни out/, ни resources/ */
export const MIGRATIONS_DIR = resolve(__dirname, '../src/main/migrations')

/**
 * In-memory база со схемой и JS-функциями, которые регистрирует DatabaseManager.
 * DatabaseManager не используем: он тянет electron.app, а тесты идут под ELECTRON_RUN_AS_NODE.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')

  db.function('extractTaskKey', (text: string | null): string | null => extractTaskKey(text))
  db.function('extractDomainFromUrl', (url: string | null): string | null =>
    extractDomainFromUrl(url ?? '')
  )

  runMigrations(db, MIGRATIONS_DIR)
  return db
}

/** Локальная дата N дней назад в формате YYYY-MM-DD */
export function dayOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** ISO-момент: N дней назад, в указанный час локального времени */
export function at(days: number, hours: number, minutes = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hours, minutes, 0, 0)
  return d.toISOString()
}
