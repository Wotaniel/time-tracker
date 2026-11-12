/**
 * Рассвет и закат по координатам — локальная арифметика, без сети.
 *
 * Алгоритм NOAA (упрощённый): точность около минуты для средних широт, чего
 * хватает для засечек на ленте дня. В Заполярье возвращаем null: солнце может
 * не встать или не сесть, и врать про «рассвет в 00:00» не нужно.
 */

export interface SunTimes {
  /** Локальные метки времени, мс. null — в этот день нет события (полярный день/ночь) */
  sunrise: number | null
  sunset: number | null
}

const RAD = Math.PI / 180
const OFFICIAL_ZENITH = 90.833

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000)
}

/** Минуты от полуночи UTC для события; null — событие не наступает */
export function sunTimesUtc(date: Date, latitude: number, longitude: number): SunTimes {
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear(date) - 1)

  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))

  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)

  const latRad = latitude * RAD
  const cosHourAngle =
    Math.cos(OFFICIAL_ZENITH * RAD) / (Math.cos(latRad) * Math.cos(declination)) -
    Math.tan(latRad) * Math.tan(declination)

  if (cosHourAngle > 1 || cosHourAngle < -1) {
    return { sunrise: null, sunset: null }
  }

  const hourAngle = Math.acos(cosHourAngle) / RAD

  const toMs = (minutes: number): number => Math.round(minutes * 60_000)
  return {
    sunrise: toMs(720 - 4 * (longitude + hourAngle) - eqTime),
    sunset: toMs(720 - 4 * (longitude - hourAngle) - eqTime)
  }
}

/** Локальные метки рассвета и заката для конкретной даты (YYYY-MM-DD) */
export function sunTimes(dateISO: string, latitude: number, longitude: number): SunTimes {
  const [year, month, day] = dateISO.split('-').map(Number)
  const localNoon = new Date(year, month - 1, day, 12, 0, 0, 0)

  const utc = sunTimesUtc(localNoon, latitude, longitude)
  const dayStartUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0)

  return {
    sunrise: utc.sunrise === null ? null : dayStartUtc + utc.sunrise,
    sunset: utc.sunset === null ? null : dayStartUtc + utc.sunset
  }
}
