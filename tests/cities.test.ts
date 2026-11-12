import { describe, expect, it } from 'vitest'
import { CITIES, findCity } from '../src/shared/cities'

describe('города', () => {
  it('Москва и Дананг на месте с нужными смещениями', () => {
    expect(findCity('moscow')?.utcOffsetMinutes).toBe(180)
    expect(findCity('danang')?.utcOffsetMinutes).toBe(420)
  })

  it('неизвестный город не ломает приложение', () => {
    expect(findCity('atlantis')).toBeNull()
    expect(findCity(null)).toBeNull()
  })

  it('идентификаторы не повторяются', () => {
    const ids = new Set(CITIES.map((city) => city.id))
    expect(ids.size).toBe(CITIES.length)
  })
})
