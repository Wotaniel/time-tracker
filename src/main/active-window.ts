import { execFile } from 'child_process'
import { app } from 'electron'
import { join } from 'path'

/**
 * Чтение окон через нативный хелпер active-win.
 *
 * Свой запуск вместо пакетного, потому что пакет вызывает execFile без
 * таймаута: если хелпер завис (ждал разрешение, застрял в Accessibility),
 * процесс оставался жить, а setInterval плодил новые. Здесь таймаут убивает
 * дочерний процесс, и это же даёт доступ к списку ВСЕХ окон — без него созвон
 * виден только пока его окно в фокусе.
 */

export interface WindowInfo {
  title: string
  url?: string | null
  owner: { name: string; processId?: number; bundleId?: string }
}

/** Сколько ждём хелпер, прежде чем убить */
const HELPER_TIMEOUT_MS = 3000

let cachedHelperPath: string | null = null

function helperPath(): string {
  if (cachedHelperPath) return cachedHelperPath

  // В сборке app.getAppPath() → .../Resources/app.asar, а бинарник лежит рядом
  // в app.asar.unpacked (electron-builder распаковывает исполняемые файлы).
  const appPath = app.getAppPath()
  const base = appPath.endsWith('app.asar') ? appPath.replace(/app\.asar$/, 'app.asar.unpacked') : appPath

  cachedHelperPath = join(base, 'node_modules', 'active-win', 'main')
  return cachedHelperPath
}

function runHelper<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(
      helperPath(),
      args,
      { timeout: HELPER_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(err)
          return
        }
        try {
          resolve(JSON.parse(stdout) as T)
        } catch (parseError) {
          reject(parseError)
        }
      }
    )
  })
}

/** Активное окно прямо сейчас */
export function getActiveWindow(): Promise<WindowInfo> {
  return runHelper<WindowInfo>([])
}

/** Все открытые окна: нужны, чтобы видеть созвон в фоне */
export function getOpenWindows(): Promise<WindowInfo[]> {
  return runHelper<WindowInfo[]>(['--open-windows-list'])
}
