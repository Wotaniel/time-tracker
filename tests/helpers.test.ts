import { describe, expect, it } from 'vitest'
import {
  extractDomainFromUrl,
  extractTaskKey,
  formatLocalDate,
  localDayBounds
} from '../src/main/db/helpers'

describe('extractTaskKey', () => {
  it('достаёт ключ Jira из заголовка окна', () => {
    expect(extractTaskKey('[AG-61950] Проработать UX — Jira')).toBe('AG-61950')
  })

  it('достаёт ключ из URL', () => {
    expect(extractTaskKey('https://jira.int.agrd.dev/browse/ADG-1315')).toBe('ADG-1315')
  })

  it('не находит ключ, когда его нет', () => {
    expect(extractTaskKey('Figma Review Dashboard')).toBeNull()
  })

  it('не считает ключом случайные буквы с цифрами', () => {
    expect(extractTaskKey('H264')).toBeNull()
  })
})

describe('extractDomainFromUrl', () => {
  it('снимает www и путь', () => {
    expect(extractDomainFromUrl('https://www.figma.com/file/abc')).toBe('figma.com')
  })

  it('оставляет порт у localhost', () => {
    expect(extractDomainFromUrl('http://localhost:3001/app')).toBe('localhost:3001')
  })

  it('возвращает null для пустого значения', () => {
    expect(extractDomainFromUrl('')).toBeNull()
  })

  it('file:// не считается доменом', () => {
    expect(extractDomainFromUrl('file:///Users/me/page.html')).toBeNull()
    expect(extractDomainFromUrl('about:blank')).toBeNull()
  })

  it('разбирает домен без схемы', () => {
    expect(extractDomainFromUrl('jira.int.agrd.dev/browse/AG-1')).toBe('jira.int.agrd.dev')
  })
})

describe('localDayBounds', () => {
  it('границы дня — локальная полночь и локальный конец дня', () => {
    const { start, end } = localDayBounds('2026-11-12')
    expect(new Date(start).getHours()).toBe(0)
    expect(new Date(start).getMinutes()).toBe(0)
    expect(new Date(end).getHours()).toBe(23)
    expect(new Date(end).getMinutes()).toBe(59)
    expect(new Date(start).getDate()).toBe(12)
  })

  it('день длится почти 24 часа', () => {
    const { start, end } = localDayBounds('2026-11-12')
    const hours = (new Date(end).getTime() - new Date(start).getTime()) / 36e5
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThan(24)
  })
})

describe('formatLocalDate', () => {
  it('не сдвигает дату в UTC-минус', () => {
    // 00:30 локального времени — в UTC это ещё вчера
    const local = new Date(2026, 10, 12, 0, 30)
    expect(formatLocalDate(local)).toBe('2026-11-12')
  })
})
