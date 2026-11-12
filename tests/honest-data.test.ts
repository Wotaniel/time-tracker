import { describe, expect, it } from 'vitest'
import { createTestDb, at, dayOffset } from './setup-db'
import { EventRepository } from '../src/main/db/event-repository'
import { StatsRepository } from '../src/main/db/stats-repository'
import { splitAcrossLocalDays } from '../src/main/db/helpers'
import { validateDate } from '../src/main/validation'

describe('splitAcrossLocalDays', () => {
  it('режет событие по полуночи', () => {
    const slices = splitAcrossLocalDays(at(-1, 23, 50), at(0, 0, 30))
    expect(slices).toHaveLength(2)
    expect(slices[0]).toEqual({ date: dayOffset(-1), seconds: 600 })
    expect(slices[1]).toEqual({ date: dayOffset(0), seconds: 1800 })
  })

  it('событие внутри дня не режется', () => {
    const slices = splitAcrossLocalDays(at(0, 10), at(0, 11))
    expect(slices).toHaveLength(1)
    expect(slices[0].seconds).toBe(3600)
  })
})

describe('событие через полночь', () => {
  const crossMidnight = (): ReturnType<typeof createTestDb> => {
    const db = createTestDb()
    const events = new EventRepository(db)
    events.insertEvent({
      tsStart: at(-1, 23, 50),
      tsEnd: at(0, 0, 30),
      duration: 2400,
      appName: 'Figma',
      windowTitle: 'Design',
      isAfk: false,
      isPrivate: false
    })
    return db
  }

  it('попадает в оба дня с обрезкой по границе', () => {
    const db = crossMidnight()
    const events = new EventRepository(db)

    const yesterday = events.getEventsByDay(dayOffset(-1))
    const today = events.getEventsByDay(dayOffset(0))

    expect(yesterday).toHaveLength(1)
    expect(yesterday[0].duration).toBe(600)
    expect(today).toHaveLength(1)
    expect(today[0].duration).toBe(1800)
    db.close()
  })

  it('дневная сводка считает только свою часть', () => {
    const db = crossMidnight()
    const events = new EventRepository(db)

    expect(events.getDaySummary(dayOffset(0))[0].totalTime).toBe(1800)
    expect(events.getDaySummary(dayOffset(-1))[0].totalTime).toBe(600)
    db.close()
  })

  it('график по дням раскладывает обе части', () => {
    const db = crossMidnight()
    const stats = new StatsRepository(db)

    const rows = stats.getDailyStats(2)
    expect(rows.find((r) => r.date === dayOffset(0))?.totalActive).toBe(1800)
    expect(rows.find((r) => r.date === dayOffset(-1))?.totalActive).toBe(600)
    db.close()
  })

  it('покрытие дня не выходит за сутки', () => {
    const db = createTestDb()
    const events = new EventRepository(db)
    events.insertEvent({
      tsStart: at(-1, 23, 50),
      tsEnd: at(0, 0, 30),
      duration: 2400,
      appName: 'Figma',
      windowTitle: 'Design',
      isAfk: false,
      isPrivate: false
    })

    expect(events.getDayCoverage(dayOffset(0)).active).toBe(1800)
    db.close()
  })
})

describe('проценты в topApps', () => {
  it('считаются от всего времени, а не от top-N', () => {
    const db = createTestDb()
    const events = new EventRepository(db)
    const stats = new StatsRepository(db)

    const ins = (appName: string, seconds: number): void => {
      events.insertEvent({
        tsStart: at(0, 10),
        tsEnd: at(0, 10),
        duration: seconds,
        appName,
        windowTitle: '',
        isAfk: false,
        isPrivate: false
      })
    }
    ins('Figma', 3000)
    ins('Slack', 1000)

    const top = stats.getTopApps(dayOffset(0), dayOffset(0), 1)
    expect(top).toHaveLength(1)
    expect(top[0].percentage).toBe(75) // а не 100, как было при знаменателе top-N
    db.close()
  })
})

describe('validateDate', () => {
  it('пропускает корректную дату', () => {
    expect(() => validateDate('2026-11-12')).not.toThrow()
  })

  it('отклоняет несуществующий день', () => {
    expect(() => validateDate('2026-13-99')).toThrow(/No such calendar day/)
    expect(() => validateDate('2026-02-30')).toThrow(/No such calendar day/)
  })

  it('отклоняет мусор вместо даты', () => {
    expect(() => validateDate('12.11.2026')).toThrow(/Invalid date format/)
  })
})
