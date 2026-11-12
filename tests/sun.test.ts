import { describe, expect, it } from 'vitest'
import { sunTimes } from '../src/shared/sun'

/**
 * «ЧЧ:ММ» в UTC. Раньше форматировали локально — тесты проходили на машине
 * в MSK и падали на CI-раннере в UTC (расхождение ровно на 3 часа).
 */
function hhmm(ms: number | null): string | null {
  if (ms === null) return null
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

const toMin = (v: string): number => Number(v.slice(0, 2)) * 60 + Number(v.slice(3))

const MOSCOW = { lat: 55.75, lon: 37.62 }

describe('рассвет и закат', () => {
  it('Москва, солнцестояние: 00:44 и 18:18 UTC (03:44 и 21:18 МСК)', () => {
    const { sunrise, sunset } = sunTimes('2026-06-21', MOSCOW.lat, MOSCOW.lon)
    expect(hhmm(sunrise)).not.toBeNull()
    // Допуск 10 минут: алгоритм упрощённый
    expect(Math.abs(toMin(hhmm(sunrise)!) - (0 * 60 + 44))).toBeLessThan(10)
    expect(Math.abs(toMin(hhmm(sunset)!) - (18 * 60 + 18))).toBeLessThan(10)
  })

  it('Москва, декабрь: короткий день, 06:00 и 13:00 UTC (09:00 и 16:00 МСК)', () => {
    const { sunrise, sunset } = sunTimes('2026-12-21', MOSCOW.lat, MOSCOW.lon)
    expect(Math.abs(toMin(hhmm(sunrise)!) - (6 * 60 + 0))).toBeLessThan(15)
    expect(Math.abs(toMin(hhmm(sunset)!) - (13 * 60 + 0))).toBeLessThan(15)
  })

  it('полярный день: события нет, а не полночь', () => {
    const { sunrise, sunset } = sunTimes('2026-06-21', 78.2, 15.6) // Лонгйир
    expect(sunrise).toBeNull()
    expect(sunset).toBeNull()
  })

  it('рассвет раньше заката', () => {
    const { sunrise, sunset } = sunTimes('2026-03-01', MOSCOW.lat, MOSCOW.lon)
    expect(sunrise).not.toBeNull()
    expect((sunrise as number) < (sunset as number)).toBe(true)
  })
})
