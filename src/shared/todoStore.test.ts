import { describe, it, expect, beforeEach } from 'vitest'
import { groupTodos, addTodo, toggleTodo, editTodo, deleteTodo, isOverdue } from './todoStore'
import type { Todo } from './types'

const NOW = 1_700_000_000_000
const seq = { i: 0, gen: () => `id-${++seq.i}` }

/** 构造一条完整 Todo，用 over 覆盖个别字段 */
const mk = (over: Partial<Todo> = {}): Todo => ({
  id: 'x',
  title: 't',
  priority: 'normal',
  done: false,
  createdAt: NOW,
  source: 'manual',
  ...over
})

describe('groupTodos', () => {
  it('逾期且未完成的进 overdue；今天/未来进 upcoming（按 dueAt 升序）；无 dueAt 进 undated', () => {
    const todos: Todo[] = [
      {
        id: 'a',
        title: '过期',
        dueAt: NOW - 1000,
        priority: 'normal',
        done: false,
        createdAt: NOW,
        source: 'manual'
      },
      {
        id: 'b',
        title: '明天',
        dueAt: NOW + 86_400_000,
        priority: 'normal',
        done: false,
        createdAt: NOW,
        source: 'manual'
      },
      {
        id: 'c',
        title: '没日期',
        priority: 'normal',
        done: false,
        createdAt: NOW,
        source: 'manual'
      },
      {
        id: 'd',
        title: '过期但已完成',
        dueAt: NOW - 1000,
        priority: 'normal',
        done: true,
        completedAt: NOW,
        createdAt: NOW,
        source: 'manual'
      }
    ]
    const g = groupTodos(todos, NOW)
    expect(g.overdue.map((t) => t.id)).toEqual(['a'])
    expect(g.upcoming.map((t) => t.id)).toEqual(['b'])
    expect(g.undated.map((t) => t.id)).toEqual(['c'])
  })

  it('upcoming 按时间升序排序', () => {
    const todos: Todo[] = [
      mk({ id: 'far', title: '后天', dueAt: NOW + 2 * 86_400_000 }),
      mk({ id: 'near', title: '明天', dueAt: NOW + 86_400_000 })
    ]
    const g = groupTodos(todos, NOW)
    expect(g.upcoming.map((t) => t.id)).toEqual(['near', 'far'])
  })

  it('dueAt 恰好等于 now 的未完成项进 upcoming（>= 边界）', () => {
    const todos: Todo[] = [mk({ id: 'edge', dueAt: NOW })]
    const g = groupTodos(todos, NOW)
    expect(g.overdue).toEqual([])
    expect(g.upcoming.map((t) => t.id)).toEqual(['edge'])
  })

  it('不改入参：分组与排序均在副本上进行', () => {
    const todos: Todo[] = [
      mk({ id: 'far', dueAt: NOW + 2 * 86_400_000 }),
      mk({ id: 'near', dueAt: NOW + 86_400_000 }),
      mk({ id: 'past', dueAt: NOW - 1 })
    ]
    const snapshot = [...todos]
    groupTodos(todos, NOW)
    expect(todos).toEqual(snapshot)
    expect(todos.map((t) => t.id)).toEqual(['far', 'near', 'past'])
  })
})

describe('addTodo/toggleTodo', () => {
  beforeEach(() => {
    seq.i = 0
  })

  it('addTodo 生成完整字段且默认 priority=normal source=manual', () => {
    const out = addTodo([], { title: '  写周报  ', dueAt: NOW + 1000 }, NOW, seq.gen)
    expect(out).toHaveLength(1)
    const t = out[0]
    expect(t.id).toBe('id-1')
    expect(t.title).toBe('写周报')
    expect(t.priority).toBe('normal')
    expect(t.done).toBe(false)
    expect(t.source).toBe('manual')
    expect(t.createdAt).toBe(NOW)
    expect(t.dueAt).toBe(NOW + 1000)
    expect(t.notes).toBeUndefined()
    expect(t.completedAt).toBeUndefined()
  })

  it('addTodo 显式指定 priority/source/notes 时覆盖默认值', () => {
    const out = addTodo(
      [],
      { title: '提醒我开会', priority: 'high', source: 'ai', notes: '带笔记本' },
      NOW,
      seq.gen
    )
    expect(out[0]).toMatchObject({
      title: '提醒我开会',
      priority: 'high',
      source: 'ai',
      notes: '带笔记本',
      done: false,
      createdAt: NOW
    })
    expect(out[0].dueAt).toBeUndefined()
  })

  it('addTodo 标题 trim 后为空时抛 Error("title required")', () => {
    expect(() => addTodo([], { title: '   ' }, NOW, seq.gen)).toThrow('title required')
    expect(() => addTodo([], { title: '' }, NOW, seq.gen)).toThrow('title required')
  })

  it('addTodo 追加到末尾且不改入参', () => {
    const existing: Todo[] = [mk({ id: 'old' })]
    const out = addTodo(existing, { title: '新任务' }, NOW, () => 'new-1')
    expect(out.map((t) => t.id)).toEqual(['old', 'new-1'])
    expect(existing.map((t) => t.id)).toEqual(['old'])
  })

  it('toggleTodo 置 done 并写 completedAt；再 toggle 清除', () => {
    const todos: Todo[] = [mk({ id: 'a' })]
    const done = toggleTodo(todos, 'a', NOW + 5)
    expect(done[0].done).toBe(true)
    expect(done[0].completedAt).toBe(NOW + 5)
    expect(todos[0].done).toBe(false) // 入参不变
    const undone = toggleTodo(done, 'a', NOW + 10)
    expect(undone[0].done).toBe(false)
    expect(undone[0].completedAt).toBeUndefined()
  })

  it('toggleTodo 未知 id 返回内容不变的新数组', () => {
    const todos: Todo[] = [mk({ id: 'a' }), mk({ id: 'b' })]
    const out = toggleTodo(todos, 'zz', NOW)
    expect(out).not.toBe(todos)
    expect(out).toEqual(todos)
  })
})

describe('editTodo/deleteTodo', () => {
  it('editTodo 应用 patch 且不影响其他项', () => {
    const todos: Todo[] = [mk({ id: 'a', title: '旧标题', priority: 'low' }), mk({ id: 'b' })]
    const out = editTodo(todos, 'a', {
      title: '新标题',
      priority: 'high',
      notes: '备注',
      dueAt: NOW + 1
    })
    expect(out[0]).toMatchObject({
      id: 'a',
      title: '新标题',
      priority: 'high',
      notes: '备注',
      dueAt: NOW + 1,
      done: false,
      createdAt: NOW,
      source: 'manual'
    })
    expect(out[1]).toEqual(todos[1])
    expect(todos[0].title).toBe('旧标题') // 入参不变
  })

  it('editTodo patch 为空对象时返回原数组引用', () => {
    const todos: Todo[] = [mk({ id: 'a' })]
    expect(editTodo(todos, 'a', {})).toBe(todos)
  })

  it('deleteTodo 按 id 移除且不改入参', () => {
    const todos: Todo[] = [mk({ id: 'a' }), mk({ id: 'b' })]
    const out = deleteTodo(todos, 'a')
    expect(out.map((t) => t.id)).toEqual(['b'])
    expect(todos.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('deleteTodo 未知 id 返回内容不变', () => {
    const todos: Todo[] = [mk({ id: 'a' })]
    expect(deleteTodo(todos, 'zz')).toEqual(todos)
  })
})

describe('isOverdue', () => {
  it('done 的永不逾期；无 dueAt 的不逾期', () => {
    expect(isOverdue(mk({ done: true, completedAt: NOW, dueAt: NOW - 1 }), NOW)).toBe(false)
    expect(isOverdue(mk({}), NOW)).toBe(false)
  })

  it('未完成且 dueAt < now 才逾期（=now 不算）', () => {
    expect(isOverdue(mk({ dueAt: NOW - 1 }), NOW)).toBe(true)
    expect(isOverdue(mk({ dueAt: NOW }), NOW)).toBe(false)
    expect(isOverdue(mk({ dueAt: NOW + 1 }), NOW)).toBe(false)
  })
})
