import type { Meeting } from './types'

/**
 * Разрыв, который считаем тем же созвоном.
 *
 * Для Meet сигнала может не быть долго: вкладка живёт в браузере, а виден
 * только заголовок активной вкладки. 20 минут — тот же допуск, что у движка.
 */
const MERGE_GAP_MS = 20 * 60 * 1000

/**
 * Код встречи — то, что делает две ссылки одним созвоном.
 * Один и тот же звонок приходит как `meet.google.com/cqu-vfcz-ftv` и
 * `meet.google.com/meet/cqu-vfcz-ftv`, ещё и с разным authuser (%40 против @).
 */
/** Код комнаты Meet из ссылки; null — ссылки нет (детект по заголовку, хаддл) */
export function meetingCode(meeting: Meeting): string | null {
  if (!meeting.url) return null
  const match = meeting.url.match(/meet\.google\.com\/(?:meet\/)?([a-z0-9-]{6,})/i)
  return match ? match[1].toLowerCase() : null
}

export function meetingKey(meeting: Meeting): string {
  const code = meetingCode(meeting)
  return `${meeting.source ?? ''}:${code ?? 'unknown'}`
}

/**
 * Один и тот же звонок?
 *
 * Коды сравниваем, когда они есть у обоих: разные комнаты — разные звонки.
 * Если у одного интервала кода нет (Meet поймали по заголовку вкладки), пары
 * сравнивать нечем — тогда смотрим на источник: две части одного Meet или два
 * хаддла склеиваем, а Meet и Slack — нет.
 */
export function sameCall(a: Meeting, b: Meeting): boolean {
  const codeA = meetingCode(a)
  const codeB = meetingCode(b)
  if (codeA && codeB) return codeA === codeB
  return (a.source ?? '') === (b.source ?? '')
}

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

    if (last && sameCall(last, meeting)) {
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
