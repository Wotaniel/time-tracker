/**
 * Рабочая цель: недельная норма и три уровня.
 *
 * Норма — 40 часов в неделю (пятидневка). Уровни считаются от неё: золото —
 * сама норма, серебро — на 5 часов меньше, бронза — на 10. При норме 40 это
 * ровно 40 / 35 / 30.
 */

export type GoalTier = 'gold' | 'silver' | 'bronze' | 'none'

export interface GoalTierInfo {
  tier: GoalTier
  label: string
  seconds: number
}

export const WEEKLY_GOAL_HOURS = 40

/**
 * Дневные уровни: база — норма, +1 час — «круто», +2 — «перебор».
 * При норме 6 часов это ровно 6 / 7 / 8, как и просил Али.
 */
export type DailyTier = 'fine' | 'cool' | 'over' | 'none'

export interface DailyTierInfo {
  tier: DailyTier
  label: string
  seconds: number
}

export const DAILY_GOAL_HOURS = 6

export function dailyGoalTiers(baseSeconds: number): DailyTierInfo[] {
  return [
    { tier: 'fine', label: 'норм', seconds: baseSeconds },
    { tier: 'cool', label: 'круто', seconds: baseSeconds + 3600 },
    { tier: 'over', label: 'перебор', seconds: baseSeconds + 2 * 3600 }
  ]
}

/** Достигнутый дневной уровень: от высшего к низшему */
export function reachedDailyTier(workedSeconds: number, baseSeconds: number): DailyTierInfo | null {
  if (baseSeconds <= 0) return null
  return dailyGoalTiers(baseSeconds).reverse().find((t) => workedSeconds >= t.seconds) ?? null
}

export function weeklyGoalTiers(goalSeconds: number): GoalTierInfo[] {
  return [
    { tier: 'gold', label: 'золото', seconds: goalSeconds },
    { tier: 'silver', label: 'серебро', seconds: Math.max(0, goalSeconds - 5 * 3600) },
    { tier: 'bronze', label: 'бронза', seconds: Math.max(0, goalSeconds - 10 * 3600) }
  ]
}

/** Достигнутый уровень: от высшего к низшему */
export function reachedTier(workedSeconds: number, goalSeconds: number): GoalTierInfo | null {
  if (goalSeconds <= 0) return null
  return weeklyGoalTiers(goalSeconds).find((t) => workedSeconds >= t.seconds) ?? null
}
