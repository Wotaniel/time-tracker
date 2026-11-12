import { app, shell, systemPreferences } from 'electron'
import { execFileSync } from 'child_process'
import { EventEmitter } from 'events'
import { resolve } from 'path'
import type { TrackingHealthStatus } from '../shared/types'
import { log } from './safe-log'

/**
 * Почему трекер не пишет данные — и что с этим делать.
 *
 * Два независимых способа сломаться, которые выглядят одинаково (приложение
 * работает, лента пустая):
 *
 * 1. Нет разрешения macOS «Универсальный доступ» — active-win не может прочитать
 *    активное окно. Раньше приложение ждало его в setInterval без таймаута, без
 *    UI и без лога.
 *
 * 2. Подпись бандла не проходит проверку. macOS сопоставляет приложение с
 *    записью в TCC по подписи; один посторонний xattr (FinderInfo, а также
 *    fileprovider.fpfs#P от iCloud Drive) ломает печать — и разрешение из
 *    Системных настроек не применяется, сколько тумблер ни переключай.
 *    Причина в том, что приложение запущено из папки под синхронизацией:
 *    синхронизация возвращает xattr на бандл через секунды после сборки.
 *    Поэтому запускать нужно копию из /Applications (npm run install:mac
 *    собирает и ставит её).
 */

const ACCESSIBILITY_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'

/** Как часто проверяем, не включили ли разрешение */
const POLL_INTERVAL_MS = 2000

/** Как часто напоминаем в лог, пока разрешения нет */
const REMIND_INTERVAL_MS = 60_000

/** Папки, которые iCloud Drive синхронизирует целиком — бандл там не живёт */
const SYNCED_PATH_PATTERNS = [/\/Documents\//, /\/Desktop\//, /\/Mobile Documents\//]

interface BundleIntegrity {
  ok: boolean
  bundlePath: string | null
}

/**
 * Проверяет, сходится ли печать подписи собственного бандла.
 * Без --strict codesign принимает бандл с посторонними xattr — именно поэтому
 * сборка выглядела зелёной, а разрешения на машине не работали.
 */
function checkBundleIntegrity(): BundleIntegrity {
  if (!app.isPackaged) return { ok: true, bundlePath: null }

  // app.asar → Resources → Contents → CarpeDiem.app
  const bundlePath = resolve(app.getAppPath(), '..', '..', '..')

  try {
    execFileSync('/usr/bin/codesign', ['--verify', '--strict', bundlePath], { stdio: 'pipe' })
    return { ok: true, bundlePath }
  } catch (err) {
    const detail = (err as { stderr?: Buffer }).stderr?.toString().trim() ?? String(err)
    log.error(`[Integrity] Подпись бандла не проходит проверку: ${detail}`)
    log.error(`[Integrity] Бандл запущен из ${bundlePath}`)
    if (SYNCED_PATH_PATTERNS.some((re) => re.test(bundlePath))) {
      log.error(
        '[Integrity] Папка синхронизируется (iCloud Drive), и синхронизация вернула xattr на бандл. ' +
          'macOS не сопоставит приложение с записью в TCC: разрешение Accessibility не применится. ' +
          'Запускайте копию из /Applications (npm run install:mac).'
      )
    }
    return { ok: false, bundlePath }
  }
}

export class TrackingHealth extends EventEmitter {
  private granted: boolean
  private integrity: BundleIntegrity
  private pollTimer: NodeJS.Timeout | null = null
  private waitingSince = 0
  private lastReminder = 0

  constructor() {
    super()
    this.integrity = checkBundleIntegrity()
    this.granted = this.readPermission()
    if (!this.integrity.ok && this.granted) {
      // Разрешение ещё работает, но следующий перезапуск может его потерять
      log.warn('[Integrity] Разрешение пока действует, но подпись бандла битая — переустановите приложение')
    }
  }

  getStatus(): TrackingHealthStatus {
    return {
      tracking: this.granted,
      blockedBy: this.granted ? null : this.integrity.ok ? 'accessibility' : 'bundle-integrity',
      bundlePath: this.integrity.ok ? null : this.integrity.bundlePath
    }
  }

  /**
   * Запускает трекер, если разрешение уже выдано. Иначе один раз показывает
   * системный диалог и ждёт: состояние видно в окне и в меню трея.
   */
  ensure(onGranted: () => void): void {
    if (this.granted) {
      log.info('[Health] Разрешение выдано — трекинг запускается')
      onGranted()
      return
    }

    log.warn(
      '[Health] Трекинг не запущен: нет разрешения «Универсальный доступ». Данные не пишутся. ' +
        'Системные настройки → Конфиденциальность и безопасность → Универсальный доступ'
    )

    // prompt=true — системный диалог показываем ровно один раз
    try {
      systemPreferences.isTrustedAccessibilityClient(true)
    } catch (err) {
      log.error('[Health] Не удалось показать системный диалог:', err)
    }

    this.waitingSince = Date.now()
    this.lastReminder = Date.now()

    this.pollTimer = setInterval(() => this.poll(onGranted), POLL_INTERVAL_MS)
  }

  /** Открывает панель «Универсальный доступ» в Системных настройках */
  openAccessibilitySettings(): void {
    void shell.openExternal(ACCESSIBILITY_SETTINGS_URL)
  }

  dispose(): void {
    this.stopPolling()
    this.removeAllListeners()
  }

  private poll(onGranted: () => void): void {
    if (this.readPermission()) {
      const waitedSec = Math.round((Date.now() - this.waitingSince) / 1000)
      this.granted = true
      this.stopPolling()
      log.info(`[Health] Разрешение выдано через ${waitedSec} с — запускаю трекер`)
      this.emit('changed', this.getStatus())
      onGranted()
      return
    }

    // Молчаливое ожидание — то, из-за чего поломку не было видно. Напоминаем.
    if (Date.now() - this.lastReminder >= REMIND_INTERVAL_MS) {
      this.lastReminder = Date.now()
      const waitedSec = Math.round((Date.now() - this.waitingSince) / 1000)
      log.warn(`[Health] Всё ещё нет разрешения (${waitedSec} с) — трекинг не пишет данные`)
      this.emit('changed', this.getStatus())
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private readPermission(): boolean {
    if (process.platform !== 'darwin') return true
    try {
      return systemPreferences.isTrustedAccessibilityClient(false)
    } catch (err) {
      log.error('[Health] Не удалось проверить разрешение:', err)
      return false
    }
  }
}
