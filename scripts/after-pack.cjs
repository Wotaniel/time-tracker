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
const { join } = require('path')

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
  stripAttributes(appPath)

  try {
    execSync(`codesign --force --deep --sign "${SIGNING_IDENTITY}" "${appPath}"`, {
      stdio: 'inherit'
    })
    console.log('[afterPack] Certificate signing complete ✓')
  } catch (err) {
    console.error('[afterPack] Certificate signing failed:', err.message)
    // Fallback: ad-hoc signing (no stable TCC, but app still runs)
    console.warn('[afterPack] Falling back to ad-hoc signing')
    stripAttributes(appPath)
    execSync(`codesign --force --deep --sign - "${appPath}"`, {
      stdio: 'inherit'
    })
    console.log('[afterPack] Ad-hoc fallback signing complete ✓')
  }

  // xattr могут появиться даже между подписью и этим шагом — чистим ещё раз,
  // затем проверяем печать и валим сборку, если она не сходится
  stripAttributes(appPath)
  assertSealValid(appPath)
  console.log('[afterPack] Seal verified: codesign --verify --strict ✓')
}
