import { describe, expect, it } from 'vitest'
import {
  buildPeriodReport,
  humanDuration,
  pluralDays,
  streakDays,
  type PeriodReportInput
} from '../src/shared/report'

const base: PeriodReportInput = {
  from: '2026-11-06',
  to: '2026-11-12',
  activeSeconds: 32 * 3600 + 10 * 60,
  workSeconds: 27 * 3600 + 5 * 60,
  meetingSeconds: 4 * 3600 + 20 * 60,
  afkSeconds: 5 * 3600,
  weekGoalSeconds: 0,
  dayGoalSeconds: 0,
  workByDay: [],
  topApps: [],
  tasks: []
}

describe('humanDuration', () => {
  it('часы и минуты', () => {
    expect(humanDuration(5 * 3600 + 12 * 60)).toBe('5ч 12м')
    expect(humanDuration(42 * 60)).toBe('42м')
    expect(humanDuration(30)).toBe('30с')
    expect(humanDuration(2 * 3600)).toBe('2ч')
  })
})

describe('pluralDays', () => {
  it('склоняет', () => {
    expect(pluralDays(1)).toBe('день')
    expect(pluralDays(3)).toBe('дня')
    expect(pluralDays(5)).toBe('дней')
    expect(pluralDays(11)).toBe('дней')
    expect(pluralDays(21)).toBe('день')
  })
})

describe('streakDays', () => {
  const goal = 6 * 3600

  it('считает подряд до первого провала', () => {
    expect(
      streakDays([{ seconds: goal }, { seconds: 0 }, { seconds: goal }, { seconds: goal }], goal)
    ).toBe(2)
  })

  it('не рвёт серию из-за незакрытого сегодня', () => {
    expect(streakDays([{ seconds: goal }, { seconds: goal }, { seconds: 600 }], goal)).toBe(2)
  })

  it('без цели серии нет', () => {
    expect(streakDays([{ seconds: 10 * 3600 }], 0)).toBe(0)
  })
})

describe('buildPeriodReport', () => {
  it('без цели и данных не печатает пустые блоки', () => {
    const text = buildPeriodReport(base)
    expect(text).toContain('Неделя 2026-11-06 — 2026-11-12')
    expect(text).toContain('Активность 32ч 10м · работа 27ч 5м')
    expect(text).not.toContain('Цель')
    expect(text).not.toContain('Где время')
    expect(text).not.toContain('Задачи')
  })

  it('печатает недельную цель, уровень и серию', () => {
    const text = buildPeriodReport({
      ...base,
      weekGoalSeconds: 40 * 3600,
      dayGoalSeconds: 6 * 3600,
      workSeconds: 36 * 3600,
      workByDay: [
        { date: '2026-11-11', seconds: 7 * 3600 },
        { date: '2026-11-12', seconds: 6 * 3600 }
      ]
    })
    expect(text).toContain('Цель недели 40ч')
    expect(text).toContain('уровень: серебро')
    expect(text).toContain('серия 2 дня')
    expect(text).toMatch(/\(\d+%\)/)
  })

  it('без достигнутого уровня не печатает его', () => {
    const text = buildPeriodReport({
      ...base,
      weekGoalSeconds: 40 * 3600,
      workSeconds: 10 * 3600,
      workByDay: [{ date: '2026-11-12', seconds: 10 * 3600 }]
    })
    expect(text).not.toContain('уровень')
  })

  it('печатает топ приложений и задачи', () => {
    const text = buildPeriodReport({
      ...base,
      topApps: [{ appName: 'Figma', totalTime: 9 * 3600 + 10 * 60 }],
      tasks: [{ taskKey: 'AG-61950', seconds: 80 * 60 }]
    })
    expect(text).toContain('• Figma — 9ч 10м')
    expect(text).toContain('• AG-61950 — 1ч 20м')
  })
})
