import { describe, expect, it } from 'vitest'
import { createTestDb, at, dayOffset } from './setup-db'
import { EventRepository } from '../src/main/db/event-repository'
import { StatsRepository } from '../src/main/db/stats-repository'
import { TagRepository } from '../src/main/db/tag-repository'

const addEvent = (
  events: EventRepository,
  tsStart: string,
  tsEnd: string,
  appName = 'Figma',
  url: string | null = null
): void => {
  events.insertEvent({
    tsStart,
    tsEnd,
    duration: 0,
    appName,
    windowTitle: '',
    url,
    isAfk: false,
    isPrivate: false
  })
}

describe('getWorkByDay', () => {
  it('считает работу по приложению и по домену, дни без работы отдаёт нулями', () => {
    const db = createTestDb()
    const events = new EventRepository(db)
    const stats = new StatsRepository(db)
    const tags = new TagRepository(db)

    tags.setAppTag('app', 'Figma', 'work')
    tags.setAppTag('domain', 'jira.int.agrd.dev', 'work')

    addEvent(events, at(-2, 10), at(-2, 11)) // 1h Figma
    addEvent(events, at(-1, 10), at(-1, 10, 30), 'Brave Browser', 'https://jira.int.agrd.dev/browse/AG-1') // 30m домен

    const days = stats.getWorkByDay(dayOffset(-3), dayOffset(0))
    expect(days).toHaveLength(4)
    expect(days.find((d) => d.date === dayOffset(-2))?.seconds).toBe(3600)
    expect(days.find((d) => d.date === dayOffset(-1))?.seconds).toBe(1800)
    expect(days.find((d) => d.date === dayOffset(-3))?.seconds).toBe(0)
    db.close()
  })

  it('не считает работой приложение без тега', () => {
    const db = createTestDb()
    const events = new EventRepository(db)
    const stats = new StatsRepository(db)

    addEvent(events, at(0, 10), at(0, 11), 'Telegram')
    const days = stats.getWorkByDay(dayOffset(0), dayOffset(0))
    expect(days[0].seconds).toBe(0)
    db.close()
  })
})
