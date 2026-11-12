import type { WindowEntry } from '../../../shared/types'

/** Браузеры — для них группируем вкладки по домену вместо имени окна */
const BROWSER_APPS = new Set([
  'Chrome',
  'Google Chrome',
  'Chromium',
  'Brave Browser',
  'Safari',
  'Firefox',
  'Arc',
  'Microsoft Edge',
  'Edge',
  'Vivaldi',
  'Opera',
  'Thorium'
])

export function isBrowser(appName: string): boolean {
  return BROWSER_APPS.has(appName)
}

/**
 * Извлекает домен из URL (без www.).
 * Для localhost и IP-адресов включает порт: localhost:3001, 127.0.0.1:8080
 */
export function extractDomain(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'localhost' || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      return u.port ? `${host}:${u.port}` : host
    }
    return host
  } catch {
    const match = url.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9.-]+\.[a-z]{2,})/i)
    return match ? match[1] : null
  }
}

/** Группировка вкладок браузера по домену */
export interface DomainGroup {
  domain: string
  totalTime: number
  tabs: WindowEntry[]
}

export function groupByDomain(windows: WindowEntry[]): DomainGroup[] {
  const domainMap = new Map<string, DomainGroup>()

  for (const win of windows) {
    const domain = extractDomain(win.url) ?? '(no URL)'
    let group = domainMap.get(domain)
    if (!group) {
      group = { domain, totalTime: 0, tabs: [] }
      domainMap.set(domain, group)
    }
    group.totalTime += win.totalTime
    group.tabs.push(win)
  }

  return Array.from(domainMap.values()).sort((a, b) => b.totalTime - a.totalTime)
}
