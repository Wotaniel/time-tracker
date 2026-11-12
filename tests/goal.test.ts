import { describe, expect, it } from 'vitest'
import { dailyGoalTiers, reachedDailyTier, reachedTier, weeklyGoalTiers } from '../src/shared/goal'

const H = 3600

describe('уровни недельной цели', () => {
  it('при норме 40 уровни 40 / 35 / 30', () => {
    expect(weeklyGoalTiers(40 * H).map((t) => t.seconds / H)).toEqual([40, 35, 30])
    expect(weeklyGoalTiers(40 * H).map((t) => t.label)).toEqual(['золото', 'серебро', 'бронза'])
  })

  it('выдаёт высший достигнутый уровень', () => {
    expect(reachedTier(41 * H, 40 * H)?.tier).toBe('gold')
    expect(reachedTier(36 * H, 40 * H)?.tier).toBe('silver')
    expect(reachedTier(30 * H, 40 * H)?.tier).toBe('bronze')
    expect(reachedTier(29 * H, 40 * H)).toBeNull()
  })

  it('без цели уровней нет', () => {
    expect(reachedTier(40 * H, 0)).toBeNull()
  })
})

describe('дневные уровни', () => {
  it('при норме 6 это 6 / 7 / 8', () => {
    expect(dailyGoalTiers(6 * H).map((t) => t.seconds / H)).toEqual([6, 7, 8])
    expect(dailyGoalTiers(6 * H).map((t) => t.label)).toEqual(['норм', 'круто', 'перебор'])
  })

  it('выдаёт высший достигнутый уровень', () => {
    expect(reachedDailyTier(5 * H, 6 * H)).toBeNull()
    expect(reachedDailyTier(6 * H, 6 * H)?.tier).toBe('fine')
    expect(reachedDailyTier(7.5 * H, 6 * H)?.tier).toBe('cool')
    expect(reachedDailyTier(9 * H, 6 * H)?.tier).toBe('over')
  })

  it('без нормы уровней нет', () => {
    expect(reachedDailyTier(8 * H, 0)).toBeNull()
  })
})
