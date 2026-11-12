import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppTag, TagTargetType, TagType } from '../../../shared/types'
import { METRIC } from './colors'

/** Конфиг тегов: цвет, подпись, фон для badge */
export const TAG_CONFIG: Record<TagType, { label: string; color: string; bg: string }> = {
  work: { label: 'Работа', color: METRIC.work, bg: `${METRIC.work}22` },
  neutral: { label: 'Нейтр.', color: METRIC.neutral, bg: `${METRIC.neutral}22` },
  distracting: { label: 'Отвлечение', color: METRIC.distracting, bg: `${METRIC.distracting}22` }
}

/**
 * Цвет для шкалы дня и баров: три семантических вместо хеша на 8 оттенков.
 * Хеш-палитра означала «каждому приложению свой цвет», и цвет не сообщал ничего.
 */
export const UNTAGGED_COLOR = '#414868'

export function tagColor(tag: TagType | undefined): string {
  return tag ? TAG_CONFIG[tag].color : UNTAGGED_COLOR
}

/** Загружает все теги и предоставляет set/delete с обновлением локального state */
export function useAppTags(): {
  tags: Map<string, TagType>
  setTag: (targetType: TagTargetType, targetKey: string, tag: TagType) => Promise<void>
  deleteTag: (targetType: TagTargetType, targetKey: string) => Promise<void>
} {
  const [tagList, setTagList] = useState<AppTag[]>([])
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    window.api.tags.getAll().then((tags) => {
      if (mountedRef.current) setTagList(tags)
    })
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Строим Map: "app:Visual Studio Code" → "work"
  const tags = new Map<string, TagType>()
  for (const t of tagList) {
    tags.set(`${t.targetType}:${t.targetKey}`, t.tag)
  }

  const setTag = useCallback(async (targetType: TagTargetType, targetKey: string, tag: TagType) => {
    // Оптимистичное обновление
    setTagList((prev) => {
      const filtered = prev.filter((t) => !(t.targetType === targetType && t.targetKey === targetKey))
      return [...filtered, { id: 0, targetType, targetKey, tag, updatedAt: new Date().toISOString() }]
    })
    await window.api.tags.set(targetType, targetKey, tag)
  }, [])

  const deleteTag = useCallback(async (targetType: TagTargetType, targetKey: string) => {
    setTagList((prev) => prev.filter((t) => !(t.targetType === targetType && t.targetKey === targetKey)))
    await window.api.tags.delete(targetType, targetKey)
  }, [])

  return { tags, setTag, deleteTag }
}

/** Маленький цветной badge с названием тега */
export function TagBadge({ tag }: { tag: TagType }): JSX.Element {
  const config = TAG_CONFIG[tag]
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ color: config.color, backgroundColor: config.bg }}
    >
      {config.label}
    </span>
  )
}

/** Выпадающее меню «три точки» для выбора тега */
export function TagMenu({
  currentTag,
  onSelect,
  onClear
}: {
  currentTag: TagType | undefined
  onSelect: (tag: TagType) => void
  onClear: () => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpen(!open)
        }}
        className="no-drag rounded p-1 text-tt-muted hover:bg-tt-bg hover:text-tt-text"
        title="Установить тег"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-tt-border bg-tt-surface py-1 shadow-lg">
          {(Object.keys(TAG_CONFIG) as TagType[]).map((tag) => {
            const config = TAG_CONFIG[tag]
            const isActive = currentTag === tag
            return (
              <button
                key={tag}
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(tag)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-tt-bg ${
                  isActive ? 'text-tt-text' : 'text-tt-muted'
                }`}
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: config.color }} />
                {config.label}
                {isActive && <span className="ml-auto text-tt-accent">✓</span>}
              </button>
            )
          })}
          {currentTag && (
            <>
              <div className="my-1 border-t border-tt-border" />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onClear()
                  setOpen(false)
                }}
                className="flex w-full px-3 py-1.5 text-left text-xs text-tt-muted hover:bg-tt-bg"
              >
                Снять тег
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
