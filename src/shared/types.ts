// Shared types — used in both main process and renderer.
// This file is the single source of truth for IPC contracts and data types.
// Imported by: src/main/**, src/preload/**, src/renderer/**

export interface ActivityEvent {
  id?: number
  tsStart: string // ISO 8601
  tsEnd: string // ISO 8601
  duration: number // seconds
  appName: string
  appBundleId?: string
  windowTitle: string
  url?: string | null
  categoryId?: number | null
  taskKey?: string | null // Jira-ключ задачи, извлечённый из title/url (e.g. "ADG-12144")
  isAfk: boolean
  isPrivate: boolean
}

export interface CurrentActivity {
  appName: string
  windowTitle: string
  url?: string | null
  tsStart: string
  isAfk: boolean
  isPaused: boolean
}

export interface Category {
  id: number
  name: string
  color: string
  productivity: number // -2..+2
  sortOrder: number
}

export interface CategoryRule {
  id: number
  categoryId: number
  field: 'app_name' | 'window_title' | 'url' | 'app_bundle'
  matchType: 'equals' | 'contains' | 'startsWith' | 'regex'
  value: string
}

export interface DaySummary {
  appName: string
  totalTime: number // seconds
  percentage: number
  categoryId?: number | null
  categoryName?: string
}

/**
 * Созвон. Живёт отдельно от событий: параллельная работа и разговор — это одно
 * и то же время, поэтому созвон накладывается на шкалу, а не прибавляется к ней.
 */
export interface Meeting {
  id: number
  tsStart: string
  tsEnd: string | null // null — созвон ещё идёт
  url: string | null
  /** Чем поймали: «Google Meet», «Slack huddle», «Zoom», «Microsoft Teams» */
  source: string | null
  /** Название встречи; для хаддла — участник */
  title: string | null
}

/**
 * Покрытие дня: на что ушло время с первого до последнего события.
 * Без разбивки день выглядит короче, чем был, и не видно, куда делось остальное.
 */
export interface DayCoverage {
  active: number // seconds
  afk: number // seconds
  uncovered: number // seconds — приложение не работало
  span: number // seconds — от первого события до последнего
}

/** Окно/вкладка внутри приложения — для детальной разбивки */
export interface WindowEntry {
  windowTitle: string
  url: string | null
  totalTime: number // seconds
}

/** Ручная метка приложения или домена */
export type TagType = 'work' | 'neutral' | 'distracting'

/** Тип цели тегирования — приложение или домен сайта */
export type TagTargetType = 'app' | 'domain'

/** Запись тега в БД */
export interface AppTag {
  id: number
  targetType: TagTargetType
  targetKey: string // app name or domain
  tag: TagType
  updatedAt: string
}

/** Статистика времени по тегам за период */
export interface TagStat {
  tag: TagType | 'untagged'
  seconds: number
}

/** Приложение/домен, отмеченный как «работа» — статистика за период */
export interface WorkAppStat {
  targetKey: string // app name or domain
  targetType: TagTargetType
  seconds: number
  percentage: number
}

/** Статистика времени по задачам (Jira-ключи: ADG-12144 и т.п.) */
export interface TaskStat {
  taskKey: string // e.g. "ADG-12144"
  seconds: number
  percentage: number
  /** Список приложений, в которых эта задача встречалась */
  apps: string[]
}

/** Рабочее время за конкретный день — для целей и серий */
export interface WorkDayStat {
  date: string
  seconds: number
}

/** Насколько часто срабатывало правило за день — чтобы правила были видны */
export interface RuleUsage {
  ruleId: number
  matches: number
  seconds: number
}

/**
 * Время, у которого нет категории: приложение или домен без тега.
 * Это очередь разбора — время есть, но неизвестно, работа это или отвлечение.
 */
export interface UntaggedEntry {
  targetType: TagTargetType
  targetKey: string
  seconds: number
}

/** Детальная сводка за день: appName с разбивкой по окнам/вкладкам */
export interface DetailedDaySummary {  appName: string
  appBundleId?: string | null
  totalTime: number // seconds
  percentage: number
  categoryId?: number | null
  categoryName?: string
  windows: WindowEntry[]
}

export interface DailyStat {
  date: string // YYYY-MM-DD
  totalActive: number // seconds
  byTag: { tag: TagType | 'untagged'; seconds: number }[]
}

/** Heatmap cell — day of week × hour */
export interface HeatmapCell {
  dayOfWeek: number // 0=Sunday, 6=Saturday
  hour: number // 0-23
  seconds: number
}

/**
 * Состояние трекинга: пишется ли он прямо сейчас и что мешает, если нет.
 * Без этого состояния поломка выглядит как «работающее приложение с пустой лентой»,
 * поэтому UI обязан показывать её явно.
 */
export type TrackingBlockReason = 'accessibility' | 'bundle-integrity' | 'window-access'

export interface TrackingHealthStatus {
  /** Трекер пишет данные прямо сейчас */
  tracking: boolean
  /** Что мешает, если tracking=false */
  blockedBy: TrackingBlockReason | null
  /** Путь к бандлу — показываем, когда подпись не проходит проверку */
  bundlePath: string | null
}

// IPC channel names — single source of truth
export const IPC_CHANNELS = {
  ACTIVITIES_GET_DAY: 'activities:getDay',
  ACTIVITIES_GET_RANGE: 'activities:getRange',
  ACTIVITIES_GET_SUMMARY: 'activities:getSummary',
  ACTIVITIES_GET_SUMMARY_DETAILED: 'activities:getSummaryDetailed',
  STATS_GET_DAILY: 'stats:getDaily',
  STATS_GET_TOP_APPS: 'stats:getTopApps',
  STATS_GET_HEATMAP: 'stats:getHeatmap',
  STATS_GET_TAG_STATS: 'stats:getTagStats',
  STATS_GET_WORK: 'stats:getWork',
  STATS_GET_TASKS: 'stats:getTasks',
  STATS_GET_WORK_BY_DAY: 'stats:getWorkByDay',
  ACTIVITIES_GET_AFK_TIME: 'activities:getAfkTime',
  ACTIVITIES_GET_DAY_COVERAGE: 'activities:getDayCoverage',
  ACTIVITIES_GET_UNTAGGED: 'activities:getUntagged',
  MEETINGS_GET_DAY: 'meetings:getDay',
  MEETINGS_GET_RANGE: 'meetings:getRange',
  CATEGORIES_GET_ALL: 'categories:getAll',
  CATEGORIES_UPSERT: 'categories:upsert',
  CATEGORIES_DELETE: 'categories:delete',
  RULES_GET_ALL: 'rules:getAll',
  RULES_UPSERT: 'rules:upsert',
  RULES_DELETE: 'rules:delete',
  RULES_GET_USAGE: 'rules:getUsage',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  TRACKING_GET_CURRENT: 'tracking:getCurrent',
  TRACKING_PAUSE: 'tracking:pause',
  TRACKING_RESUME: 'tracking:resume',
  EXPORT_CSV: 'export:csv',
  EXPORT_JSON: 'export:json',
  REPORT_COPY_WEEK: 'report:copyWeek',
  APPS_GET_ICON: 'apps:getIcon',
  TAGS_GET_ALL: 'tags:getAll',
  TAGS_SET: 'tags:set',
  TAGS_DELETE: 'tags:delete',
  HEALTH_GET_STATUS: 'health:getStatus',
  HEALTH_OPEN_ACCESSIBILITY_SETTINGS: 'health:openAccessibilitySettings',
  HEALTH_CHANGED: 'health:changed'
} as const

export type IpcChannel = typeof IPC_CHANNELS[keyof typeof IPC_CHANNELS]

// API exposed to renderer via contextBridge
export interface TimeTrackerApi {
  tracking: {
    getCurrent: () => Promise<CurrentActivity | null>
    pause: () => Promise<void>
    resume: () => Promise<void>
    onActivityChanged: (callback: (activity: CurrentActivity) => void) => () => void
  }
  activities: {
    getDay: (date: string) => Promise<ActivityEvent[]>
    getRange: (from: string, to: string) => Promise<ActivityEvent[]>
    getSummary: (date: string) => Promise<DaySummary[]>
    getSummaryDetailed: (date: string) => Promise<DetailedDaySummary[]>
    getAfkTime: (date: string) => Promise<number>
    getDayCoverage: (date: string) => Promise<DayCoverage>
    getUntagged: (date: string) => Promise<UntaggedEntry[]>
  }
  meetings: {
    getDay: (date: string) => Promise<Meeting[]>
    getRange: (from: string, to: string) => Promise<Meeting[]>
  }
  stats: {
    getDaily: (days: number) => Promise<DailyStat[]>
    getTopApps: (from: string, to: string, limit?: number) => Promise<DaySummary[]>
    getHeatmap: (from: string, to: string) => Promise<HeatmapCell[]>
    getTagStats: (from: string, to: string) => Promise<TagStat[]>
    getWork: (from: string, to: string) => Promise<WorkAppStat[]>
    getTasks: (from: string, to: string) => Promise<TaskStat[]>
    getWorkByDay: (from: string, to: string) => Promise<WorkDayStat[]>
  }
  categories: {
    getAll: () => Promise<Category[]>
    upsert: (category: Partial<Category>) => Promise<Category>
    delete: (id: number) => Promise<void>
  }
  rules: {
    getAll: () => Promise<CategoryRule[]>
    upsert: (rule: Partial<CategoryRule>) => Promise<CategoryRule>
    delete: (id: number) => Promise<void>
    getUsage: (date: string) => Promise<RuleUsage[]>
  }
  settings: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
  }
  export: {
    csv: (from: string, to: string) => Promise<string>
    json: (from: string, to: string) => Promise<string>
  }
  report: {
    /** Собирает текстовый отчёт за период, кладёт в буфер и возвращает его */
    copyWeek: (from: string, to: string) => Promise<string>
  }
  apps: {
    getIcon: (appName: string, bundleId?: string) => Promise<string | null>
  }
  tags: {
    getAll: () => Promise<AppTag[]>
    set: (targetType: TagTargetType, targetKey: string, tag: TagType) => Promise<AppTag>
    delete: (targetType: TagTargetType, targetKey: string) => Promise<void>
  }
  health: {
    getStatus: () => Promise<TrackingHealthStatus>
    openAccessibilitySettings: () => Promise<void>
    onChanged: (callback: (status: TrackingHealthStatus) => void) => () => void
  }
}
