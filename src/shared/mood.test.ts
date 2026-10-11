import { describe, it, expect } from 'vitest'
import { computeMood, moodParams } from './mood'
import type { Todo } from './types'

const NOW = 1_700_000_000_000
const mk = (over: Partial<Todo> = {}): Todo => ({
  id: 'x',
  title: 't',
  priority: 'normal',
  done: false,
  createdAt: NOW,
  source: 'manual',
  ...over,
})

/** 相对 NOW 所在本地日的时刻：d 天偏移（0=今日，-1=昨日，1=明日）+ 小时 */
const at = (dayOffset: number, h: number): number => {
  const d = new Date(NOW)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, h).getTime()
}

// 规则：逾期未完成 n1≥3 或 (n1+n2)≥5 → gloomy；n1=0 且 今日到期未完成 n2=0 且 今日完成 n3>0 → happy；其余 normal
// focus 状态强制返回 'normal'（专注表现由状态机接管，mood 不参与）

describe('computeMood 规则（规格 §6.2）', () => {
  it('纯逾期×3（n1=3）→ gloomy', () => {
    const todos = [
      mk({ id: 'a', dueAt: at(-1, 23) }),
      mk({ id: 'b', dueAt: at(-3, 9) }),
      mk({ id: 'c', dueAt: at(-2, 12) }),
    ]
    expect(computeMood(todos, 'idle', NOW)).toBe('gloomy')
  })

  it('混合堆积×5（n1=2 + 今日到期 n2=3）→ gloomy；今日已过时刻不算逾期', () => {
    const todos = [
      mk({ id: 'a', dueAt: at(-1, 10) }),
      mk({ id: 'b', dueAt: at(-1, 23) }),
      // 以下三条今日到期：含时刻已早于 NOW 的一条——日界判断只看日期，仍是 n2 不是 n1
      mk({ id: 'c', dueAt: at(0, 0) }), // 今日 00:00（日界起点，含）
      mk({ id: 'd', dueAt: at(0, 5) }), // 今日凌晨（时刻已过）→ 不算逾期
      mk({ id: 'e', dueAt: at(0, 23) }),
    ]
    expect(computeMood(todos, 'idle', NOW)).toBe('gloomy')
    // n1=2（<3）单独不够 gloomy；明日到期不入 n2
    expect(computeMood(todos.slice(0, 4), 'idle', NOW)).toBe('normal')
  })

  it('清空 + 今日有完成（n1=0, n2=0, n3>0）→ happy；昨日完成与明日待办不影响', () => {
    const todos = [
      mk({ id: 'a', dueAt: at(-1, 10), done: true, completedAt: at(0, 9) }), // 今日完成（昨日到期但已完成）
      mk({ id: 'b', done: true, completedAt: at(-1, 20) }), // 昨日完成 → 不计入 n3
      mk({ id: 'c', dueAt: at(1, 10) }), // 明日到期未完成 → 不入 n1/n2
    ]
    expect(computeMood(todos, 'idle', NOW)).toBe('happy')
  })

  it('常规（n1=1 且 n3=1，未达阈值）→ normal；rest 按规则计算', () => {
    const todos = [
      mk({ id: 'a', dueAt: at(-1, 10) }), // 1 条逾期
      mk({ id: 'b', done: true, completedAt: at(0, 12) }), // 今日完成
      mk({ id: 'c' }), // 无日期未完成 → 不入任何计数
    ]
    // n1=1 ≠ 0 → 即使今日有完成也不是 happy
    expect(computeMood(todos, 'idle', NOW)).toBe('normal')
    expect(computeMood(todos, 'rest', NOW)).toBe('normal')
    // 全空 → normal（无完成记录不满足 happy）
    expect(computeMood([], 'idle', NOW)).toBe('normal')
  })

  it('focus 时即使堆积也 normal（rest 不豁免）', () => {
    const todos = [
      mk({ id: 'a', dueAt: at(-1, 9) }),
      mk({ id: 'b', dueAt: at(-2, 9) }),
      mk({ id: 'c', dueAt: at(-3, 9) }),
    ]
    expect(computeMood(todos, 'focus', NOW)).toBe('normal')
    expect(computeMood(todos, 'rest', NOW)).toBe('gloomy')
  })
})

describe('moodParams 各情绪参数', () => {
  it('happy → walkProbPerMin=3, idleSpecialProb=0.25', () => {
    const p = moodParams('happy')
    expect(p.walkProbPerMin).toBe(3)
    expect(p.idleSpecialProb).toBe(0.25)
  })

  it('normal → walkProbPerMin=1.5, idleSpecialProb=0.12', () => {
    const p = moodParams('normal')
    expect(p.walkProbPerMin).toBe(1.5)
    expect(p.idleSpecialProb).toBe(0.12)
  })

  it('gloomy → walkProbPerMin=0.3, idleSpecialProb=0.03', () => {
    const p = moodParams('gloomy')
    expect(p.walkProbPerMin).toBe(0.3)
    expect(p.idleSpecialProb).toBe(0.03)
  })
})
