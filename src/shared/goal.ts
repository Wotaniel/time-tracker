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
