import { describe, expect, it } from 'vitest'
import { sunTimes } from '../src/shared/sun'

/** «ЧЧ:ММ» в локальной зоне машины — тесты идут в MSK (UTC+3) */
function hhmm(ms: number | null): string | null {
  if (ms === null) return null
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const MOSCOW = { lat: 55.75, lon: 37.62 }

describe('рассвет и закат', () => {
  it('Москва, солнцестояние: около 03:44 и 21:18', () => {
    const { sunrise, sunset } = sunTimes('2026-06-21', MOSCOW.lat, MOSCOW.lon)
    expect(hhmm(sunrise)).not.toBeNull()
    // Допуск 10 минут: алгоритм упрощённый
    const toMin = (v: string): number => Number(v.slice(0, 2)) * 60 + Number(v.slice(3))
    expect(Math.abs(toMin(hhmm(sunrise)!) - (3 * 60 + 44))).toBeLessThan(10)
    expect(Math.abs(toMin(hhmm(sunset)!) - (21 * 60 + 18))).toBeLessThan(10)
  })

  it('Москва, декабрь: короткий день, около 09:00 и 16:00', () => {
    const { sunrise, sunset } = sunTimes('2026-12-21', MOSCOW.lat, MOSCOW.lon)
    const toMin = (v: string): number => Number(v.slice(0, 2)) * 60 + Number(v.slice(3))
    expect(Math.abs(toMin(hhmm(sunrise)!) - (9 * 60 + 0))).toBeLessThan(15)
    expect(Math.abs(toMin(hhmm(sunset)!) - (16 * 60 + 0))).toBeLessThan(15)
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
