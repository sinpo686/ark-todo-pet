/** aiTools 纯逻辑测试：schema 形状、时间解析、参数校验、关键词匹配。 */

import { describe, it, expect } from 'vitest'
import { AI_TOOLS, parseDueAtInput, validateAddArgs, completeByKeyword } from './aiTools'
import type { Todo } from './types'

const NOW = new Date(2026, 9, 11, 12, 0).getTime()

const mkTodo = (over: Partial<Todo> = {}): Todo => ({
  id: 'x',
  title: '默认标题',
  priority: 'normal',
  done: false,
  createdAt: NOW,
  source: 'manual',
  ...over
})

describe('AI_TOOLS schema', () => {
  it('三个工具，名字与 required 正确', () => {
    expect(AI_TOOLS.map((t) => t.function.name)).toEqual(['add_todo', 'list_todos', 'complete_todo'])
    expect(AI_TOOLS[0].function.parameters.required).toEqual(['title'])
    expect(AI_TOOLS[2].function.parameters.required).toEqual(['keyword'])
  })
})

describe('parseDueAtInput', () => {
  it('ISO 8601 带时区', () => {
    expect(parseDueAtInput('2026-10-12T15:00:00+08:00', NOW)).toBe(
      new Date('2026-10-12T15:00:00+08:00').getTime()
    )
  })
  it('"YYYY-MM-DD HH:mm" 本地时间', () => {
    expect(parseDueAtInput('2026-10-12 15:30', NOW)).toBe(new Date(2026, 9, 12, 15, 30).getTime())
  })
  it('"YYYY-MM-DD HH:mm:ss"', () => {
    expect(parseDueAtInput('2026-10-12 15:30:45', NOW)).toBe(
      new Date(2026, 9, 12, 15, 30, 45).getTime()
    )
  })
  it('undefined / 空串 / 垃圾输入 → undefined', () => {
    expect(parseDueAtInput(undefined, NOW)).toBeUndefined()
    expect(parseDueAtInput('  ', NOW)).toBeUndefined()
    expect(parseDueAtInput('明天下午', NOW)).toBeUndefined()
  })
  it('超出合理范围的 ISO（10 年外）→ undefined', () => {
    expect(parseDueAtInput('1999-01-01T00:00:00Z', NOW)).toBeUndefined()
  })
})

describe('validateAddArgs', () => {
  it('最小合法：仅 title，默认 priority=normal', () => {
    const r = validateAddArgs({ title: ' 交报告 ' }, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.title).toBe('交报告')
      expect(r.value.priority).toBe('normal')
      expect(r.value.dueAt).toBeUndefined()
    }
  })
  it('全字段合法', () => {
    const r = validateAddArgs(
      { title: '交报告', due_at: '2026-10-12 15:00', priority: 'high', notes: ' 记得盖章 ' },
      NOW
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.dueAt).toBe(new Date(2026, 9, 12, 15, 0).getTime())
      expect(r.value.priority).toBe('high')
      expect(r.value.notes).toBe('记得盖章')
    }
  })
  it('缺 title / 空 title → 拒绝', () => {
    expect(validateAddArgs({}, NOW).ok).toBe(false)
    expect(validateAddArgs({ title: '   ' }, NOW).ok).toBe(false)
    expect(validateAddArgs('不是对象', NOW).ok).toBe(false)
  })
  it('非法 priority → 拒绝；不可解析 due_at → 忽略时间不报错', () => {
    expect(validateAddArgs({ title: 'x', priority: 'urgent' }, NOW).ok).toBe(false)
    const r = validateAddArgs({ title: 'x', due_at: '随便' }, NOW)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.dueAt).toBeUndefined()
  })
})

describe('completeByKeyword', () => {
  it('唯一命中', () => {
    const todos = [mkTodo({ id: 'a', title: '交季度报告' }), mkTodo({ id: 'b', title: '买咖啡豆' })]
    expect(completeByKeyword(todos, '报告').matched.map((t) => t.id)).toEqual(['a'])
  })
  it('大小写不敏感；多命中全部返回；零命中空', () => {
    const todos = [
      mkTodo({ id: 'a', title: 'Buy Coffee' }),
      mkTodo({ id: 'b', title: 'buy milk' }),
      mkTodo({ id: 'c', title: '交报告', done: true, completedAt: NOW })
    ]
    expect(completeByKeyword(todos, 'BUY').matched.map((t) => t.id)).toEqual(['a', 'b'])
    expect(completeByKeyword(todos, '不存在').matched).toEqual([])
  })
  it('已完成的不参与匹配；空关键词空', () => {
    const todos = [mkTodo({ id: 'c', title: '交报告', done: true, completedAt: NOW })]
    expect(completeByKeyword(todos, '报告').matched).toEqual([])
    expect(completeByKeyword(todos, '  ').matched).toEqual([])
  })
})
