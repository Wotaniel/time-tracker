/**
 * Category repository — категории и правила авто-категоризации.
 *
 * Ответственность:
 * - CRUD categories
 * - CRUD category_rules
 * - categorizeEvent() — применение правил к событию
 */
import type Database from 'better-sqlite3'
import type { Category, CategoryRule, RuleUsage } from '../../shared/types'
import {
  rowToCategory,
  rowToRule,
  localDayBounds,
  type RawCategoryRow,
  type RawRuleRow
} from './helpers'

export class CategoryRepository {
  constructor(private db: Database.Database) {}

  // ─── Categories ──────────────────────────────────────────────

  getAllCategories(): Category[] {
    const rows = this.db
      .prepare('SELECT * FROM categories ORDER BY sort_order ASC')
      .all() as RawCategoryRow[]
    return rows.map(rowToCategory)
  }

  getCategoryById(id: number): Category | undefined {
    const row = this.db
      .prepare('SELECT * FROM categories WHERE id = ?')
      .get(id) as RawCategoryRow | undefined
    return row ? rowToCategory(row) : undefined
  }

  getCategoryByName(name: string): Category | undefined {
    const row = this.db
      .prepare('SELECT * FROM categories WHERE name = ?')
      .get(name) as RawCategoryRow | undefined
    return row ? rowToCategory(row) : undefined
  }

  upsertCategory(category: Partial<Category>): Category {
    if (category.id) {
      this.db.prepare(`
        UPDATE categories
        SET name = COALESCE(@name, name),
            color = COALESCE(@color, color),
            productivity = COALESCE(@productivity, productivity),
            sort_order = COALESCE(@sortOrder, sort_order)
        WHERE id = @id
      `).run({
        id: category.id,
        name: category.name ?? null,
        color: category.color ?? null,
        productivity: category.productivity ?? null,
        sortOrder: category.sortOrder ?? null
      })
      return this.getCategoryById(category.id)!
    }

    const result = this.db.prepare(`
      INSERT INTO categories (name, color, productivity, sort_order)
      VALUES (@name, @color, @productivity, @sortOrder)
    `).run({
      name: category.name!,
      color: category.color ?? '#e0af68',
      productivity: category.productivity ?? 0,
      sortOrder: category.sortOrder ?? 0
    })
    return this.getCategoryById(Number(result.lastInsertRowid))!
  }

  deleteCategory(id: number): void {
    this.db.prepare('DELETE FROM categories WHERE id = ?').run(id)
  }

  // ─── Category Rules ──────────────────────────────────────────

  getCategoryRules(): CategoryRule[] {
    const rows = this.db
      .prepare('SELECT * FROM category_rules ORDER BY category_id, field')
      .all() as RawRuleRow[]
    return rows.map(rowToRule)
  }

  upsertRule(rule: Partial<CategoryRule>): CategoryRule {
    if (rule.id) {
      this.db.prepare(`
        UPDATE category_rules
        SET category_id = COALESCE(@categoryId, category_id),
            field = COALESCE(@field, field),
            match_type = COALESCE(@matchType, match_type),
            value = COALESCE(@value, value)
        WHERE id = @id
      `).run({
        id: rule.id,
        categoryId: rule.categoryId ?? null,
        field: rule.field ?? null,
        matchType: rule.matchType ?? null,
        value: rule.value ?? null
      })
      return this.getRuleById(rule.id)!
    }
    const result = this.db
      .prepare('INSERT INTO category_rules (category_id, field, match_type, value) VALUES (?, ?, ?, ?)')
      .run(rule.categoryId!, rule.field!, rule.matchType!, rule.value!)
    return this.getRuleById(Number(result.lastInsertRowid))!
  }

  deleteRule(id: number): void {
    this.db.prepare('DELETE FROM category_rules WHERE id = ?').run(id)
  }

  private getRuleById(id: number): CategoryRule | undefined {
    const row = this.db
      .prepare('SELECT * FROM category_rules WHERE id = ?')
      .get(id) as RawRuleRow | undefined
    return row ? rowToRule(row) : undefined
  }

  /**
   * Применяет правила к событию и возвращает category_id.
   * Первое совпавшее правило выигрывает (priority by insertion order).
   */
  categorizeEvent(
    appName: string,
    windowTitle: string,
    appBundleId?: string,
    url?: string | null
  ): number | null {
    const rules = this.db
      .prepare('SELECT * FROM category_rules ORDER BY id ASC')
      .all() as RawRuleRow[]

    for (const rule of rules) {
      let fieldValue: string
      switch (rule.field) {
        case 'app_name': fieldValue = appName; break
        case 'window_title': fieldValue = windowTitle; break
        case 'app_bundle': fieldValue = appBundleId ?? ''; break
        case 'url': fieldValue = url ?? ''; break
        default: continue
      }

      if (this.matchRule(rule.match_type, rule.value, fieldValue)) {
        return rule.category_id
      }
    }
    return null
  }

  /**
   * Проверяет совпадение значения по типу match.
   */
  /**
   * Сколько раз каждое правило сработало за день.
   *
   * Зачем: правила применяются при вставке события, и результата не видно
   * нигде — пользователь не понимает, работают они или нет. Здесь видно
   * и количество совпадений, и сколько времени они покрыли.
   */
  getRuleUsage(date: string): RuleUsage[] {
    const { start, end } = localDayBounds(date)
    const rules = this.db
      .prepare('SELECT * FROM category_rules ORDER BY id ASC')
      .all() as RawRuleRow[]

    const events = this.db
      .prepare(`
        SELECT app_name, window_title, app_bundle, url, duration
        FROM events
        WHERE ts_start <= ? AND ts_end >= ? AND is_afk = 0
      `)
      .all(end, start) as {
      app_name: string
      window_title: string
      app_bundle: string | null
      url: string | null
      duration: number
    }[]

    const usage = new Map<number, { matches: number; seconds: number }>()

    for (const event of events) {
      for (const rule of rules) {
        const fieldValue =
          rule.field === 'app_name'
            ? event.app_name
            : rule.field === 'window_title'
              ? event.window_title
              : rule.field === 'app_bundle'
                ? (event.app_bundle ?? '')
                : (event.url ?? '')

        if (this.matchRule(rule.match_type, rule.value, fieldValue)) {
          const current = usage.get(rule.id) ?? { matches: 0, seconds: 0 }
          current.matches += 1
          current.seconds += event.duration
          usage.set(rule.id, current)
          break
        }
      }
    }

    return [...usage.entries()].map(([ruleId, value]) => ({
      ruleId,
      matches: value.matches,
      seconds: value.seconds
    }))
  }

  private matchRule(matchType: string, pattern: string, value: string): boolean {
    switch (matchType) {
      case 'equals':
        return value.toLowerCase() === pattern.toLowerCase()
      case 'contains':
        return value.toLowerCase().includes(pattern.toLowerCase())
      case 'startsWith':
        return value.toLowerCase().startsWith(pattern.toLowerCase())
      case 'regex':
        try { return new RegExp(pattern, 'i').test(value) } catch { return false }
      default:
        return false
    }
  }
}
