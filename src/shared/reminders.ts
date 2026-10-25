/** 提醒判定器：由主进程外壳周期调用（30s 一次），对未完成待办决定本周期应发的提醒（纯函数，无 IO/定时器） */
import type { Todo } from './types'

export interface ReminderEvent {
  todoId: string
  title: string
  kind: 'lead' | 'due'
}

/**
 * 扫描未完成且有 dueAt 的待办，返回本周期应触发的事件（主进程发完通知后把对应 key 记入 reminded 集合）。
 * - key 约定：`${todoId}:lead` 与 `${todoId}:due`，已在 reminded 里的跳过（once 语义）
 * - now ≥ dueAt - leadMin*60000 且 lead 未提醒 → 发 lead
 * - now ≥ dueAt 且 due 未提醒 → 发 due
 * - lead 与 due 同一周期都满足条件时只发 due（越过 lead 窗口直接到 due 的不再补发 lead）
 * - done / 无 dueAt 的不发；事件顺序按 todos 数组序
 */
export function decideReminders(
  todos: Todo[],
  now: number,
  reminded: ReadonlySet<string>,
  leadMin: number
): ReminderEvent[] {
  const events: ReminderEvent[] = []
  for (const t of todos) {
    if (t.done || t.dueAt === undefined) continue
    const dueAt = t.dueAt
    if (now >= dueAt) {
      // 已到/越过 due：lead 窗口被覆盖，只考虑 due
      if (!reminded.has(`${t.id}:due`)) {
        events.push({ todoId: t.id, title: t.title, kind: 'due' })
      }
      continue
    }
    if (now >= dueAt - leadMin * 60_000 && !reminded.has(`${t.id}:lead`)) {
      events.push({ todoId: t.id, title: t.title, kind: 'lead' })
    }
  }
  return events
}

/** 每小时高优先级提醒（用户功能）：未完成 + priority=high；有截止的按时间升序在前，无截止的按创建时间垫底 */
export function pickHighPriorityList(todos: Todo[]): Todo[] {
  return todos
    .filter((t) => !t.done && t.priority === 'high')
    .sort((a, b) => {
      const ad = a.dueAt ?? Number.POSITIVE_INFINITY
      const bd = b.dueAt ?? Number.POSITIVE_INFINITY
      if (ad !== bd) return ad - bd
      return a.createdAt - b.createdAt
    })
}
