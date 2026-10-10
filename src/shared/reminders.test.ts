import { describe, it, expect } from 'vitest'
import { decideReminders } from './reminders'
import type { Todo } from './types'

const NOW = 1_700_000_000_000
const MIN = 60_000

const mk = (over: Partial<Todo> = {}): Todo => ({
  id: 'x',
  title: 't',
  priority: 'normal',
  done: false,
  createdAt: NOW,
  source: 'manual',
  ...over
})

// 规则：未完成且有 dueAt → now ≥ dueAt - leadMin*60000 发 lead（`${id}:lead` once）；
// now ≥ dueAt 发 due（`${id}:due` once）；两条件同周期同时满足只发 due（越线只发 due）；
// done / 无 dueAt 不发；事件顺序按 todos 数组序。

describe('decideReminders 触发规则', () => {
  it('lead 边界恰好触发：now == dueAt - lead*60000 → 只发 lead，不发 due', () => {
    const dueAt = NOW + 30 * MIN
    const events = decideReminders(
      [mk({ id: 'a', title: '写周报', dueAt })],
      dueAt - 10 * MIN,
      new Set(),
      10
    )
    expect(events).toEqual([{ todoId: 'a', title: '写周报', kind: 'lead' }])
  })

  it('lead 窗口内（已过提前线、未到 due）也只有 lead', () => {
    const dueAt = NOW + 30 * MIN
    const events = decideReminders([mk({ id: 'a', dueAt })], NOW + 25 * MIN, new Set(), 10)
    expect(events).toEqual([{ todoId: 'a', title: 't', kind: 'lead' }])
  })

  it('due 边界恰好触发：now == dueAt → 发 due（lead 已提醒过也照发）', () => {
    const dueAt = NOW + 30 * MIN
    const events = decideReminders([mk({ id: 'a', dueAt })], dueAt, new Set(['a:lead']), 10)
    expect(events).toEqual([{ todoId: 'a', title: 't', kind: 'due' }])
  })

  it('跨过 lead 窗口直接到 due（lead key 未提醒）→ 只发 due 不发 lead', () => {
    const dueAt = NOW + 30 * MIN
    const events = decideReminders([mk({ id: 'a', dueAt })], dueAt + 5 * MIN, new Set(), 10)
    expect(events).toEqual([{ todoId: 'a', title: 't', kind: 'due' }])
  })

  it('lead 已提醒过且仍在 lead 窗口 → 无事件', () => {
    const dueAt = NOW + 30 * MIN
    expect(
      decideReminders([mk({ id: 'a', dueAt })], NOW + 5 * MIN, new Set(['a:lead']), 10)
    ).toEqual([])
  })

  it('due 已提醒过 → 即使 lead key 未提醒也无事件（越线只发 due 的延续）', () => {
    const dueAt = NOW - 1 * MIN
    expect(decideReminders([mk({ id: 'a', dueAt })], NOW, new Set(['a:due']), 10)).toEqual([])
  })

  it('done 的不发（即使早已过期）', () => {
    expect(
      decideReminders([mk({ id: 'a', dueAt: NOW - 60 * MIN, done: true })], NOW, new Set(), 10)
    ).toEqual([])
  })

  it('无 dueAt 不发', () => {
    expect(decideReminders([mk({ id: 'a' })], NOW, new Set(), 10)).toEqual([])
  })

  it('多条同周期各自触发，顺序按 todos 数组序', () => {
    const todos = [
      mk({ id: 'a', title: 'A', dueAt: NOW }), // 恰好到 due
      mk({ id: 'b' }), // 无 dueAt
      mk({ id: 'c', dueAt: NOW - 5 * MIN, done: true }), // done（已过期）
      mk({ id: 'd', title: 'D', dueAt: NOW + 8 * MIN }) // lead 窗口内
    ]
    const events = decideReminders(todos, NOW, new Set(), 10)
    expect(events.map((e) => [e.todoId, e.kind])).toEqual([
      ['a', 'due'],
      ['d', 'lead']
    ])
  })

  it('leadMin=0 退化：now == dueAt 时 lead/due 条件同时满足 → 只发 due', () => {
    const dueAt = NOW + 5 * MIN
    expect(decideReminders([mk({ id: 'a', dueAt })], dueAt, new Set(), 0)).toEqual([
      { todoId: 'a', title: 't', kind: 'due' }
    ])
  })
})
