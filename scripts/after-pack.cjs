/**
 * Code signing hook for electron-builder.
 *
 * Why: macOS TCC (Accessibility, Screen Recording permissions) is tied to
 * the app's code signature. Ad-hoc signing (codesign -s -) produces a cdhash
 * that changes every rebuild → macOS treats it as a "new" app → resets
 * permissions on every reinstall or reboot.
 *
 * Solution: sign with a self-signed certificate ("AliSwitcher Code Signing")
 * from the login keychain. The certificate's CN/O stay stable across rebuilds,
 * so macOS TCC tracks the app by certificate identity, not by cdhash.
 * Accessibility permission persists across reinstalls and reboots.
 *
 * No Apple Developer account required — self-signed certificates work for
 * TCC stability on the same machine where the certificate is trusted.
 *
 * Runs after electron-builder packs the .app, before DMG creation.
 *
 * Why the seal is verified at the end: a single stray xattr on the bundle
 * (com.apple.FinderInfo, com.apple.fileprovider.fpfs#P from iCloud Drive)
 * makes `codesign --verify --strict` fail. The app still launches — macOS just
 * stops matching it against its TCC entry, so Accessibility silently never
 * applies: the toggle exists in System Settings, and nothing is tracked.
 * `codesign --verify` without --strict accepts such a bundle, which is why the
 * build used to look green while permissions were broken.
 */
const { execSync } = require('child_process')
const { existsSync, mkdirSync, rmSync } = require('fs')
const { tmpdir } = require('os')
const { basename, join } = require('path')

const SIGNING_IDENTITY = 'AliSwitcher Code Signing'

/**
 * Убирает resource forks и xattr со всех файлов бандла.
 * codesign отказывается подписывать приложение с xattr на вложенных файлах,
 * а macOS отказывается сопоставлять такое приложение с записью в TCC.
 */
function stripAttributes(appPath) {
  execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' })
  execSync(`find "${appPath}" -exec xattr -c {} + 2>/dev/null || true`, { stdio: 'inherit' })
}

/** Сколько раз пробуем подписать: iCloud возвращает xattr за миллисекунды */
const SIGN_ATTEMPTS = 5

/**
 * Падает, если печать подписи битая. Без строгой проверки сборка «зелёная»,
 * а разрешения на машине пользователя не работают — эта поломка уже стоила
 * часов датагэпа в статистике.
 */
function assertSealValid(appPath) {
  try {
    execSync(`codesign --verify --strict "${appPath}"`, { stdio: 'pipe' })
  } catch (err) {
    const detail = (err.stderr || err.stdout || '').toString().trim()
    throw new Error(
      '[afterPack] Подпись приложения битая: macOS не сопоставит его с записью в TCC, ' +
        'и разрешение Accessibility работать не будет.\n' +
        `${detail}\n` +
        'Причина обычно во xattr, которые вернул iCloud Drive / Finder. ' +
        'Запускайте .app из /Applications, а не из папки под ~/Documents.'
    )
  }
}

/**
 * Подписывает и проверяет печать, повторяя попытку.
 *
 * Почему цикл: синхронизация iCloud успевает вернуть xattr на бандл между
 * `xattr -cr` и `codesign`, и подпись падает с "resource fork, Finder
 * information, or similar detritus not allowed". Гонку нельзя выиграть
 * гарантированно, но можно повторить.
 */
function signAndVerify(appPath, identity) {
  let lastError = null

  for (let attempt = 1; attempt <= SIGN_ATTEMPTS; attempt++) {
    try {
      stripAttributes(appPath)
      execSync(`codesign --force --deep --sign "${identity}" "${appPath}"`, { stdio: 'pipe' })

      // xattr могут вернуться и после подписи — чистим и проверяем начисто
      stripAttributes(appPath)
      assertSealValid(appPath)
      return
    } catch (err) {
      lastError = err
      console.warn(`[afterPack] Попытка ${attempt}/${SIGN_ATTEMPTS} не удалась, повторяю…`)
    }
  }

  throw lastError
}

/**
 * Подписывает приложение ВНЕ синхронизируемой папки.
 *
 * Почему: репозиторий лежит в ~/Documents, а iCloud Drive возвращает
 * com.apple.FinderInfo и com.apple.fileprovider.fpfs#P на вложенные
 * .app/.framework быстрее, чем успевает пройти codesign. Пять попыток подряд
 * падают с "resource fork, Finder information, or similar detritus not allowed".
 * Поэтому копируем бандл в системный tmp, подписываем и проверяем там, а обратно
 * возвращаем через ditto --noextattr.
 */
function signOutsideCloudSync(appPath, identity) {
  const staging = join(tmpdir(), 'carpediem-sign')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })

  const staged = join(staging, basename(appPath))
  execSync(`ditto --noextattr "${appPath}" "${staged}"`, { stdio: 'inherit' })

  try {
    signAndVerify(staged, identity)
  } finally {
    // Возвращаем подписанный бандл на место, не перенося xattr
    try {
      rmSync(appPath, { recursive: true, force: true })
      if (existsSync(staged)) {
        execSync(`ditto --noextattr "${staged}" "${appPath}"`, { stdio: 'inherit' })
      }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
}

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)

  console.log('[afterPack] Certificate signing:', appPath)

  if (appPath.includes('/Documents/')) {
    console.warn(
      '[afterPack] ⚠️  Сборка лежит в ~/Documents. Если папка синхронизируется (iCloud Drive), ' +
        'синхронизация вернёт xattr на бандл и подпись перестанет проверяться. ' +
        'Копируйте .app в /Applications перед запуском.'
    )
  }

  // 1. Remove resource forks / extended attributes from ALL files in the bundle
  // 2. Sign with self-signed certificate: --force (overwrite), --deep (nested)
  try {
    signOutsideCloudSync(appPath, SIGNING_IDENTITY)
    console.log('[afterPack] Certificate signing complete ✓')
  } catch (err) {
    console.error('[afterPack] Certificate signing failed:', err.message)
    // Fallback: ad-hoc signing (no stable TCC, but app still runs)
    console.warn('[afterPack] Falling back to ad-hoc signing')
    signOutsideCloudSync(appPath, '-')
    console.log('[afterPack] Ad-hoc fallback signing complete ✓')
  }
}
