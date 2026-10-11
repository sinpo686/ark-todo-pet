/**
 * Ark-Pets AnimType 的 TS 移植：动画全名 → 行为类别/阶段/ offsetY。
 *
 * 事实依据（Ark-Pets 源码 AnimType.java 的权威正则，逐字移植，一律 i 标志）：
 *   Idle      ^((Id.?le)|(Relax)).{0,2}$   offsetY 5
 *   Move      ^Move.{0,2}$                  offsetY 5
 *   Sit       ^Sit$                         offsetY 50
 *   Sleep     ^Sleep$                       offsetY 25
 *   Interact  ^Interact$                    offsetY 5
 *   Special   ^Special$                     offsetY 5
 *   modifier  Begin/Start/Up/Appear | Loop | End/Down/Disappear（见 MODIFIER_PATTERNS）
 *
 * 动画全名以 `/` 分段：首段为类别段（上面的正则只对首段做整段匹配；
 * `.{0,2}` 的容错后缀吸收 Move1 / Idle_2 之类命名），其后的段先逐一尝试
 * modifier 正则，命中则记为 begin/loop/end，其余（C1/C2…）视为 stage 段忽略。
 */

/** 行为类别（attack/die 为 Ark-Pets AnimType 预留位，当前模型库无对应正则） */
export type AnimKind = 'idle' | 'move' | 'sit' | 'sleep' | 'special' | 'interact' | 'attack' | 'die'

/** 动画阶段（同类别动画串行衔接时的起止段） */
export type AnimModifier = 'begin' | 'loop' | 'end' | 'none'

export interface AnimPattern {
  kind: AnimKind
  re: RegExp
  offsetY: number
}

/** 六类权威正则（顺序即优先级：一个首段至多命中一类） */
export const ANIM_PATTERNS: Array<AnimPattern> = [
  { kind: 'idle', re: /^((Id.?le)|(Relax)).{0,2}$/i, offsetY: 5 },
  { kind: 'move', re: /^Move.{0,2}$/i, offsetY: 5 },
  { kind: 'sit', re: /^Sit$/i, offsetY: 50 },
  { kind: 'sleep', re: /^Sleep$/i, offsetY: 25 },
  { kind: 'interact', re: /^Interact$/i, offsetY: 5 },
  { kind: 'special', re: /^Special$/i, offsetY: 5 }
]

/** modifier 正则（对 `/` 分段后的非首段整段匹配，i 标志） */
export const MODIFIER_PATTERNS: Array<{ modifier: Exclude<AnimModifier, 'none'>; re: RegExp }> = [
  { modifier: 'begin', re: /^((Begin)|(Start)|(Up)|(Appear))$/i },
  { modifier: 'loop', re: /^Loop$/i },
  { modifier: 'end', re: /^((End)|(Down)|(Disappear))$/i }
]

export interface ClassifiedAnim {
  kind: AnimKind | 'other'
  modifier: AnimModifier
  offsetY: number
}

const OTHER: ClassifiedAnim = { kind: 'other', modifier: 'none', offsetY: 0 }

/** 动画全名 → { kind, modifier, offsetY }；不认识时 kind='other' 且 offsetY=0 */
export function classifyAnimation(animFullName: string): ClassifiedAnim {
  const segments = animFullName.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return OTHER

  const kindSeg = segments[0]
  const hit = ANIM_PATTERNS.find((p) => p.re.test(kindSeg))
  if (!hit) return OTHER

  // 其后段：先按 modifier 正则识别阶段，未命中的视为 stage（C1/C2…）忽略
  let modifier: AnimModifier = 'none'
  for (const seg of segments.slice(1)) {
    const m = MODIFIER_PATTERNS.find((p) => p.re.test(seg))
    if (m) {
      modifier = m.modifier
      break
    }
  }
  return { kind: hit.kind, modifier, offsetY: hit.offsetY }
}

export type PetMood = 'happy' | 'normal' | 'gloomy'

/**
 * 从模型实际动画清单中选出某类别的播放目标：
 * 1) mood=gloomy 且请求 sit 而模型有 Sleep 类 → 映射到 Sleep（情绪低落瘫着睡）；
 * 2) happy 禁用 Sleep（该类直接返回 null，由调用方回落 idle）；
 * 3) 优先该类的 Loop 段；无 Loop 取该类任一本体；类别完全缺失返回 null。
 */
export function pickAnimation(available: string[], kind: AnimKind, mood: PetMood): string | null {
  const classOf = (name: string): ClassifiedAnim => classifyAnimation(name)
  const hasKind = (k: AnimKind): boolean => available.some((n) => classOf(n).kind === k)

  // mood 对 sit/sleep 的调节（其余类别不受影响）
  if (mood === 'gloomy' && kind === 'sit' && hasKind('sleep')) {
    // gloomy 偏向 Sleep：情绪低落时 sit 请求改播睡眠（brief：Sit/Sleep 受 mood 影响）
    kind = 'sleep'
  }
  if (mood === 'happy' && kind === 'sleep') {
    return null
  }

  // 优先 Loop 段，其次该类本体（available 原序，保证确定性）
  const loop = available.find((n) => {
    const c = classOf(n)
    return c.kind === kind && c.modifier === 'loop'
  })
  if (loop) return loop
  return available.find((n) => classOf(n).kind === kind) ?? null
}
