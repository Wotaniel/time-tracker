import type { Meeting } from '../../../shared/types'

/** Разрыв, который считаем тем же созвоном (перезапуск приложения рвёт интервал) */
const MERGE_GAP_MS = 2 * 60 * 1000

/**
 * Склеивает соседние интервалы одного созвона.
 *
 * Зачем: детектор закрывает интервал по таймауту и при выходе из приложения.
 * Перезапуск посреди звонка превращал один разговор в два огрызка — на ленте
 * это выглядело как один тонкий штрих, а в счёте как два созвона.
 */
export function mergeMeetings(meetings: Meeting[]): Meeting[] {
  const sorted = [...meetings].sort((a, b) => a.tsStart.localeCompare(b.tsStart))
  const result: Meeting[] = []

  for (const meeting of sorted) {
    const last = result[result.length - 1]

    if (last && last.url === meeting.url) {
      const lastEnd = last.tsEnd ? new Date(last.tsEnd).getTime() : Date.now()
      const gap = new Date(meeting.tsStart).getTime() - lastEnd

      if (gap >= 0 && gap <= MERGE_GAP_MS) {
        const end =
          meeting.tsEnd && (!last.tsEnd || meeting.tsEnd > last.tsEnd) ? meeting.tsEnd : last.tsEnd
        result[result.length - 1] = { ...last, tsEnd: end }
        continue
      }
    }

    result.push({ ...meeting })
  }

  return result
}

/** Длительность созвона в секундах (открытый считается до сейчас) */
export function meetingSeconds(meeting: Meeting): number {
  const end = meeting.tsEnd ? new Date(meeting.tsEnd).getTime() : Date.now()
  return Math.max(0, Math.round((end - new Date(meeting.tsStart).getTime()) / 1000))
}
