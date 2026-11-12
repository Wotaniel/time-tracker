import { describe, expect, it } from 'vitest'
import { reachedTier, weeklyGoalTiers } from '../src/shared/goal'

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
