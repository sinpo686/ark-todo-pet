/** 情绪引擎：由待办完成情况推导桌宠心情（纯函数，无 IO，无第三方依赖） */
import type { Todo } from './types'

export type Mood = 'happy' | 'normal' | 'gloomy'

export interface MoodParams {
  /** 每分钟触发游走的概率 */
  walkProbPerMin: number
  /** 触发特殊待机动作的概率 */
  idleSpecialProb: number
}

/** 同一本地日 = 年月日相等（本地时区日界，与时刻无关） */
const sameDay = (a: number, b: number): boolean => {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

/**
 * 计算当前心情（规格 §6.2）：
 * - n1 = 逾期未完成数（dueAt < 今日 00:00 且 !done；今日已过时刻不算逾期）
 * - n2 = 今日到期未完成数（今日 00:00 ≤ dueAt < 明日 00:00 且 !done）
 * - n3 = 今日完成数（done 且 completedAt 在今日内）
 * - focus 状态强制 'normal'（专注表现由状态机接管，mood 不参与；rest/idle 按规则计算）
 * - n1 ≥ 3 或 n1 + n2 ≥ 5 → gloomy；n1 = 0 且 n2 = 0 且 n3 > 0 → happy；否则 normal
 */
export function computeMood(
  todos: Todo[],
  pomodoroState: 'idle' | 'focus' | 'rest',
  now: number
): Mood {
  if (pomodoroState === 'focus') return 'normal'

  const d = new Date(now)
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

  let n1 = 0 // 逾期未完成
  let n2 = 0 // 今日到期未完成
  let n3 = 0 // 今日完成
  for (const t of todos) {
    if (!t.done && t.dueAt !== undefined) {
      if (t.dueAt < startOfToday) n1++
      else if (sameDay(t.dueAt, now)) n2++
    }
    if (t.done && t.completedAt !== undefined && sameDay(t.completedAt, now)) n3++
  }

  if (n1 >= 3 || n1 + n2 >= 5) return 'gloomy'
  if (n1 === 0 && n2 === 0 && n3 > 0) return 'happy'
  return 'normal'
}

const MOOD_PARAMS: Record<Mood, MoodParams> = {
  happy: { walkProbPerMin: 3, idleSpecialProb: 0.25 },
  normal: { walkProbPerMin: 1.5, idleSpecialProb: 0.12 },
  gloomy: { walkProbPerMin: 0.3, idleSpecialProb: 0.03 }
}

/** 心情 → 行为概率参数：越开心越爱走动、越常做特殊动作 */
export function moodParams(mood: Mood): MoodParams {
  return MOOD_PARAMS[mood]
}
