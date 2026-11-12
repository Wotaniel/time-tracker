import { describe, expect, it } from 'vitest'
import { createTestDb, at, dayOffset } from './setup-db'
import { EventRepository } from '../src/main/db/event-repository'
import { StatsRepository } from '../src/main/db/stats-repository'
import { TagRepository } from '../src/main/db/tag-repository'
import { MeetingRepository } from '../src/main/db/meeting-repository'

function insertEvent(
  repo: EventRepository,
  overrides: Partial<Parameters<EventRepository['insertEvent']>[0]> = {}
): number {
  const now = at(0, 12)
  return repo.insertEvent({
    tsStart: now,
    tsEnd: now,
    duration: 60,
    appName: 'Figma',
    windowTitle: 'Design',
    isAfk: false,
    isPrivate: false,
    ...overrides
  })
}

describe('getDailyStats', () => {
  it('возвращает ровно запрошенное число дней', () => {
    const db = createTestDb()
    const stats = new StatsRepository(db)
    const rows = stats.getDailyStats(7)
    expect(rows.length).toBe(7)
    db.close()
  })

  it('видит события из начала диапазона, а не только сегодняшние', () => {
    // Регрессия: диапазон считался из days, но границы брались от сегодня,
    // поэтому при days > 1 в ответе был один заполненный день.
    const db = createTestDb()
    const events = new EventRepository(db)
    const stats = new StatsRepository(db)

    insertEvent(events, { tsStart: at(-5, 10), tsEnd: at(-5, 10, 10), duration: 600 })

    const rows = stats.getDailyStats(7)
    const day = rows.find((r) => r.date === dayOffset(-5))
    expect(day?.totalActive).toBe(600)
    db.close()
  })

  it('не смешивает дни при группировке', () => {
    const db = createTestDb()
    const events = new EventRepository(db)
    const stats = new StatsRepository(db)

    insertEvent(events, { tsStart: at(-2, 9), tsEnd: at(-2, 9, 5), duration: 300 })
    insertEvent(events, { tsStart: at(-1, 9), tsEnd: at(-1, 9, 15), duration: 900 })

    const rows = stats.getDailyStats(3)
    expect(rows.find((r) => r.date === dayOffset(-2))?.totalActive).toBe(300)
    expect(rows.find((r) => r.date === dayOffset(-1))?.totalActive).toBe(900)
    db.close()
  })
})

describe('getDayCoverage', () => {
  it('раскладывает день на активность, AFK и простои', () => {
    const db = createTestDb()
    const events = new EventRepository(db)

    insertEvent(events, { tsStart: at(0, 10), tsEnd: at(0, 11), duration: 3600 })
    insertEvent(events, {
      tsStart: at(0, 12),
      tsEnd: at(0, 12, 30),
      duration: 1800,
      appName: 'AFK',
      isAfk: true
    })
    insertEvent(events, { tsStart: at(0, 14), tsEnd: at(0, 14, 30), duration: 1800 })

    const coverage = events.getDayCoverage(dayOffset(0))
    expect(coverage.active).toBe(3600 + 1800)
    expect(coverage.afk).toBe(1800)
    // От 10:00 до 14:30 = 4.5 ч = 16200 с
    expect(coverage.span).toBe(16200)
    expect(coverage.uncovered).toBe(16200 - 5400 - 1800)
    db.close()
  })

  it('для пустого дня возвращает нули, а не NaN', () => {
    const db = createTestDb()
    const events = new EventRepository(db)
    const coverage = events.getDayCoverage('2020-01-01')
    expect(coverage).toEqual({ active: 0, afk: 0, uncovered: 0, span: 0 })
    db.close()
  })
})

describe('getUntagged', () => {
  it('находит приложение без тега и домен без тега', () => {
    const db = createTestDb()
    const events = new EventRepository(db)
    const stats = new StatsRepository(db)

    insertEvent(events, { appName: 'OpenChamber', duration: 120 })
    insertEvent(events, {
      appName: 'Brave Browser',
      url: 'https://youtube.com/watch',
      duration: 300
    })

    const rows = stats.getUntagged(dayOffset(0))
    const app = rows.find((r) => r.targetType === 'app' && r.targetKey === 'OpenChamber')
    const domain = rows.find((r) => r.targetType === 'domain' && r.targetKey === 'youtube.com')
    expect(app?.seconds).toBe(120)
    expect(domain?.seconds).toBe(300)
    db.close()
  })

  it('исключает размеченный домен и размеченное приложение', () => {
    const db = createTestDb()
    const events = new EventRepository(db)
    const stats = new StatsRepository(db)
    const tags = new TagRepository(db)

    tags.setAppTag('domain', 'youtube.com', 'distracting')
    tags.setAppTag('app', 'OpenChamber', 'neutral')

    insertEvent(events, { appName: 'OpenChamber', duration: 120 })
    insertEvent(events, {
      appName: 'Brave Browser',
      url: 'https://youtube.com/watch',
      duration: 300
    })

    const rows = stats.getUntagged(dayOffset(0))
    expect(rows.some((r) => r.targetKey === 'youtube.com')).toBe(false)
    expect(rows.some((r) => r.targetKey === 'OpenChamber')).toBe(false)
    db.close()
  })
})

describe('созвоны', () => {
  it('находит созвоны, пересекающиеся с диапазоном', () => {
    const db = createTestDb()
    const meetings = new MeetingRepository(db)

    meetings.startMeeting(at(-3, 10), 'https://meet.google.com/abc-defg-hij', 'Google Meet')
    meetings.startMeeting(at(0, 10), 'https://meet.google.com/klm-nopq-rst', 'Google Meet')

    const rows = meetings.getMeetingsByRange(dayOffset(-1), dayOffset(0))
    expect(rows.length).toBe(1)
    expect(rows[0].url).toContain('klm-nopq-rst')
    db.close()
  })

  it('созвон не попадает в события — иначе время считалось бы дважды', () => {
    const db = createTestDb()
    const meetings = new MeetingRepository(db)
    const events = new EventRepository(db)

    meetings.startMeeting(at(0, 10), 'https://meet.google.com/abc-defg-hij', 'Google Meet')

    const rows = events.getEventsByDay(dayOffset(0))
    expect(rows.length).toBe(0)
    db.close()
  })
})
