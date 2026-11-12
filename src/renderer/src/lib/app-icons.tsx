import { useEffect, useRef, useState } from 'react'

/** Кэш иконок: запрос к main стоит дорого, а список перерисовывается часто */
const iconCache = new Map<string, string | null>()

/** Hook: загружает иконку приложения через IPC, кэширует */
export function useAppIcon(appName: string, bundleId?: string | null): string | null {
  const [icon, setIcon] = useState<string | null>(() => {
    const key = bundleId || appName
    return iconCache.get(key) ?? null
  })
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const key = bundleId || appName
    const cached = iconCache.get(key)
    if (cached !== undefined) {
      setIcon(cached)
      return
    }
    window.api.apps.getIcon(appName, bundleId ?? undefined).then((dataUrl) => {
      iconCache.set(key, dataUrl)
      if (mountedRef.current) setIcon(dataUrl)
    })
  }, [appName, bundleId])

  return icon
}

/** Компактная иконка 28×28 или fallback — первая буква в кружке */
export function AppIcon({
  appName,
  bundleId
}: {
  appName: string
  bundleId?: string | null
}): JSX.Element {
  const icon = useAppIcon(appName, bundleId)
  if (icon) {
    return <img src={icon} alt={appName} className="h-7 w-7 shrink-0 rounded" />
  }
  const initial = appName.charAt(0).toUpperCase()
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-tt-accent/30 text-xs font-bold text-tt-accent">
      {initial}
    </div>
  )
}
