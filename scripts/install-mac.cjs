#!/usr/bin/env node
/**
 * Ставит собранное приложение в /Applications — туда, где macOS не испортит подпись.
 *
 * Зачем: TCC (разрешение «Универсальный доступ») сопоставляет приложение с записью
 * в своей базе по подписи. Репозиторий лежит в ~/Documents, а iCloud Drive
 * синхронизирует эту папку целиком: через секунды после сборки на бандл
 * возвращаются посторонние xattr (com.apple.FinderInfo, com.apple.fileprovider.fpfs#P),
 * печать подписи перестаёт сходиться, и разрешение из Системных настроек
 * молча не применяется — трекер не пишет ни одного события. В /Applications
 * синхронизации нет, поэтому копия остаётся целой.
 *
 * Почему отдельный скрипт, а не строка в README: правильное действие должно быть
 * единственным, а не делом дисциплины.
 *
 * Использование:
 *   npm run install:mac   # поставить уже собранное
 *   npm run package:mac   # собрать и сразу поставить
 */
const { execFileSync } = require('child_process')
const { existsSync, readdirSync, rmSync } = require('fs')
const { join } = require('path')

const PROJECT_ROOT = join(__dirname, '..')
const RELEASE_DIR = join(PROJECT_ROOT, 'release')
const APP_NAME = 'CarpeDiem.app'
const DEST = `/Applications/${APP_NAME}`

function run(command, args, options = {}) {
  return execFileSync(command, args, { stdio: 'inherit', ...options })
}

function tryRun(command, args) {
  try {
    run(command, args, { stdio: 'ignore' })
  } catch {
    // Не критично: например, приложения не было запущено
  }
}

function findBuiltApp() {
  if (!existsSync(RELEASE_DIR)) {
    throw new Error('Нет папки release/ — сначала выполните npm run package:mac')
  }

  const candidates = readdirSync(RELEASE_DIR)
    .filter((name) => name === 'mac' || name.startsWith('mac-'))
    .map((name) => join(RELEASE_DIR, name, APP_NAME))
    .filter((path) => existsSync(path))

  if (candidates.length === 0) {
    throw new Error(`Не нашёл собранный ${APP_NAME} в release/ — сначала npm run package:mac`)
  }
  return candidates[0]
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('install:mac рассчитан только на macOS')
  }

  const source = findBuiltApp()
  console.log(`[install] ${source}`)
  console.log(`[install] → ${DEST}`)

  // Старый экземпляр держит окно и запись в БД — закрываем перед заменой
  tryRun('/usr/bin/pkill', ['-f', `${DEST}/Contents/MacOS/CarpeDiem`])
  rmSync(DEST, { recursive: true, force: true })

  // ditto сохраняет структуру бандла и вложенные подписи лучше, чем cp -R
  run('/usr/bin/ditto', [source, DEST])

  // На всякий случай: если что-то успело навесить xattr по дороге
  run('/usr/bin/xattr', ['-cr', DEST])

  // Печать подписи должна сходиться, иначе macOS не применит разрешение.
  // Проверяем здесь, а не «когда-нибудь потом», когда трекер молча не работает.
  run('/usr/bin/codesign', ['--verify', '--strict', DEST])
  console.log('[install] Подпись проверена ✓')

  // LaunchServices иногда отвечает -609 сразу после замены бандла — повторяем
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      run('/usr/bin/open', [DEST])
      console.log('[install] Запущено')
      return
    } catch {
      if (attempt === 3) {
        console.warn('[install] Не удалось запустить автоматически — запустите CarpeDiem из /Applications')
        return
      }
    }
  }
}

try {
  main()
} catch (err) {
  console.error(`[install] ${err.message}`)
  process.exit(1)
}
