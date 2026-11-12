import { EventEmitter } from 'events'
import { app, systemPreferences } from 'electron'
import type { DatabaseManager } from './database'
import type { CurrentActivity } from '../shared/types'
import { log } from './safe-log'
import { detectMeeting, detectMeetingAmong, type DetectedMeeting } from './meeting-detect'
import { getActiveWindow, getOpenWindows, type WindowInfo } from './active-window'

/** Имена процесса трекера в dev-режиме — active-win может отдать 'Electron' */
const SELF_APP_NAMES = new Set(['Electron'])

/**
 * Активность самого трекера — её нельзя писать в БД.
 *
 * Признак по имени приложения ненадёжен: `app.getName()` на момент импорта этого
 * модуля ещё не переименован в CarpeDiem (`app.setName()` вызывается в index.ts
 * уже после импортов), поэтому окно трекера попадало в статистику как реальная
 * работа. PID главного процесса от порядка инициализации не зависит.
 */
function isSelfActivity(win: WindowInfo): boolean {
  if (win.owner.processId === process.pid) return true
  const appName = win.owner.name
  return SELF_APP_NAMES.has(appName) || appName === app.getName()
}

/** Как часто пишем прогресс открытого события, чтобы сводки были живыми */
const PROGRESS_INTERVAL_MS = 5000

/** Сколько может идти один тик, прежде чем считаем его зависшим */
const POLL_STALL_MS = 10_000

/** После стольких неудачных опросов подряд считаем, что окна не читаются */
const POLL_FAILURE_LIMIT = 10

/** Приложения, которые появляются когда экран заблокирован / скринсейвер.
 * active-win на macOS возвращает loginwindow когда экран залочен,
 * ScreenSaverEngine — когда активен скринсейвер. Это не реальная активность. */
const LOCKED_SCREEN_APPS = new Set(['loginwindow', 'ScreenSaverEngine'])

/** Ключевые слова private/incognito в заголовке окна → приватный режим */
const PRIVATE_KEYWORDS = ['incognito', 'private browsing', 'private window', 'little arc']

/**
 * TrackingEngine — опрашивает active-win каждые 1 сек и записывает события в БД.
 *
 * Алгоритм:
 * 1. Каждую секунду получает active window (appName, title, bundleId)
 * 2. Если app/title изменился → закрывает текущее событие (duration = now - start),
 *    создаёт новое
 * 3. Если AFK (определяется AFKDetector) → закрывает текущее, пишет AFK событие
 * 4. Pause/resume — пользователь может приостановить трекинг
 *
 * Производительность:
 * - 1 poll/sec → минимальная нагрузка
 * - Запись в БД только при смене активности, не при каждом тике
 * - EventEmitter уведомляет renderer о смене активности (через IPC)
 */
export class TrackingEngine extends EventEmitter {
  private db: DatabaseManager
  private intervalId: NodeJS.Timeout | null = null
  private pollIntervalMs: number = 1000

  private currentEventId: number | null = null
  private currentTsStart: string | null = null
  private currentAppName: string = ''
  private currentWindowTitle: string = ''
  private currentUrl: string | null = null
  private isPaused: boolean = false
  private isPrivateBrowsing: boolean = false
  private isScreenLocked: boolean = false
  private isAfk: boolean = false
  private excludedApps: Set<string> = new Set()
  private hasAccessibilityPermission: boolean = false
  private lastProgressAt: number = 0
  private pollInFlight = false      // защита от наложения тиков poll()
  private pollStartedAt = 0
  private activeWinFailures = 0     // подряд неудачных опросов активного окна

  // ─── Google Meet background tracking ────────────────────
  // Когда созвон активен (meet.google.com в foreground),
  // пользователь часто переключается на другие приложения,
  // но звонок продолжает идти. Мы отслеживаем параллельный
  // фоновый event для Meet, чтобы время звонка не терялось.
  private meetingActive: boolean = false  // идёт ли сейчас созвон
  private meetingLastSeen: number = 0  // Date.now() последнего наблюдения Meet
  private meetingId: number | null = null  // запись в meetings, пока созвон идёт
  private lastMeetingWrite: number = 0
  private meetingSource: DetectedMeeting['source'] | null = null
  private lastMeetingScan: number = 0
  /**
   * Meet живёт во вкладке браузера, а в списке окон виден только заголовок
   * активной вкладки. Пока вы работаете в другом окне, сигнала нет вообще —
   * это норма, а не конец звонка. 20 минут покрывают рабочие переключения,
   * не растягивая звонок на полдня.
   */
  private readonly MEETING_TIMEOUT_MS = 20 * 60 * 1000
  /** Окно созвона пропало → он закончился. Хаддл/Zoom/Teams видны в списке окон */
  private readonly MEETING_GONE_MS = 45_000
  /** Как часто смотрим список открытых окон */
  private readonly MEETING_SCAN_MS = 5_000

  constructor(db: DatabaseManager) {
    super()
    this.db = db
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  /**
   * Проверяет Accessibility permission (check-only, без системного диалога).
   * active-win на macOS использует Accessibility API — без разрешения
   * каждый вызов бинарника может триггерить системный промпт.
   */
  private checkAccessibilityPermission(): boolean {
    if (process.platform !== 'darwin') return true
    const trusted = systemPreferences.isTrustedAccessibilityClient(false)
    if (trusted !== this.hasAccessibilityPermission) {
      this.hasAccessibilityPermission = trusted
      if (trusted) {
        log.info('[TrackingEngine] Accessibility permission granted')
      } else {
        log.warn('[TrackingEngine] Accessibility permission lost — pausing active-win calls')
      }
    }
    return trusted
  }

  start(): void {
    if (this.intervalId) return
    this.loadExcludedApps()

    // Check Accessibility permission BEFORE starting poll loop.
    // Without this, every activeWin() call (1/sec) spawns a native binary
    // that triggers the macOS Accessibility permission dialog — spamming the user.
    if (!this.checkAccessibilityPermission()) {
      log.warn('[TrackingEngine] No Accessibility permission — not starting poll loop')
      return
    }

    log.info('[TrackingEngine] Starting polling every', this.pollIntervalMs, 'ms')

    // Recover zombie events from previous crash (events with duration=0
    // that were never closed because the app was killed/crashed).
    try {
      const recovered = this.db.recoverZombieEvents()
      if (recovered > 0) {
        log.info(`[TrackingEngine] Recovered ${recovered} zombie event(s) from previous session`)
      }
    } catch (err) {
      log.error('[TrackingEngine] Zombie recovery failed:', err)
    }

    this.intervalId = setInterval(() => this.poll(), this.pollIntervalMs)
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    if (this.meetingActive) {
      this.meetingActive = false
      this.closeMeetingInterval(Date.now())
    }
    this.closeCurrentEvent()
    log.info('[TrackingEngine] Stopped')
  }

  pause(): void {
    this.isPaused = true
    try {
      this.closeCurrentEvent()
    } catch (err) {
      log.error('[TrackingEngine] closeCurrentEvent failed during pause:', err)
    }
    this.emitActivityChanged()
    log.info('[TrackingEngine] Paused')
  }

  resume(): void {
    this.isPaused = false
    this.emitActivityChanged()
    log.info('[TrackingEngine] Resumed')
  }

  /** Reload excluded apps from settings (called when user updates list) */
  loadExcludedApps(): void {
    const raw = this.db.getSetting('excludedApps')
    try {
      const apps = raw ? JSON.parse(raw) as string[] : []
      this.excludedApps = new Set(apps)
      log.info('[TrackingEngine] Excluded apps:', [...this.excludedApps])
    } catch {
      this.excludedApps = new Set()
    }
  }

  // ─── AFK handling ────────────────────────────────────────────

  /**
   * Вызывается AFKDetector при переходе в idle/sleep.
   * Закрывает текущее событие и пишет AFK событие.
   */
  onAfkStart(): void {
    if (this.isAfk) return
    this.isAfk = true
    try {
      this.closeCurrentEvent()
    } catch (err) {
      log.error('[TrackingEngine] closeCurrentEvent failed during AFK start:', err)
    }
    this.emitActivityChanged()
    log.info('[TrackingEngine] AFK started')
  }

  /**
   * Вызывается AFKDetector при возврате из idle/sleep.
   * Пишет AFK событие с duration = время отсутствия,
   * привязанное к категории "AFK".
   */
  onAfkEnd(afkDuration: number): void {
    if (!this.isAfk) return
    this.isAfk = false

    try {
      // Находим categoryId для AFK (категория создаётся миграцией 003)
      const afkCategory = this.db.getCategoryByName('AFK')
      const afkCategoryId = afkCategory?.id ?? null

      // Записываем AFK событие
      const now = new Date()
      const tsEnd = now.toISOString()
      const tsStart = new Date(now.getTime() - afkDuration * 1000).toISOString()

      this.db.insertEvent({
        tsStart,
        tsEnd,
        duration: afkDuration,
        appName: 'AFK',
        appBundleId: undefined,
        windowTitle: 'Away from keyboard',
        url: null,
        categoryId: afkCategoryId,
        isAfk: true,
        isPrivate: false
      })
    } catch (err) {
      log.error('[TrackingEngine] Failed to record AFK event:', err)
    }

    this.emitActivityChanged()
    log.info(`[TrackingEngine] AFK ended (was away ${afkDuration}s)`)
  }

  /** Идёт ли сейчас Google Meet звонок (foreground или background)? (для AFK suppression) */
  isMeetingActive(): boolean {
    return this.meetingActive
  }

  // ─── Google Meet background tracking ────────────────────────

  /**
   * Обработка Google Meet: пишем интервал созвона отдельной записью.
   *
   * Почему не событием: созвон идёт параллельно с работой (человек в Figma
   * и в звонке одновременно). События суммируются в SUM(duration), и время
   * считалось бы дважды — это уже случалось ранее. Интервал в `meetings`
   * накладывается на шкалу активности и в сумму не входит.
   *
   * ts_end продлевается, пока вкладка встречи видна или пока с последнего
   * её появления не прошёл таймаут: созвон продолжается, даже если окно
   * переключили.
   */
  private updateMeetingTracking(
    win: { appName: string; windowTitle: string; url: string | null },
    now: number
  ): void {
    this.applyMeeting(detectMeeting(win), now)
  }

  /**
   * Обновляет состояние созвона по результату опроса.
   *
   * Закрываем по-разному: окно Slack/Zoom/Teams видно в списке окон всё время,
   * поэтому его исчезновение — надёжный признак конца. У Meet окно — обычная
   * вкладка браузера, её в списке с URL не видно, поэтому для него живёт
   * старая страховка в 10 минут.
   */
  private applyMeeting(detected: DetectedMeeting | null, now: number): void {
    if (detected) {
      if (!this.meetingActive) {
        this.meetingActive = true
        this.meetingSource = detected.source
        this.meetingId = this.db.startMeeting(
          new Date(now).toISOString(),
          detected.url,
          detected.source,
          detected.title
        )
        this.lastMeetingWrite = now
        log.info(`[TrackingEngine] Meeting started (${detected.source})`)
      }
      this.meetingLastSeen = now
      this.flushMeeting(now)
      return
    }

    if (!this.meetingActive) return

    const grace =
      this.meetingSource === 'Google Meet' ? this.MEETING_TIMEOUT_MS : this.MEETING_GONE_MS

    if (now - this.meetingLastSeen > grace) {
      this.meetingActive = false
      this.meetingSource = null
      // Конец — момент, когда созвон видели последний раз, а не сейчас
      this.closeMeetingInterval(this.meetingLastSeen)
      log.info('[TrackingEngine] Meeting ended')
      return
    }

    this.flushMeeting(now)
  }

  /** Раз в 5 секунд смотрим все открытые окна: созвон в фоне тоже надо видеть */
  private async scanMeetings(): Promise<void> {
    const now = Date.now()
    if (now - this.lastMeetingScan < this.MEETING_SCAN_MS) return
    this.lastMeetingScan = now

    try {
      const windows = await getOpenWindows()
      const detected = detectMeetingAmong(
        windows.map((w) => ({
          appName: w.owner?.name ?? '',
          windowTitle: w.title ?? '',
          url: w.url ?? null
        }))
      )
      this.applyMeeting(detected, Date.now())
    } catch (err) {
      log.warn('[TrackingEngine] open windows scan failed:', err)
    }
  }

  /** Продлевает интервал созвона не чаще раза в PROGRESS_INTERVAL_MS */
  private flushMeeting(now: number): void {
    if (this.meetingId === null) return
    if (now - this.lastMeetingWrite < PROGRESS_INTERVAL_MS) return
    this.lastMeetingWrite = now

    try {
      this.db.extendMeeting(this.meetingId, new Date(now).toISOString())
    } catch (err) {
      log.error('[TrackingEngine] meeting update failed:', err)
    }
  }

  private closeMeetingInterval(now: number): void {
    if (this.meetingId === null) return

    try {
      this.db.closeMeeting(this.meetingId, new Date(now).toISOString())
    } catch (err) {
      log.error('[TrackingEngine] meeting close failed:', err)
    }
    this.meetingId = null
  }

  // ─── Core polling ────────────────────────────────────────────

  /**
   * Обёртка тика. Без неё зависший вызов activeWin() превращался в катастрофу:
   * setInterval продолжал спавнить хелперы, каждый блокировался на проверке
   * разрешений, и за минуты накапливались десятки висящих процессов — трекер
   * молча переставал писать. Здесь одновременно выполняется не больше одного тика,
   * а зависший тик снимается сторожевым таймером.
   */
  private async poll(): Promise<void> {
    if (this.pollInFlight) {
      const stuckMs = Date.now() - this.pollStartedAt
      if (stuckMs > POLL_STALL_MS) {
        log.error(`[TrackingEngine] Тик висит ${Math.round(stuckMs / 1000)} с — снимаю его`)
        this.pollInFlight = false
        this.reportWindowAccess(false)
      }
      return
    }

    this.pollInFlight = true
    this.pollStartedAt = Date.now()
    try {
      await this.pollOnce()
    } finally {
      this.pollInFlight = false
    }
  }

  private async pollOnce(): Promise<void> {
    try {
      if (this.isPaused || this.isAfk) return

      // Guard: skip activeWin() if Accessibility permission was revoked.
      // Without this, each call spawns a native binary that re-triggers
      // the macOS permission dialog.
      if (!this.checkAccessibilityPermission()) return

      let win: WindowInfo | undefined
      try {
        win = await getActiveWindow()
        this.activeWinFailures = 0
        this.reportWindowAccess(true)
      } catch (err) {
        this.activeWinFailures += 1
        // Логируем первую неудачу и дальше раз в минуту, а не каждую секунду
        if (this.activeWinFailures === 1 || this.activeWinFailures % 60 === 0) {
          log.error(
            `[TrackingEngine] activeWin error (подряд ${this.activeWinFailures}):`,
            err
          )
        }
        if (this.activeWinFailures >= POLL_FAILURE_LIMIT) {
          this.reportWindowAccess(false)
        }
        return
      }

      // Re-check after async — AFK/pause may have started during await activeWin().
      // Without this, poll() creates real events that overlap with AFK events
      // (race condition: isAfk checked at top, but activeWin is async).
      if (this.isPaused || this.isAfk) return

      if (!win) {
        // Нет активного окна — возможно screen locked или нет дисплея
        return
      }

      // Своё окно — обычная активность, только с читаемым именем.
      // Раньше здесь событие закрывалось и время не писалось вовсе: просмотр
      // статистики оставлял дыру в дне, а в шапке появлялось «Idle».
      const appName = isSelfActivity(win) ? 'CarpeDiem' : win.owner.name
      const windowTitle = win.title
      const appBundleId = 'bundleId' in win.owner ? (win.owner as { bundleId?: string }).bundleId : undefined
      const url = 'url' in win ? (win as { url?: string }).url ?? null : null

      // Созвон (Meet / Zoom / Teams / Slack huddle) — состояние обновляем до обычного трекинга
      this.updateMeetingTracking({ appName, windowTitle, url }, Date.now())
      void this.scanMeetings()

      // Locked screen / screensaver — not real activity, don't record.
      // This catches cases where lock-screen event hasn't fired yet (race),
      // or where loginwindow appears briefly during sleep/wake transitions.
      if (LOCKED_SCREEN_APPS.has(appName)) {
        if (!this.isScreenLocked) {
          this.closeCurrentEvent()
          this.isScreenLocked = true
          this.emitActivityChanged()
          log.info('[TrackingEngine] Screen locked (loginwindow/screensaver) — not tracking')
        }
        return
      }

      // Check exclusion list — app user doesn't want tracked
      if (this.excludedApps.has(appName)) {
        if (this.currentEventId !== null) {
          this.closeCurrentEvent()
          this.emitActivityChanged()
        }
        return
      }

      // Coming back from locked screen → force new event
      const wasScreenLocked = this.isScreenLocked
      this.isScreenLocked = false

      // Private/incognito tab detection — skip tracking (privacy)
      const isPrivate = isPrivateTab(appName, windowTitle)
      if (isPrivate) {
        if (!this.isPrivateBrowsing) {
          this.closeCurrentEvent()
          this.isPrivateBrowsing = true
          this.emitActivityChanged()
          log.info('[TrackingEngine] Private browsing — not tracking')
        }
        return
      }

      // Coming back from private → force new event
      const wasPrivateBrowsing = this.isPrivateBrowsing
      this.isPrivateBrowsing = false

      const changed =
        appName !== this.currentAppName ||
        windowTitle !== this.currentWindowTitle ||
        wasScreenLocked ||
        wasPrivateBrowsing

      if (changed) {
        this.closeCurrentEvent()
        this.startNewEvent(appName, windowTitle, appBundleId, url)
        this.emitActivityChanged()
      } else {
        // Ничего не изменилось — подтягиваем длительность открытого события,
        // иначе текущий кусок активности не виден ни в одной сводке
        this.flushProgress()
      }
    } catch (err) {
      // Catch-all: any exception in poll() would otherwise kill the
      // tracking silently (setInterval swallows thrown errors in async callbacks).
      // We log and let the next tick continue normally.
      log.error('[TrackingEngine] poll() unexpected error:', err)
    }
  }

  private startNewEvent(
    appName: string,
    windowTitle: string,
    appBundleId: string | undefined,
    url: string | null
  ): void {
    const now = new Date().toISOString()
    this.currentTsStart = now
    this.lastProgressAt = Date.now()
    this.currentAppName = appName
    this.currentWindowTitle = windowTitle
    this.currentUrl = url

    this.currentEventId = this.db.insertEvent({
      tsStart: now,
      tsEnd: now, // ts_end обновится при close
      duration: 0,
      appName,
      appBundleId,
      windowTitle,
      url,
      categoryId: null,
      isAfk: false,
      isPrivate: false
    })
  }

  /**
   * Сообщает наружу, что активное окно не читается (зависший хелпер active-win,
   * отозванное разрешение). Без этого трекер умирал молча — как это уже случалось.
   */
  private reportWindowAccess(ok: boolean): void {
    this.emit('window-access', ok)
  }

  /**
   * Пишет прогресс открытого события (ts_end + duration) по ходу работы.
   * Длительность иначе появляется только при закрытии события, из-за чего
   * «за сегодня» отставало на всё текущее время в окне.
   */
  private flushProgress(): void {
    if (this.currentEventId === null || this.currentTsStart === null) return

    const now = Date.now()
    if (now - this.lastProgressAt < PROGRESS_INTERVAL_MS) return
    this.lastProgressAt = now

    try {
      const duration = Math.round((now - new Date(this.currentTsStart).getTime()) / 1000)
      this.db.updateEventProgress(this.currentEventId, new Date(now).toISOString(), duration)
    } catch (err) {
      log.error('[TrackingEngine] progress update failed:', err)
    }
  }

  private closeCurrentEvent(): void {
    if (this.currentEventId === null || this.currentTsStart === null) return

    const now = new Date()
    const tsEnd = now.toISOString()
    const duration = Math.round((now.getTime() - new Date(this.currentTsStart).getTime()) / 1000)

    this.db.closeEvent(this.currentEventId, tsEnd, duration)

    this.currentEventId = null
    this.currentTsStart = null
    this.currentAppName = ''
    this.currentWindowTitle = ''
  }

  // ─── Queries ────────────────────────────────────────────────

  getCurrentActivity(): CurrentActivity {
    // When self-focused, still show the last real activity
    if (this.isPrivateBrowsing) {
      return {
        appName: 'Private browsing',
        windowTitle: 'Incognito / Private tab',
        url: null,
        tsStart: this.currentTsStart ?? new Date().toISOString(),
        isAfk: this.isAfk,
        isPaused: this.isPaused
      }
    }
    if (this.isScreenLocked) {
      return {
        appName: 'Screen locked',
        windowTitle: 'Locked',
        url: null,
        tsStart: this.currentTsStart ?? new Date().toISOString(),
        isAfk: this.isAfk,
        isPaused: this.isPaused
      }
    }
    return {
      appName: this.currentAppName || 'Idle',
      windowTitle: this.currentWindowTitle,
      url: this.currentUrl,
      tsStart: this.currentTsStart ?? new Date().toISOString(),
      isAfk: this.isAfk,
      isPaused: this.isPaused
    }
  }

  // ─── Events → IPC ────────────────────────────────────────────

  private emitActivityChanged(): void {
    this.emit('activity-changed', this.getCurrentActivity())
  }
}

/**
 * Detects private/incognito browsing by window title keywords.
 * Different browsers use different indicators:
 * - Chrome: "Incognito" in title
 * - Safari: "Private Browsing" in title
 * - Firefox: "Private Browsing" in title
 * - Arc: "Little Arc" (ephemeral/private windows)
 */
function isPrivateTab(_appName: string, windowTitle: string): boolean {
  const titleLower = windowTitle.toLowerCase()
  return PRIVATE_KEYWORDS.some((kw) => titleLower.includes(kw))
}
