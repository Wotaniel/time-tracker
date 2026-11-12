import { app, BrowserWindow, shell, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { DatabaseManager } from './database'
import { TrackingEngine } from './tracking-engine'
import { AFKDetector } from './afk-detector'
import { TrackingHealth } from './tracking-health'
import { registerIpcHandlers } from './ipc-handlers'
import { formatLocalDate } from './database'
import { installGlobalErrorHandlers, log } from './safe-log'
import { IPC_CHANNELS } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let db: DatabaseManager | null = null
let tracker: TrackingEngine | null = null
let afkDetector: AFKDetector | null = null
let trackingHealth: TrackingHealth | null = null
let isQuitting = false
let trayRefreshTimer: NodeJS.Timeout | null = null

// Set app name before ready — affects macOS menu bar, active-win results, tray
app.setName('CarpeDiem')

// Предотвращаем EIO crash, когда терминал закрылся
installGlobalErrorHandlers()

function createWindow(): void {
  // Guard: не создаём второе окно, если первое живо
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 10, y: 10 },
    backgroundColor: '#1a1b26',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Prevent window from closing — hide to tray instead
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  // Очистка ссылки при реальном уничтожении окна
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for dev
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  // Load template icon (clock face) for menu bar
  const iconPath = app.isPackaged
    ? join(process.resourcesPath ?? '', 'icons/trayTemplate.png')
    : join(__dirname, '../../resources/icons/trayTemplate.png')
  const icon = nativeImage.createFromPath(iconPath)
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('CarpeDiem')

  updateTrayMenu()
  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow?.show()
      if (mainWindow?.isMinimized()) {
        mainWindow?.restore()
      }
    }
  })
}

/** Возвращает "5h 32m" из секунд */
function formatTrayDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
}

/** Перестраивает tray-меню с quick summary сегодняшнего дня */
function updateTrayMenu(): void {
  if (!tray || !db || !tracker) return

  const today = formatLocalDate(new Date())
  const summary = db.getDaySummary(today)
  const totalActive = summary.reduce((s, a) => s + a.totalTime, 0)
  const current = tracker.getCurrentActivity()

  // Top 3 apps for quick summary
  const top3 = summary.slice(0, 3)

  // Без разрешения Accessibility трекер не пишет данные — говорим об этом прямо в меню,
  // иначе приложение выглядит работающим, а лента остаётся пустой.
  const health = trackingHealth?.getStatus()
  const healthWarning: Electron.MenuItemConstructorOptions[] =
    health && !health.tracking
      ? health.blockedBy === 'bundle-integrity'
        ? [
            { label: '⚠️ Подпись приложения повреждена — трекинг не работает', enabled: false },
            { label: '   запускайте копию из /Applications', enabled: false },
            { type: 'separator' }
          ]
        : [
            { label: '⚠️ Трекинг не работает: нет разрешения Accessibility', enabled: false },
            {
              label: 'Открыть Универсальный доступ…',
              click: (): void => trackingHealth?.openAccessibilitySettings()
            },
            { type: 'separator' }
          ]
      : []

  const template: Electron.MenuItemConstructorOptions[] = [
    { label: `CarpeDiem — ${formatTrayDuration(totalActive)} today`, enabled: false },
    { type: 'separator' },
    ...healthWarning,
    {
      label: current.isPaused
        ? '⏸ Tracking paused'
        : current.isAfk
          ? '💤 Away from keyboard'
          : `▶ ${current.appName}`,
      enabled: false
    },
    current.windowTitle
      ? { label: `   ${current.windowTitle}`, enabled: false }
      : { type: 'separator' },
    { type: 'separator' }
  ]

  if (top3.length > 0) {
    for (const app of top3) {
      template.push({
        label: `${app.appName} — ${formatTrayDuration(app.totalTime)}`,
        enabled: false
      })
    }
    template.push({ type: 'separator' })
  }

  template.push(
    {
      label: 'Open CarpeDiem',
      click: (): void => {
        mainWindow?.show()
        if (mainWindow?.isMinimized()) {
          mainWindow?.restore()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Pause Tracking',
      enabled: !current.isPaused,
      click: (): void => {
        tracker?.pause()
        updateTrayMenu()
      }
    },
    {
      label: 'Resume Tracking',
      enabled: current.isPaused,
      click: (): void => {
        tracker?.resume()
        updateTrayMenu()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: (): void => {
        app.quit()
      }
    }
  )

  tray.setContextMenu(Menu.buildFromTemplate(template))
  tray.setToolTip(
    health && !health.tracking
      ? 'CarpeDiem — трекинг не работает, причина в меню'
      : `CarpeDiem — ${formatTrayDuration(totalActive)} today`
  )
}

// ─── App lifecycle ─────────────────────────────────────────────

// Single-instance lock — не даём запустить второй экземпляр приложения
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  // app.exit() — мгновенный выход, в отличие от app.quit()
  // который ждёт обработчиков before-quit и может зависнуть
  app.exit(0)
}

app.on('second-instance', () => {
  // Кто-то пытается запустить второй экземпляр — фокусируем существующее окно
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
})

app.whenReady().then(() => {
  // Initialize database
  db = new DatabaseManager()
  log.info('[Main] Database initialized')

  // Initialize tracking engine
  tracker = new TrackingEngine(db)

  // ─── Tracking health ───────────────────────────────────────
  // On macOS, active-win uses Accessibility API. Without permission, every poll()
  // spawns a native binary that triggers the system dialog — so we request it ONCE
  // and wait until granted.
  // Why a dedicated health module: waiting silently looks exactly like a working app
  // with an empty timeline. It also detects a broken bundle signature — the case where
  // macOS refuses to match the app with its TCC entry, so the permission never applies.
  trackingHealth = new TrackingHealth()
  trackingHealth.on('changed', () => {
    updateTrayMenu()
    mainWindow?.webContents.send(IPC_CHANNELS.HEALTH_CHANGED, trackingHealth?.getStatus())
  })
  trackingHealth.ensure(() => tracker?.start())

  // Трекер сообщает, читается ли активное окно — иначе поломка снова станет тихой
  tracker.on('window-access', (ok: boolean) => {
    trackingHealth?.setWindowAccess(ok)
  })

  // Initialize AFK detector — load threshold from DB settings
  const savedThreshold = db.getSetting('idleThreshold')
  // 10 минут по умолчанию: 2 минуты резали обычное чтение и обдумывание
  const idleThreshold = savedThreshold ? parseInt(savedThreshold) || 600 : 600
  afkDetector = new AFKDetector(idleThreshold)
  // Suppress AFK during Google Meet calls (user may not touch keyboard/mouse)
  afkDetector.setExemptCallback(() => tracker?.isMeetingActive() ?? false)
  afkDetector.on('afk-start', () => {
    tracker?.onAfkStart()
  })
  afkDetector.on('afk-end', (duration: number) => {
    tracker?.onAfkEnd(duration)
  })
  afkDetector.start()

  // IPC — real handlers
  registerIpcHandlers(db, tracker, afkDetector, trackingHealth)

  // Push activity changes to renderer
  tracker.on('activity-changed', () => {
    mainWindow?.webContents.send('tracking:activityChanged', tracker!.getCurrentActivity())
    updateTrayMenu()
  })

  // Apply autostart setting from DB
  const autostart = db.getSetting('autostart')
  if (autostart === 'true') {
    app.setLoginItemSettings({ openAtLogin: true })
  }

  createTray()
  createWindow()

  // Refresh tray menu every 30s (duration grows even without activity change)
  trayRefreshTimer = setInterval(() => updateTrayMenu(), 30_000)

  app.on('activate', () => {
    // macOS: clicking dock icon — показываем существующее окно или создаём
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray when window is closed
  // User can click tray icon to reopen
  // Do NOT call app.quit() — tracking continues in background
})

app.on('before-quit', () => {
  isQuitting = true
  if (trayRefreshTimer) {
    clearInterval(trayRefreshTimer)
    trayRefreshTimer = null
  }
  // Закрываем текущее событие перед выходом
  tracker?.stop()
  afkDetector?.stop()
  trackingHealth?.dispose()
  db?.close()
  log.info('[Main] Cleaned up')
})
