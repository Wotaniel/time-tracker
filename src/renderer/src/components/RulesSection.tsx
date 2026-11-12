import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Category, CategoryRule, RuleUsage } from '../../../shared/types'

/**
 * Правила и категории.
 *
 * API к ним существовал с самого начала (categories:*, rules:*), но
 * пользовательского входа не было: категории наливались миграцией, а правила
 * нельзя было ни увидеть, ни поправить. Теперь это замкнутый круг с очередью
 * «без тега»: размеченный вручную домен → правило → та же категория впредь
 * проставляется автоматически.
 */

const FIELDS: { value: CategoryRule['field']; label: string }[] = [
  { value: 'app_name', label: 'приложение' },
  { value: 'window_title', label: 'заголовок окна' },
  { value: 'url', label: 'адрес' },
  { value: 'app_bundle', label: 'bundle id' }
]

const MATCH_TYPES: { value: CategoryRule['matchType']; label: string }[] = [
  { value: 'contains', label: 'содержит' },
  { value: 'equals', label: 'равно' },
  { value: 'startsWith', label: 'начинается с' },
  { value: 'regex', label: 'regex' }
]

const PRODUCTIVITY_LABEL: Record<number, string> = {
  [-2]: 'сильно отвлекает',
  [-1]: 'отвлекает',
  [0]: 'нейтрально',
  [1]: 'полезно',
  [2]: 'работа'
}

export function RulesSection(): JSX.Element {
  const [categories, setCategories] = useState<Category[]>([])
  const [rules, setRules] = useState<CategoryRule[]>([])
  const [newCategory, setNewCategory] = useState('')
  const [ruleCategory, setRuleCategory] = useState<number | null>(null)
  const [ruleField, setRuleField] = useState<CategoryRule['field']>('app_name')
  const [ruleMatch, setRuleMatch] = useState<CategoryRule['matchType']>('contains')
  const [ruleValue, setRuleValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<RuleUsage[]>([])

  const reload = (): void => {
    const today = new Date()
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate()
    ).padStart(2, '0')}`

    Promise.all([
      window.api.categories.getAll(),
      window.api.rules.getAll(),
      window.api.rules.getUsage(date)
    ]).then(([c, r, u]) => {
      setCategories(c)
      setRules(r)
      setUsage(u)
      setRuleCategory((prev) => prev ?? c[0]?.id ?? null)
    })
  }

  useEffect(reload, [])

  const categoryName = (id: number): string =>
    categories.find((c) => c.id === id)?.name ?? '—'

  const usageFor = (ruleId: number): RuleUsage | undefined =>
    usage.find((u) => u.ruleId === ruleId)

  const addCategory = async (): Promise<void> => {
    const name = newCategory.trim()
    if (!name) return
    setError(null)
    try {
      await window.api.categories.upsert({ name, color: '#7aa2f7', productivity: 0, sortOrder: categories.length })
      setNewCategory('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const removeCategory = async (id: number): Promise<void> => {
    if (!window.confirm('Удалить категорию? Правила на неё тоже удалятся.')) return
    await window.api.categories.delete(id)
    reload()
  }

  const addRule = async (): Promise<void> => {
    const value = ruleValue.trim()
    if (!value || ruleCategory === null) return
    setError(null)
    try {
      await window.api.rules.upsert({
        categoryId: ruleCategory,
        field: ruleField,
        matchType: ruleMatch,
        value
      })
      setRuleValue('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const removeRule = async (id: number): Promise<void> => {
    await window.api.rules.delete(id)
    reload()
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xs font-medium uppercase tracking-wide text-tt-muted">Категории</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {categories.map((c) => (
            <span
              key={c.id}
              className="flex items-center gap-2 rounded-md border border-tt-border px-2 py-1 text-xs"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
              {c.name}
              <span className="text-[10px] text-tt-muted">
                {PRODUCTIVITY_LABEL[c.productivity] ?? c.productivity}
              </span>
              <button
                onClick={() => void removeCategory(c.id)}
                className="text-tt-muted hover:text-tt-red"
                title="Удалить категорию"
              >
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Новая категория"
            className="w-48 rounded-md border border-tt-border bg-tt-bg px-2 py-1 text-xs"
          />
          <button
            onClick={() => void addCategory()}
            className="flex items-center gap-1 rounded-md border border-tt-border px-2 py-1 text-xs hover:bg-tt-bg"
          >
            <Plus size={12} /> добавить
          </button>
        </div>
      </div>

      <div>
        <h2 className="text-xs font-medium uppercase tracking-wide text-tt-muted">
          Правила автоматизации
        </h2>
        <p className="mt-1 text-[11px] text-tt-muted">
          Первое совпавшее правило выигрывает. Справа — сколько раз правило сработало сегодня
          и сколько времени покрыло.
        </p>

        <div className="mt-2 divide-y divide-tt-border/50 rounded-md border border-tt-border">
          {rules.length === 0 && (
            <div className="px-3 py-3 text-xs text-tt-muted">Правил нет.</div>
          )}
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className="w-24 shrink-0 text-tt-muted">
                {FIELDS.find((f) => f.value === rule.field)?.label ?? rule.field}
              </span>
              <span className="w-24 shrink-0 text-tt-muted">
                {MATCH_TYPES.find((m) => m.value === rule.matchType)?.label ?? rule.matchType}
              </span>
              <span className="min-w-0 flex-1 truncate" title={rule.value}>
                {rule.value}
              </span>
              <span className="shrink-0 text-tt-accent">→ {categoryName(rule.categoryId)}</span>
              <span className="w-24 shrink-0 text-right text-[10px] text-tt-muted">
                {(() => {
                  const used = usageFor(rule.id)
                  if (!used) return 'не срабатывало'
                  const minutes = Math.round(used.seconds / 60)
                  return `${used.matches}× · ${minutes}м`
                })()}
              </span>
              <button
                onClick={() => void removeRule(rule.id)}
                className="shrink-0 text-tt-muted hover:text-tt-red"
                title="Удалить правило"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <select
            value={ruleCategory ?? ''}
            onChange={(e) => setRuleCategory(Number(e.target.value))}
            className="rounded-md border border-tt-border bg-tt-bg px-2 py-1"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={ruleField}
            onChange={(e) => setRuleField(e.target.value as CategoryRule['field'])}
            className="rounded-md border border-tt-border bg-tt-bg px-2 py-1"
          >
            {FIELDS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            value={ruleMatch}
            onChange={(e) => setRuleMatch(e.target.value as CategoryRule['matchType'])}
            className="rounded-md border border-tt-border bg-tt-bg px-2 py-1"
          >
            {MATCH_TYPES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <input
            value={ruleValue}
            onChange={(e) => setRuleValue(e.target.value)}
            placeholder="значение"
            className="w-56 rounded-md border border-tt-border bg-tt-bg px-2 py-1"
          />
          <button
            onClick={() => void addRule()}
            className="flex items-center gap-1 rounded-md border border-tt-border px-2 py-1 hover:bg-tt-bg"
          >
            <Plus size={12} /> добавить правило
          </button>
        </div>

        {error && <p className="mt-2 text-xs text-tt-red">{error}</p>}
      </div>
    </section>
  )
}
