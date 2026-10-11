/** 番茄钟状态机：纯 reducer，无定时器/时钟；时间一律由参数传入，由主进程外壳周期（30s）驱动 tick */

export type PomoPhase = 'idle' | 'focus' | 'rest'

export interface PomoState {
  phase: PomoPhase
  /** 当前阶段结束时刻（ms 时间戳）；idle 态恒为 0 */
  phaseEndsAt: number
  /** 今日已完整走完的番茄数（rest 到期 +1；中止不清零） */
  focusCount: number
}

/** 初始态常量 */
export const POMO_IDLE: PomoState = { phase: 'idle', phaseEndsAt: 0, focusCount: 0 }

/** 开始（或重新开始）专注：任何 phase 调用都进入 focus，focusCount 不变 */
export function pomoStart(s: PomoState, now: number, focusMin: number): PomoState {
  return { phase: 'focus', phaseEndsAt: now + focusMin * 60_000, focusCount: s.focusCount }
}

/**
 * 推进一个扫描周期：
 * - 未到期（now < phaseEndsAt）或 idle → 原状态引用原样返回 + event null
 * - focus 到期 → 进入 rest（phaseEndsAt = now + restMin*60000）+ event 'focusEnd'
 * - rest 到期 → 回 idle、focusCount+1、phaseEndsAt 归 0 + event 'restEnd'
 * （到期判定与休息时长都以当前 now 起算，容忍外壳扫描滞后）
 */
export function pomoTick(
  s: PomoState,
  now: number,
  focusMin: number,
  restMin: number
): { state: PomoState; event: null | 'focusEnd' | 'restEnd' } {
  // focusMin 仅为签名占位（保持四参约定）：focus 时长已在 pomoStart 时烘焙进 phaseEndsAt，tick 无需再读
  void focusMin
  if (now < s.phaseEndsAt) return { state: s, event: null }
  if (s.phase === 'focus') {
    return {
      state: { phase: 'rest', phaseEndsAt: now + restMin * 60_000, focusCount: s.focusCount },
      event: 'focusEnd'
    }
  }
  if (s.phase === 'rest') {
    return {
      state: { phase: 'idle', phaseEndsAt: 0, focusCount: s.focusCount + 1 },
      event: 'restEnd'
    }
  }
  return { state: s, event: null }
}

/** 手动中止：回 idle，phaseEndsAt 归 0；focusCount 保留（今日已完成计数不因中止清零） */
export function pomoStop(s: PomoState): PomoState {
  return { phase: 'idle', phaseEndsAt: 0, focusCount: s.focusCount }
}
