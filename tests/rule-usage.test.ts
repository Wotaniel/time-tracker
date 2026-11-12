import { describe, expect, it } from 'vitest'
import { createTestDb, at, dayOffset } from './setup-db'
import { CategoryRepository } from '../src/main/db/category-repository'
import { EventRepository } from '../src/main/db/event-repository'

const addEvent = (
  events: EventRepository,
  appName: string,
  seconds: number,
  title = ''
): void => {
  events.insertEvent({
    tsStart: at(0, 10),
    tsEnd: at(0, 10),
    duration: seconds,
    appName,
    windowTitle: title,
    isAfk: false,
    isPrivate: false
  })
}

describe('getRuleUsage', () => {
  it('считает, сколько раз правило сработало и сколько времени покрыло', () => {
    const db = createTestDb()
    const categories = new CategoryRepository(db)
    const events = new EventRepository(db)

    db.prepare('DELETE FROM category_rules').run()
    const rule = categories.upsertRule({
      categoryId: 1,
      field: 'app_name',
      matchType: 'contains',
      value: 'Figma'
    })

    addEvent(events, 'Figma', 600)
    addEvent(events, 'Figma', 300)
    addEvent(events, 'Slack', 120)

    const usage = categories.getRuleUsage(dayOffset(0))
    const forRule = usage.find((u) => u.ruleId === rule.id)
    expect(forRule?.matches).toBe(2)
    expect(forRule?.seconds).toBe(900)
    db.close()
  })

  it('учитывает только первое совпавшее правило', () => {
    const db = createTestDb()
    const categories = new CategoryRepository(db)
    const events = new EventRepository(db)

    db.prepare('DELETE FROM category_rules').run()
    const first = categories.upsertRule({
      categoryId: 1,
      field: 'app_name',
      matchType: 'contains',
      value: 'Fig'
    })
    const second = categories.upsertRule({
      categoryId: 2,
      field: 'app_name',
      matchType: 'contains',
      value: 'Figma'
    })

    addEvent(events, 'Figma', 600)

    const usage = categories.getRuleUsage(dayOffset(0))
    expect(usage.find((u) => u.ruleId === first.id)?.matches).toBe(1)
    expect(usage.find((u) => u.ruleId === second.id)).toBeUndefined()
    db.close()
  })

  it('не срабатывает на дни без событий', () => {
    const db = createTestDb()
    const categories = new CategoryRepository(db)
    expect(categories.getRuleUsage('2020-01-01')).toEqual([])
    db.close()
  })
})
