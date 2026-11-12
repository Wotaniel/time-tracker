import { describe, expect, it } from 'vitest'
import { createTestDb, MIGRATIONS_DIR } from './setup-db'
import { runMigrations } from '../src/main/db/migrations'
import { readdirSync } from 'fs'

describe('раннер миграций', () => {
  it('создаёт все таблицы и записывает версии', () => {
    const db = createTestDb()
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'))
    const applied = db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]

    expect(applied.length).toBe(files.length)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toContain('events')
    expect(tables).toContain('meetings')
    expect(tables).toContain('app_tags')
    db.close()
  })

  it('повторный запуск ничего не делает', () => {
    const db = createTestDb()
    const before = db.prepare('SELECT count(*) c FROM schema_migrations').get() as { c: number }
    runMigrations(db, MIGRATIONS_DIR)
    const after = db.prepare('SELECT count(*) c FROM schema_migrations').get() as { c: number }
    expect(after.c).toBe(before.c)
    db.close()
  })

  it('не оставляет дублей правил (миграция 009)', () => {
    const db = createTestDb()
    const row = db
      .prepare(
        `SELECT count(*) AS total,
                count(DISTINCT category_id || '|' || field || '|' || match_type || '|' || value) AS uniqueRules
         FROM category_rules`
      )
      .get() as { total: number; uniqueRules: number }
    expect(row.total).toBe(row.uniqueRules)
    db.close()
  })

  it('переносит события Google Meet в созвоны (миграция 008)', () => {
    const db = createTestDb()
    const events = db.prepare("SELECT count(*) c FROM events WHERE app_name = 'Google Meet'").get() as {
      c: number
    }
    expect(events.c).toBe(0)
    db.close()
  })
})
