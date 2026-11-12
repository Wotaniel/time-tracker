/**
 * Города для второй шкалы времени.
 *
 * Координаты нужны для рассвета и заката, смещение — для подписей второй шкалы.
 * Смещения фиксированные (без переходов на летнее время): Москва и Дананг его
 * не переводят, а ошибиться на час в подписи хуже, чем не показать город.
 * Список можно дополнять — это единственное место, где живут координаты.
 */

export interface City {
  id: string
  name: string
  lat: number
  lon: number
  /** Смещение от UTC в минутах */
  utcOffsetMinutes: number
}

export const CITIES: City[] = [
  { id: 'moscow', name: 'Москва', lat: 55.75, lon: 37.62, utcOffsetMinutes: 180 },
  { id: 'danang', name: 'Дананг', lat: 16.05, lon: 108.22, utcOffsetMinutes: 420 },
  { id: 'belgrade', name: 'Белград', lat: 44.79, lon: 20.45, utcOffsetMinutes: 60 },
  { id: 'yerevan', name: 'Ереван', lat: 40.18, lon: 44.51, utcOffsetMinutes: 240 },
  { id: 'tbilisi', name: 'Тбилиси', lat: 41.72, lon: 44.79, utcOffsetMinutes: 240 },
  { id: 'almaty', name: 'Алматы', lat: 43.24, lon: 76.89, utcOffsetMinutes: 300 },
  { id: 'dubai', name: 'Дубай', lat: 25.2, lon: 55.27, utcOffsetMinutes: 240 },
  { id: 'lisbon', name: 'Лиссабон', lat: 38.72, lon: -9.14, utcOffsetMinutes: 0 },
  { id: 'london', name: 'Лондон', lat: 51.51, lon: -0.13, utcOffsetMinutes: 0 },
  { id: 'newyork', name: 'Нью-Йорк', lat: 40.71, lon: -74.01, utcOffsetMinutes: -300 }
]

export function findCity(id: string | null | undefined): City | null {
  if (!id) return null
  return CITIES.find((city) => city.id === id) ?? null
}
