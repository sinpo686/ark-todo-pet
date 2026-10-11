/** 桌宠台词库（T11）：按事件类别 × 心情挑选气泡文案。纯数据，无 IO。 */

export type BubbleKind = 'mood' | 'remind' | 'pomoFocusEnd' | 'pomoRestEnd' | 'interact'
export type BubbleMood = 'happy' | 'normal' | 'gloomy'

/** 心情闲聊（每心情 8 条，长闲时隔触发） */
const MOOD_LINES: Record<BubbleMood, string[]> = {
  happy: [
    '今天的进度不错，博士。',
    '任务清单很干净，感觉轻松。',
    '有需要随时叫我。',
    '保持这个节奏就好。',
    '罗德岛的事务处理完毕。',
    '嗯，是充实的一天。',
    '博士的状态很好呢。',
    '需要休息的话，我会在的。'
  ],
  normal: [
    '博士，记得看看待办清单。',
    '有两条快到期了。',
    '我在这里，有事叫我。',
    '计划排好了就按部就班吧。',
    '别忘记休息。',
    '文件我整理好了。',
    '下一步指令？',
    '一切都在日程上。'
  ],
  gloomy: [
    '博士……逾期的事项有点多。',
    '待办再不清一清，我要忙不过来了。',
    '先把最紧急的那条处理掉吧。',
    '堆着的事不会自己消失。',
    '需要我帮你列个优先级吗。',
    '咳，日程表快满了。',
    '一条一条来，别急。',
    '博士，加把劲。'
  ]
}

const REMIND_LINES = [
  '博士，到时间了：',
  '提醒——',
  '该处理这件事了：',
  '时间到了，博士：'
]

const POMO_FOCUS_END_LINES = [
  '专注结束，休息一下吧，博士。',
  '一段专注完成了。起来走走。',
  '计时结束，喝口水。',
  '辛苦了，接下来是休息时间。'
]

const POMO_REST_END_LINES = [
  '休息结束，准备好继续了吗？',
  '计时开始前，记得看看待办。',
  '好，恢复状态。',
  '下一段专注，随时开始。'
]

const INTERACT_LINES = [
  '唔？',
    '博士，有什么事？',
  '别戳了……',
    '嗯？我在听。',
  '有事请讲。',
  '——好痒。'
]

/** 按类别挑台词；remind 类返回前缀（拼接待办标题用）；rand ∈ [0,1) */
export function pickLine(kind: BubbleKind, mood: BubbleMood, rand: () => number): string {
  const pick = (arr: string[]): string => arr[Math.floor(rand() * arr.length) % arr.length]
  switch (kind) {
    case 'mood':
      return pick(MOOD_LINES[mood])
    case 'remind':
      return pick(REMIND_LINES)
    case 'pomoFocusEnd':
      return pick(POMO_FOCUS_END_LINES)
    case 'pomoRestEnd':
      return pick(POMO_REST_END_LINES)
    case 'interact':
      return pick(INTERACT_LINES)
  }
}
