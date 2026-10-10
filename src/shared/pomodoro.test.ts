import { describe, it, expect } from 'vitest'
import { POMO_IDLE, pomoStart, pomoStop, pomoTick } from './pomodoro'
import type { PomoState } from './pomodoro'

const NOW = 1_700_000_000_000
const MIN = 60_000

const focusState = (over: Partial<PomoState> = {}): PomoState => ({
  phase: 'focus',
  phaseEndsAt: NOW + 25 * MIN,
  focusCount: 0,
  ...over
})

// 规则：start 任何 phase → focus（phaseEndsAt = now + focusMin*60000，focusCount 不变）；
// tick 未到期（now < phaseEndsAt）→ 原状态引用 + null；focus 到期 → rest + 'focusEnd'；
// rest 到期 → idle + focusCount+1 + 'restEnd'；idle tick → 原样 + null；
// stop → idle（phaseEndsAt 归 0，focusCount 保留，中止不清零当日已完成数）。

describe('POMO_IDLE 初始态', () => {
  it('导出 { phase: idle, phaseEndsAt: 0, focusCount: 0 }', () => {
    expect(POMO_IDLE).toEqual({ phase: 'idle', phaseEndsAt: 0, focusCount: 0 })
  })
})

describe('pomoStart', () => {
  it('idle → focus：phaseEndsAt = now + focusMin*60000，focusCount 不变', () => {
    expect(pomoStart(POMO_IDLE, NOW, 25)).toEqual({
      phase: 'focus',
      phaseEndsAt: NOW + 25 * MIN,
      focusCount: 0
    })
  })

  it('rest → focus：任何 phase 调用都进入 focus，已完成计数保留', () => {
    const rest: PomoState = { phase: 'rest', phaseEndsAt: NOW + 5 * MIN, focusCount: 2 }
    expect(pomoStart(rest, NOW, 25)).toEqual({
      phase: 'focus',
      phaseEndsAt: NOW + 25 * MIN,
      focusCount: 2
    })
  })

  it('focus 中再次 start → 重新进入 focus 并刷新 phaseEndsAt', () => {
    const s = pomoStart(focusState(), NOW + 10 * MIN, 25)
    expect(s).toEqual({ phase: 'focus', phaseEndsAt: NOW + 35 * MIN, focusCount: 0 })
  })
})

describe('pomoTick', () => {
  it('idle 的 tick → 原样（同一引用）+ event null', () => {
    const r = pomoTick(POMO_IDLE, NOW, 25, 5)
    expect(r.state).toBe(POMO_IDLE)
    expect(r.event).toBeNull()
  })

  it('focus 未到期 → 原样（同一引用）+ null', () => {
    const s = focusState()
    const r = pomoTick(s, NOW + 24 * MIN, 25, 5)
    expect(r.state).toBe(s)
    expect(r.event).toBeNull()
  })

  it('rest 未到期 → 原样（同一引用）+ null', () => {
    const s: PomoState = { phase: 'rest', phaseEndsAt: NOW + 5 * MIN, focusCount: 1 }
    const r = pomoTick(s, NOW + 4 * MIN, 25, 5)
    expect(r.state).toBe(s)
    expect(r.event).toBeNull()
  })

  it('focus 恰好到期（now == phaseEndsAt）→ rest + focusEnd，rest 时长从当前 now 起算', () => {
    const s = focusState()
    const r = pomoTick(s, s.phaseEndsAt, 25, 5)
    expect(r.event).toBe('focusEnd')
    expect(r.state).toEqual({ phase: 'rest', phaseEndsAt: s.phaseEndsAt + 5 * MIN, focusCount: 0 })
  })

  it('focus 超时到期（30s 扫描滞后）→ 同样转 rest，phaseEndsAt 基于当前 now', () => {
    const s = focusState()
    const late = s.phaseEndsAt + 2 * MIN
    const r = pomoTick(s, late, 25, 5)
    expect(r.event).toBe('focusEnd')
    expect(r.state).toEqual({ phase: 'rest', phaseEndsAt: late + 5 * MIN, focusCount: 0 })
  })

  it('rest 到期 → idle + restEnd：focusCount+1，phaseEndsAt 归 0', () => {
    const s: PomoState = { phase: 'rest', phaseEndsAt: NOW + 5 * MIN, focusCount: 1 }
    const r = pomoTick(s, NOW + 5 * MIN, 25, 5)
    expect(r.event).toBe('restEnd')
    expect(r.state).toEqual({ phase: 'idle', phaseEndsAt: 0, focusCount: 2 })
  })
})

describe('pomoStop', () => {
  it('focus 中止 → idle，focusCount 保留，phaseEndsAt 归 0', () => {
    expect(pomoStop(focusState({ focusCount: 2 }))).toEqual({
      phase: 'idle',
      phaseEndsAt: 0,
      focusCount: 2
    })
  })

  it('rest 中止 → idle，计数同样保留（未走完的 rest 不 +1）', () => {
    const s: PomoState = { phase: 'rest', phaseEndsAt: NOW + 5 * MIN, focusCount: 1 }
    expect(pomoStop(s)).toEqual({ phase: 'idle', phaseEndsAt: 0, focusCount: 1 })
  })

  it('idle 再 stop → 仍是 idle 初值形态', () => {
    expect(pomoStop(POMO_IDLE)).toEqual(POMO_IDLE)
  })
})

describe('完整周期与退化', () => {
  it('idle → focus →(到期) rest →(到期) idle：一个完整番茄 focusCount=1，再 start 不清零', () => {
    const t0 = NOW
    const focus = pomoStart(POMO_IDLE, t0, 25)
    const r1 = pomoTick(focus, t0 + 25 * MIN, 25, 5) // focusEnd
    expect(r1.event).toBe('focusEnd')
    const r2 = pomoTick(r1.state, t0 + 30 * MIN, 25, 5) // restEnd
    expect(r2.event).toBe('restEnd')
    expect(r2.state).toEqual({ phase: 'idle', phaseEndsAt: 0, focusCount: 1 })
    // 第二轮：计数跨周期保留
    expect(pomoStart(r2.state, t0 + 31 * MIN, 25)).toEqual({
      phase: 'focus',
      phaseEndsAt: t0 + 56 * MIN,
      focusCount: 1
    })
  })

  it('focusMin=0 / restMin=0 退化：起止同刻，tick 立即推进', () => {
    const focus = pomoStart(POMO_IDLE, NOW, 0)
    expect(focus.phaseEndsAt).toBe(NOW) // 0 分钟：立即到期
    const r1 = pomoTick(focus, NOW, 0, 0) // rest 也按 0 分钟起算
    expect(r1.event).toBe('focusEnd')
    expect(r1.state).toEqual({ phase: 'rest', phaseEndsAt: NOW, focusCount: 0 })
    const r2 = pomoTick(r1.state, NOW, 0, 0) // restMin=0：同样同刻到期
    expect(r2.event).toBe('restEnd')
    expect(r2.state).toEqual({ phase: 'idle', phaseEndsAt: 0, focusCount: 1 })
  })
})
