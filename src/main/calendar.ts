import { execFile } from 'child_process'
import { log } from './safe-log'

/**
 * Запланированные встречи из Calendar.app — локально, без сети.
 *
 * Calendar.app отвечает медленно: перебор календарей через AppleScript может
 * занять десятки секунд. Поэтому запуск с таймаутом, кэш на 10 минут и
 * отдельный признак «не удалось получить» — приложение не должно зависать
 * и молча ждать, как это было с active-win.
 */

export interface CalendarEvent {
  title: string
  /** ISO 8601 */
  start: string
  end: string
}

export type CalendarFailure = 'permission' | 'timeout' | 'error'

export interface CalendarDay {
  /** false — нет разрешения на автоматизацию или Calendar не ответил */
  available: boolean
  /** Почему не получилось: для подсказки в настройках */
  reason?: CalendarFailure
  events: CalendarEvent[]
}

const TIMEOUT_MS = 20_000
const CACHE_TTL_MS = 10 * 60_000
/**
 * После таймаута не долбим Calendar каждые 10 минут: перебор событий там
 * может идти минутами, и повторный запуск только плодит зависшие osascript.
 */
const FAILURE_TTL_MS = 60 * 60_000

const cache = new Map<string, { at: number; day: CalendarDay }>()

const SCRIPT = (dateISO: string): string => `
set d1 to date "${dateISO}"
set hours of d1 to 0
set minutes of d1 to 0
set seconds of d1 to 0
set d2 to d1 + 1 * days
set out to ""
tell application "Calendar"
  repeat with c in calendars
    try
      set evs to (every event of c whose start date ≥ d1 and start date < d2)
      repeat with e in evs
        set out to out & (summary of e) & "|" & ((start date of e) as «class isot» as string) & "|" & ((end date of e) as «class isot» as string) & linefeed
      end repeat
    end try
  end repeat
end tell
return out
`

function parse(output: string): CalendarEvent[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const [title, start, end] = line.split('|')
      if (!start || !end) return []
      return [{ title: title || '(без названия)', start, end }]
    })
}

export async function getCalendarDay(dateISO: string, force = false): Promise<CalendarDay> {
  const cached = cache.get(dateISO)
  if (cached && !force) {
    const ttl = cached.day.available ? CACHE_TTL_MS : FAILURE_TTL_MS
    if (Date.now() - cached.at < ttl) return cached.day
  }

  const day = await new Promise<CalendarDay>((resolve) => {
    execFile(
      '/usr/bin/osascript',
      ['-e', SCRIPT(dateISO)],
      { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          const stderr = (err as { stderr?: string }).stderr ?? ''
          const killed = (err as { killed?: boolean }).killed === true
          const reason: CalendarFailure = killed
            ? 'timeout'
            : /-1743|not authori[sz]ed/i.test(stderr)
              ? 'permission'
              : 'error'
          // Полный текст важен: -1743 значит «нет разрешения на автоматизацию»,
          // и это лечится одним тумблером, а не поиском бага
          log.warn(
            `[Calendar] не удалось прочитать календарь (${reason}):`,
            stderr.split('\n')[0] || err.message.split('\n')[0]
          )
          resolve({ available: false, reason, events: [] })
          return
        }
        resolve({ available: true, events: parse(stdout) })
      }
    )
  })

  cache.set(dateISO, { at: Date.now(), day })
  return day
}
