import { describe, expect, it } from 'vitest'
import {
  detectMeeting,
  detectMeetingAmong,
  huddleParticipant,
  meetTitleFromTab
} from '../src/main/meeting-detect'

const win = (appName: string, windowTitle = '', url: string | null = null): ReturnType<typeof detectMeeting> =>
  detectMeeting({ appName, windowTitle, url })

describe('Google Meet', () => {
  it('ловит звонок по ссылке', () => {
    expect(win('Brave Browser', 'Meet - Design call', 'https://meet.google.com/meet/abc-defg-hij?authuser=0')?.source).toBe('Google Meet')
    expect(win('Chrome', 'Meet', 'https://meet.google.com/abc-defg-hij')?.source).toBe('Google Meet')
  })

  it('не считает созвоном главную страницу Meet', () => {
    expect(win('Brave Browser', 'Google Meet', 'https://meet.google.com/')).toBeNull()
    expect(win('Brave Browser', 'Google Meet', 'https://meet.google.com/home?authuser=a')).toBeNull()
  })

  it('ссылка сохраняется в интервале', () => {
    const detected = win('Brave Browser', '', 'https://meet.google.com/abc-defg-hij')
    expect(detected?.url).toContain('abc-defg-hij')
  })
})

describe('Slack huddle', () => {
  it('ловит хаддл по заголовку окна', () => {
    // Реальный заголовок из базы
    const detected = win('Slack', 'Huddle: @Dmitriy Akhromeyko - AdGuard Software Ltd - Slack 🎤')
    expect(detected?.source).toBe('Slack huddle')
  })

  it('не путает с превью хаддла', () => {
    expect(win('Slack', 'Slack - Huddle Preview')).toBeNull()
  })

  it('обычный чат Slack — не созвон', () => {
    expect(win('Slack', 'designers-only (Channel) - AdGuard Software Ltd - 39 new items')).toBeNull()
    expect(win('Slack', 'Threads - AdGuard Software Ltd - 40 new items - Slack [Main]')).toBeNull()
  })

  it('заголовок другого приложения с словом Huddle не считается', () => {
    expect(win('Figma', 'Huddle: design review')).toBeNull()
  })
})

describe('Zoom и Teams', () => {
  it('ловит окно встречи Zoom', () => {
    expect(win('zoom.us', 'Zoom Meeting')?.source).toBe('Zoom')
    expect(win('zoom.us', 'Zoom Webinar: Design')?.source).toBe('Zoom')
  })

  it('главное окно Zoom — не созвон', () => {
    expect(win('zoom.us', 'Zoom Workplace')).toBeNull()
  })

  it('ловит встречу Teams по явному признаку', () => {
    expect(win('Microsoft Teams', 'Meeting with Design | Microsoft Teams')?.source).toBe(
      'Microsoft Teams'
    )
  })

  it('чат Teams — не созвон', () => {
    expect(win('Microsoft Teams', 'Chat | AdGuard')).toBeNull()
  })

  it('тема встречи без слова meeting не считается: лучше пропустить, чем насчитать лишнее', () => {
    // Окно встречи Teams часто называется просто «Тема | Microsoft Teams», но от
    // чата его по заголовку не отличить. Осознанно выбираем пропуск: ложный
    // созвон испортит день, пропущенный — только добавит строчку в историю.
    expect(win('Microsoft Teams', 'Sprint review | Microsoft Teams')).toBeNull()
  })
})

describe('обычная работа', () => {
  it('не считает созвоном редактор и браузер', () => {
    expect(win('Figma', 'Design - Agile Board')).toBeNull()
    expect(win('Brave Browser', '[AG-61950] Проработать UX - Jira', 'https://jira.int.agrd.dev/browse/AG-61950')).toBeNull()
    expect(win('Code', 'tracking-engine.ts')).toBeNull()
  })
})

describe('созвон среди открытых окон', () => {
  const windows = [
    { appName: 'Figma', windowTitle: 'Design - Agile Board', url: null },
    { appName: 'Code', windowTitle: 'tracking-engine.ts', url: null },
    {
      appName: 'Slack',
      windowTitle: 'Huddle: @Dmitriy Akhromeyko - AdGuard Software Ltd - Slack 🎤',
      url: null
    },
    { appName: 'Brave Browser', windowTitle: 'Jira', url: 'https://jira.int.agrd.dev/browse/AG-1' }
  ]

  it('находит хаддл, даже когда он не первое окно и не в фокусе', () => {
    expect(detectMeetingAmong(windows)?.source).toBe('Slack huddle')
  })

  it('возвращает null, если созвонов нет', () => {
    expect(detectMeetingAmong(windows.slice(0, 2))).toBeNull()
    expect(detectMeetingAmong([])).toBeNull()
  })

  it('предпочитает первое найденное окно созвона', () => {
    const withZoom = [
      { appName: 'zoom.us', windowTitle: 'Zoom Meeting', url: null },
      ...windows
    ]
    expect(detectMeetingAmong(withZoom)?.source).toBe('Zoom')
  })
})

describe('название встречи', () => {
  it('Meet: берём из заголовка вкладки', () => {
    // Реальный заголовок из базы событий
    expect(meetTitleFromTab('Meet - Design call')).toBe('Design call')
    expect(meetTitleFromTab('Meet — Sprint review')).toBe('Sprint review')
    expect(meetTitleFromTab('Google Meet')).toBeNull()
  })

  it('Meet: название попадает в интервал', () => {
    const detected = detectMeeting({ appName: 'Brave Browser', windowTitle: 'Meet - Design call', url: null })
    expect(detected?.title).toBe('Design call')
  })

  it('Slack: участник хаддла без служебного хвоста', () => {
    // Реальный заголовок из базы
    expect(huddleParticipant('Huddle: @Dmitriy Akhromeyko - AdGuard Software Ltd - Slack 🎤')).toBe(
      'Dmitriy Akhromeyko'
    )
    expect(huddleParticipant('Huddle: @Maria Ivanova')).toBe('Maria Ivanova')
    expect(huddleParticipant('Slack - Huddle Preview')).toBeNull()
  })

  it('Slack: участник сохраняется в интервале, источник отдельно', () => {
    const detected = detectMeeting({
      appName: 'Slack',
      windowTitle: 'Huddle: @Dmitriy Akhromeyko - AdGuard Software Ltd - Slack 🎤',
      url: null
    })
    expect(detected?.source).toBe('Slack huddle')
    expect(detected?.title).toBe('Dmitriy Akhromeyko')
  })
})
