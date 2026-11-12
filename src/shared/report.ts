/**
 * Текстовый отчёт за период — то, что не стыдно скопировать в мессенджер.
 *
 * Собирается из готовых чисел, а не из базы: формат можно покрыть тестами,
 * а main только поставляет данные.
 */

import { reachedTier } from './goal'

export interface PeriodReportInput {
  from: string
  to: string
  activeSeconds: number
  workSeconds: number
  meetingSeconds: number
  afkSeconds: number
  /** Недельная норма, 0 — выключена */
  weekGoalSeconds: number
  /** Дневной порог для серии, 0 — не считать */
  dayGoalSeconds: number
  /** Рабочее время по дням — для серии */
  workByDay: { date: string; seconds: number }[]
  topApps: { appName: string; totalTime: number }[]
  tasks: { taskKey: string; seconds: number }[]
}

/** «5ч 12м», «42м», «30с» — компактно и без нулей */
export function humanDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}с`

  const hours = Math.floor(total / 3600)
  const minutes = Math.round((total % 3600) / 60)
  // 59.6 мин округлилось бы в «60м» — поднимаем в час
  if (minutes === 60) return `${hours + 1}ч`
  if (hours > 0) return minutes > 0 ? `${hours}ч ${minutes}м` : `${hours}ч`
  return `${minutes}м`
}

/** «3 дня», «5 дней», «1 день» */
export function pluralDays(count: number): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня'
  return 'дней'
}

/** Серия дней подряд, где выполнена цель; незакрытый последний день не рвёт серию */
export function streakDays(workByDay: { seconds: number }[], goalSeconds: number): number {
  if (goalSeconds <= 0) return 0
  let count = 0
  for (let i = workByDay.length - 1; i >= 0; i--) {
    const met = workByDay[i].seconds >= goalSeconds
    if (met) count++
    else if (i === workByDay.length - 1) continue
    else break
  }
  return count
}

export function buildPeriodReport(input: PeriodReportInput): string {
  const lines: string[] = []

  lines.push(`Неделя ${input.from} — ${input.to}`)
  lines.push(
    `Активность ${humanDuration(input.activeSeconds)} · работа ${humanDuration(
      input.workSeconds
    )} · созвоны ${humanDuration(input.meetingSeconds)} · AFK ${humanDuration(input.afkSeconds)}`
  )
  lines.push('')

  if (input.weekGoalSeconds > 0) {
    const percent = Math.round((input.workSeconds / input.weekGoalSeconds) * 100)
    const tier = reachedTier(input.workSeconds, input.weekGoalSeconds)
    const tierPart = tier ? `, уровень: ${tier.label}` : ''
    const streak = streakDays(input.workByDay, input.dayGoalSeconds)
    const streakPart = input.dayGoalSeconds > 0 ? `, серия ${streak} ${pluralDays(streak)}` : ''
    lines.push(
      `Цель недели ${humanDuration(input.weekGoalSeconds)}: ${humanDuration(
        input.workSeconds
      )} (${percent}%)${tierPart}${streakPart}`
    )
    lines.push('')
  }

  if (input.topApps.length > 0) {
    lines.push('Где время:')
    for (const app of input.topApps) {
      lines.push(`• ${app.appName} — ${humanDuration(app.totalTime)}`)
    }
    lines.push('')
  }

  if (input.tasks.length > 0) {
    lines.push('Задачи:')
    for (const task of input.tasks) {
      lines.push(`• ${task.taskKey} — ${humanDuration(task.seconds)}`)
    }
  }

  return lines.join('\n').trimEnd()
}
