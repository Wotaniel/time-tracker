#!/usr/bin/env node
/**
 * Отчёт за день — машиночитаемые факты для утреннего дайджеста.
 *
 * Зачем отдельный CLI: приложению незачем знать про Slack и дейли, а агенту
 * дайджеста нужен стабильный вход. Скрипт читает базу только на чтение и
 * печатает либо markdown (для человека/промпта), либо JSON (для кода).
 *
 * Запуск (better-sqlite3 собран под ABI Electron, поэтому через Electron):
 *   npm run report:day                          # вчера
 *   npm run report:day -- --date 2026-11-11
 *   npm run report:day -- --format json
 *   npm run report:day -- --days 5              # пять последних дней
 */
const Database = require('better-sqlite3')
const { join } = require('path')
const { homedir } = require('os')

const DB_PATH =
  process.env.CARPEDIEM_DB || join(homedir(), 'Library/Application Support/CarpeDiem/timetracker.db')

function parseArgs(argv) {
  const args = { format: 'md', date: null, days: null }
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--format') args.format = argv[++i]
    else if (arg === '--date') args.date = argv[++i]
    else if (arg === '--days') args.days = Number(argv[++i])
  }
  return args
}

function localDate(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayBounds(date) {
  const [y, m, d] = date.split('-').map(Number)
  return { start: new Date(y, m - 1, d, 0, 0, 0, 0), end: new Date(y, m - 1, d, 23, 59, 59, 999) }
}

function domainOf(url) {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    const m = url.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9.-]+\.[a-z]{2,})/i)
    return m ? m[1] : null
  }
}

/** Код комнаты Meet: один звонок приходит разными ссылками */
function meetingCode(url) {
  if (!url) return null
  const match = url.match(/meet\.google\.com\/(?:meet\/)?([a-z0-9-]{6,})/i)
  return match ? match[1].toLowerCase() : null
}

/** Один и тот же звонок? Коды сравниваем, если есть у обоих; иначе — источник */
function sameCall(a, b) {
  const codeA = meetingCode(a.url)
  const codeB = meetingCode(b.url)
  if (codeA && codeB) return codeA === codeB
  return (a.source ?? '') === (b.source ?? '')
}

/**
 * Склеивает соседние интервалы одного созвона: перезапуск приложения рвёт
 * интервал, а Meet в фоне вообще не виден, поэтому сигнала может не быть
 * до 20 минут. Живёт по тем же правилам, что интерфейс (src/shared/meetings.ts).
 */
function mergeMeetings(rows) {
  const result = []
  for (const row of rows) {
    const last = result[result.length - 1]
    if (last && sameCall(last, row)) {
      const lastEnd = last.end ? new Date(last.end).getTime() : Date.now()
      const gap = new Date(row.start).getTime() - lastEnd
      if (gap >= 0 && gap <= 20 * 60 * 1000) {
        if (row.end && (!last.end || row.end > last.end)) last.end = row.end
        continue
      }
    }
    result.push({ ...row })
  }
  return result
}

function fmt(seconds) {
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h}ч ${m}м`
  return `${m}м`
}

function collect(db, date) {
  const { start, end } = dayBounds(date)
  const over = 'e.ts_start <= @end AND e.ts_end >= @start'
  const clamped =
    '(julianday(MIN(e.ts_end, @end)) - julianday(MAX(e.ts_start, @start))) * 86400'

  const coverage = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN e.is_afk = 0 THEN ${clamped} ELSE 0 END), 0) AS active,
        COALESCE(SUM(CASE WHEN e.is_afk = 1 THEN ${clamped} ELSE 0 END), 0) AS afk
      FROM events e WHERE ${over}
    `)
    .get({ start: start.toISOString(), end: end.toISOString() })

  // Охват считаем отдельным запросом: внутри одного SELECT нельзя смешивать
  // скалярные MIN/MAX (обрезку по границам дня) и агрегатные.
  const spanRow = db
    .prepare(`
      SELECT COALESCE((julianday(MAX(e)) - julianday(MIN(s))) * 86400, 0) AS span
      FROM (
        SELECT MAX(e.ts_start, @start) AS s, MIN(e.ts_end, @end) AS e
        FROM events e WHERE ${over}
      )
    `)
    .get({ start: start.toISOString(), end: end.toISOString() })

  const apps = db
    .prepare(`
      SELECT e.app_name AS app, SUM(${clamped}) AS seconds
      FROM events e WHERE ${over} AND e.is_afk = 0
      GROUP BY e.app_name ORDER BY seconds DESC
    `)
    .all({ start: start.toISOString(), end: end.toISOString() })

  const webRows = db
    .prepare(`
      SELECT e.url AS url, SUM(${clamped}) AS seconds
      FROM events e WHERE ${over} AND e.is_afk = 0 AND e.url IS NOT NULL AND e.url != ''
    `)
    .all({ start: start.toISOString(), end: end.toISOString() })

  const tasks = db
    .prepare(`
      SELECT e.task_key AS task, SUM(${clamped}) AS seconds, GROUP_CONCAT(DISTINCT e.app_name) AS apps
      FROM events e WHERE ${over} AND e.is_afk = 0 AND e.task_key IS NOT NULL
      GROUP BY e.task_key ORDER BY seconds DESC
    `)
    .all({ start: start.toISOString(), end: end.toISOString() })

  const meetings = db
    .prepare(`
      SELECT ts_start AS start, ts_end AS end, url, source, title FROM meetings
      WHERE ts_start <= @end AND COALESCE(ts_end, ts_start) >= @start
      ORDER BY ts_start
    `)
    .all({ start: start.toISOString(), end: end.toISOString() })

  const gaps = db
    .prepare(`
      WITH ordered AS (
        SELECT e.ts_end AS prev_end, LEAD(e.ts_start) OVER (ORDER BY e.ts_start) AS next_start
        FROM events e WHERE ${over}
      )
      SELECT prev_end, next_start,
             CAST(ROUND((julianday(next_start) - julianday(prev_end)) * 86400) AS INT) AS seconds
      FROM ordered
      WHERE next_start IS NOT NULL
        AND (julianday(next_start) - julianday(prev_end)) * 86400 > 900
      ORDER BY seconds DESC
    `)
    .all({ start: start.toISOString(), end: end.toISOString() })

  const domains = new Map()
  for (const row of webRows) {
    const domain = domainOf(row.url)
    if (!domain) continue
    domains.set(domain, (domains.get(domain) ?? 0) + row.seconds)
  }

  return {
    date,
    active: Math.round(coverage.active),
    afk: Math.round(coverage.afk),
    uncovered: Math.max(0, Math.round(spanRow.span) - Math.round(coverage.active) - Math.round(coverage.afk)),
    span: Math.round(spanRow.span),
    apps: apps.map((a) => ({ app: a.app, seconds: Math.round(a.seconds) })),
    domains: [...domains.entries()]
      .map(([domain, seconds]) => ({ domain, seconds: Math.round(seconds) }))
      .sort((a, b) => b.seconds - a.seconds),
    tasks: tasks.map((t) => ({
      task: t.task,
      seconds: Math.round(t.seconds),
      apps: String(t.apps || '').split(',')
    })),
    meetings: mergeMeetings(meetings).map((m) => ({
      start: m.start,
      end: m.end,
      source: m.source,
      title: m.title,
      minutes: Math.max(
        0,
        Math.round(((m.end ? new Date(m.end) : Date.now()) - new Date(m.start)) / 1000 / 60)
      )
    })),
    gaps: gaps.map((g) => ({ from: g.prev_end, to: g.next_start, seconds: g.seconds }))
  }
}

function toMarkdown(report) {
  const lines = []
  lines.push(`## ${report.date}`)
  lines.push('')
  lines.push(
    `Активность ${fmt(report.active)} · созвоны ${fmt(
      report.meetings.reduce((s, m) => s + m.minutes * 60, 0)
    )} · AFK ${fmt(report.afk)} · не записано ${fmt(report.uncovered)}`
  )
  lines.push('')

  if (report.tasks.length > 0) {
    lines.push('**Задачи (Jira):**')
    for (const t of report.tasks.slice(0, 8)) {
      lines.push(`- ${t.task} — ${fmt(t.seconds)}`)
    }
    lines.push('')
  }

  lines.push('**Где время:**')
  for (const a of report.apps.slice(0, 8)) {
    lines.push(`- ${a.app} — ${fmt(a.seconds)}`)
  }
  lines.push('')

  if (report.domains.length > 0) {
    lines.push('**Сайты:**')
    for (const d of report.domains.slice(0, 8)) {
      lines.push(`- ${d.domain} — ${fmt(d.seconds)}`)
    }
    lines.push('')
  }

  if (report.meetings.length > 0) {
    lines.push('**Созвоны:**')
    for (const m of report.meetings) {
      const label = m.title || m.source || 'созвон'
      lines.push(`- ${m.minutes} мин — ${label}`)
    }
    lines.push('')
  }

  if (report.gaps.length > 0) {
    lines.push('**Простои (нет событий):**')
    for (const g of report.gaps.slice(0, 5)) {
      lines.push(`- ${fmt(g.seconds)} — ${new Date(g.from).toLocaleTimeString('ru-RU')} → ${new Date(g.to).toLocaleTimeString('ru-RU')}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv)

  let dates = []
  if (args.days) {
    for (let i = args.days; i >= 1; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      dates.push(localDate(d))
    }
  } else if (args.date) {
    dates = [args.date]
  } else {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    dates = [localDate(d)]
  }

  const db = new Database(DB_PATH, { readonly: true })
  const reports = dates.map((date) => collect(db, date))
  db.close()

  if (args.format === 'json') {
    process.stdout.write(JSON.stringify(reports.length === 1 ? reports[0] : reports, null, 2) + '\n')
    return
  }

  process.stdout.write(reports.map(toMarkdown).join('\n'))
}

try {
  main()
} catch (err) {
  console.error(`[report:day] ${err.message}`)
  process.exit(1)
}
