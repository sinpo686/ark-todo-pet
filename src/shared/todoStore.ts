/** TodoStore 纯逻辑：不可变风格（一律返回新数组、不改入参），无 IO、无 electron / node 依赖 */

import type { Priority, Todo, TodoGroup } from './types'

export type AddTodoInput = {
  title: string
  dueAt?: number
  priority?: Priority
  notes?: string
  source?: 'manual' | 'ai'
}

/** 单条是否逾期：已完成或无 dueAt 恒为不逾期；dueAt >= now 不算逾期 */
export function isOverdue(t: Todo, now: number): boolean {
  if (t.done) return false
  if (t.dueAt === undefined) return false
  return t.dueAt < now
}

/**
 * 未完成事项分为三组：
 * - overdue：未完成且 dueAt < now（保持入参顺序）
 * - upcoming：未完成且 dueAt >= now（含今天剩余时间与未来，按 dueAt 升序）
 * - undated：未完成且无 dueAt（保持入参顺序）
 * 已完成事项不出现在任何组。
 */
export function groupTodos(todos: Todo[], now: number): TodoGroup {
  const overdue: Todo[] = []
  const upcoming: Todo[] = []
  const undated: Todo[] = []
  for (const t of todos) {
    if (t.done) continue
    if (t.dueAt === undefined) undated.push(t)
    else if (isOverdue(t, now)) overdue.push(t)
    else upcoming.push(t)
  }
  upcoming.sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0))
  return { overdue, upcoming, undated }
}

/** 新增：title trim 后非空否则抛 Error('title required')；默认 priority=normal / source=manual / done=false */
export function addTodo(
  todos: Todo[],
  input: AddTodoInput,
  now: number,
  idGen: () => string
): Todo[] {
  const title = input.title.trim()
  if (!title) throw new Error('title required')
  const todo: Todo = {
    id: idGen(),
    title,
    priority: input.priority ?? 'normal',
    done: false,
    createdAt: now,
    source: input.source ?? 'manual'
  }
  if (input.notes !== undefined) todo.notes = input.notes
  if (input.dueAt !== undefined) todo.dueAt = input.dueAt
  return [...todos, todo]
}

/** 完成态切换：置 done 时写 completedAt=now，取消完成时清除 completedAt */
export function toggleTodo(todos: Todo[], id: string, now: number): Todo[] {
  return todos.map((t) => {
    if (t.id !== id) return t
    if (t.done) {
      const { completedAt: _cleared, ...rest } = t
      return { ...rest, done: false }
    }
    return { ...t, done: true, completedAt: now }
  })
}

/** 编辑标题/备注/截止时间/优先级；patch 为空对象时返回原数组引用 */
export function editTodo(
  todos: Todo[],
  id: string,
  patch: Partial<Pick<Todo, 'title' | 'notes' | 'dueAt' | 'priority'>>
): Todo[] {
  if (Object.keys(patch).length === 0) return todos
  return todos.map((t) => {
    if (t.id !== id) return t
    const next: Todo = { ...t }
    if (patch.title !== undefined) next.title = patch.title
    if (patch.notes !== undefined) next.notes = patch.notes
    if (patch.dueAt !== undefined) next.dueAt = patch.dueAt
    if (patch.priority !== undefined) next.priority = patch.priority
    return next
  })
}

/** 删除：按 id 过滤，未知 id 时内容不变 */
export function deleteTodo(todos: Todo[], id: string): Todo[] {
  return todos.filter((t) => t.id !== id)
}
