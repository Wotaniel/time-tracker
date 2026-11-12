/**
 * Определение созвона по активному окну.
 *
 * Раньше детект знал только Google Meet и только по URL. Созвон в Slack
 * (huddle), Zoom или Teams не замечался вовсе, хотя это тот же параллельный
 * разговор. Правила собраны здесь, а не в движке, чтобы их можно было покрыть
 * тестами: заголовки окон — хрупкая штука, и каждая новая формулировка должна
 * ловиться тестом, а не проверяться руками на живом созвоне.
 */

export type MeetingSource = 'Google Meet' | 'Zoom' | 'Microsoft Teams' | 'Slack huddle'

export interface WindowInfo {
  appName: string
  windowTitle: string
  url: string | null
}

export interface DetectedMeeting {
  source: MeetingSource
  /** Ссылка или код встречи, если есть */
  url: string | null
}

/**
 * Код встречи из ссылки Google Meet.
 * `meet.google.com/abc-defg-hij` и `meet.google.com/meet/abc-defg-hij` — созвон,
 * а `meet.google.com/` и `meet.google.com/home?...` — просто главная страница.
 */
function meetCode(url: string | null): string | null {
  if (!url) return null
  const match = url.match(/meet\.google\.com\/(?:meet\/)?([a-z0-9-]{6,})/i)
  if (!match) return null
  if (/^home$/i.test(match[1])) return null
  return match[1]
}

/** Slack: «Huddle: @someone - company - Slack 🎤». «Huddle Preview» — не созвон */
function isSlackHuddle(appName: string, title: string): boolean {
  if (!/^slack$/i.test(appName)) return false
  if (/huddle preview/i.test(title)) return false
  return /^huddle:/i.test(title.trim())
}

/** Zoom: приложение zoom.us и окно встречи */
function isZoomMeeting(appName: string, title: string): boolean {
  if (!/zoom/i.test(appName)) return false
  return /zoom\s+(meeting|webinar)/i.test(title)
}

/** Teams: окно встречи, а не обычный чат */
function isTeamsMeeting(appName: string, title: string): boolean {
  if (!/microsoft teams/i.test(appName)) return false
  return /(meeting|встреч)/i.test(title)
}

/**
 * Созвон среди списка открытых окон.
 *
 * Зачем: хаддл, Zoom или Teams живут отдельным окном. Пока мы смотрели только
 * активное, звонок «пропадал», стоило переключиться в Figma. Окно же видно
 * всё время: появилось — начали, закрылось (нажали «завершить») — закончили.
 */
export function detectMeetingAmong(windows: WindowInfo[]): DetectedMeeting | null {
  for (const win of windows) {
    const detected = detectMeeting(win)
    if (detected) return detected
  }
  return null
}

/**
 * Meet по заголовку вкладки.
 *
 * В списке открытых окон у браузера нет URL, поэтому звонок «пропадал», стоило
 * переключиться в Figma. Во время звонка вкладка называется «Meet - <тема>»,
 * а главная страница — «Google Meet», так что различие есть.
 */
function isMeetByTitle(title: string): boolean {
  return /^meet\s*[-–—:]/i.test(title.trim())
}

export function detectMeeting(win: WindowInfo): DetectedMeeting | null {
  const code = meetCode(win.url)
  if (code) {
    return { source: 'Google Meet', url: win.url }
  }

  if (isMeetByTitle(win.windowTitle)) {
    return { source: 'Google Meet', url: null }
  }

  if (isSlackHuddle(win.appName, win.windowTitle)) {
    return { source: 'Slack huddle', url: null }
  }

  if (isZoomMeeting(win.appName, win.windowTitle)) {
    return { source: 'Zoom', url: null }
  }

  if (isTeamsMeeting(win.appName, win.windowTitle)) {
    return { source: 'Microsoft Teams', url: null }
  }

  return null
}
