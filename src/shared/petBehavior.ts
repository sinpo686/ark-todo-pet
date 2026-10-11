/**
 * 桌宠行为状态机（纯逻辑）：动作转移 + 走动推进 + 重力下落 + 指针手势分类。
 * 无 IO / 无定时器 / 无 Math.random 内嵌 —— rand 与时间全部由参数注入（可测性）。
 *
 * 动作转移图（sit 由番茄钟经 setForcedAction 外部注入，不在 nextAction 内）：
 *   idle --(8-20s 门槛 + walkProbPerMin 概率)--> walk --(3-10s)--> idle
 *   drag --松手--> fall --落地--> idle
 *   interact/remind --(INTERACT_MS/REMIND_MS)--> idle
 */

import type { Mood } from './mood'

export type PetAction = 'idle' | 'walk' | 'sit' | 'drag' | 'fall' | 'interact' | 'remind'

export interface PetCtx {
  action: PetAction
  /** 朝向：1 向右 / -1 向左 */
  facing: 1 | -1
  /** 窗口左上角逻辑屏幕坐标（DIP） */
  x: number
  y: number
  /** 垂直速度（px/ms，向下为正） */
  vy: number
  /** 最近一次动作切换时刻（ms，时钟由驱动层注入） */
  lastChange: number
}

/** 行为概率参数（T4 moodParams 的产物形状） */
export interface BehaviorParams {
  walkProbPerMin: number
  idleSpecialProb: number
}

// ---- 可调常量（驱动层与测试共用） ----

/** idle→walk 的等待门槛：8000 + rand()*12000 → 8-20s */
export const IDLE_MIN_MS = 8_000
export const IDLE_SPREAD_MS = 12_000
/** 单次走动时长：3000 + rand()*7000 → 3-10s */
export const WALK_MIN_MS = 3_000
export const WALK_SPREAD_MS = 7_000
/** 走动速度 px/ms（= 60 px/s） */
export const WALK_SPEED = 0.06
/** 重力加速度 px/ms²（= 2000 px/s²） */
export const GRAVITY = 0.002
/** classifyPointer 拖拽位移阈值 px */
export const DRAG_PX = 8
/** 双击窗口 / 按住时长阈值 ms */
export const DOUBLE_MS = 300
/** 一次性动作的默认时长（驱动层回收用） */
export const INTERACT_MS = 2_000
export const REMIND_MS = 2_500

/**
 * 自主动作决策（idle ↔ walk）：
 * - idle：先过时长门槛（每拍重采样 8000 + rand()*12000），再过概率门
 *   rand() < min(1, walkProbPerMin * 等待分钟数) → walk，否则留在 idle；
 * - walk：走满 3000 + rand()*7000 → 回 idle；
 * - sit/drag/fall/interact/remind：完成时机由驱动层/外部判定，此处兜底交还 idle。
 *
 * rand 消耗顺序（固定，便于测试注入）：[时长门槛] 概率门通过前不消耗第二次采样。
 * mood / screenW 为 brief 固定签名占位：情绪差异已由 params 携带，屏幕边缘翻转在
 * stepWalk 内处理（nextAction 只返回动作，无法表达 facing）。
 */
export function nextAction(
  ctx: PetCtx,
  mood: Mood,
  now: number,
  params: BehaviorParams,
  rand: () => number,
  screenW: number
): PetAction {
  void mood
  void screenW
  const wait = Math.max(0, now - ctx.lastChange)
  switch (ctx.action) {
    case 'idle': {
      if (wait < IDLE_MIN_MS + rand() * IDLE_SPREAD_MS) return 'idle'
      const prob = Math.min(1, params.walkProbPerMin * (wait / 60_000))
      return rand() < prob ? 'walk' : 'idle'
    }
    case 'walk':
      return wait >= WALK_MIN_MS + rand() * WALK_SPREAD_MS ? 'idle' : 'walk'
    default:
      return 'idle'
  }
}

/**
 * 走动一帧：x += facing * WALK_SPEED * dt；越界贴边并翻转朝向（返回新对象）。
 * bounds = 窗口左上角允许的活动区间 [minX, maxX]（工作区去掉窗宽）。
 */
export function stepWalk(
  ctx: PetCtx,
  dtMs: number,
  bounds: { minX: number; maxX: number }
): PetCtx {
  const x = ctx.x + ctx.facing * WALK_SPEED * dtMs
  if (x <= bounds.minX) return { ...ctx, x: bounds.minX, facing: 1 }
  if (x >= bounds.maxX) return { ...ctx, x: bounds.maxX, facing: -1 }
  return { ...ctx, x }
}

/**
 * 下落一帧（半隐式欧拉）：vy += g*dt 后 y += vy*dt；y ≥ floorY 时贴地、
 * vy 归零、动作回 idle（lastChange 不在此重置 —— 本函数无时钟，由驱动层
 * 检测到 fall→idle 转移时补 now）。
 */
export function stepFall(ctx: PetCtx, dtMs: number, floorY: number): PetCtx {
  const vy = ctx.vy + GRAVITY * dtMs
  const y = ctx.y + vy * dtMs
  if (y >= floorY) {
    return { ...ctx, y: floorY, vy: 0, action: 'idle' }
  }
  return { ...ctx, y, vy, action: 'fall' }
}

/**
 * 指针手势分类（down..up 一次完整按压）：
 * - 位移 ≥ 8px（欧氏距离）→ drag；
 * - <8px 且按住 <300ms 且 isSecondClickInWindow（300ms 双击窗口内第二次按压）→ double；
 * - 否则 click。
 */
export function classifyPointer(
  down: { x: number; y: number; t: number },
  up: { x: number; y: number; t: number },
  isSecondClickInWindow: boolean
): 'click' | 'double' | 'drag' {
  const dist = Math.hypot(up.x - down.x, up.y - down.y)
  if (dist >= DRAG_PX) return 'drag'
  if (up.t - down.t < DOUBLE_MS && isSecondClickInWindow) return 'double'
  return 'click'
}

/**
 * 外部注入动作（番茄钟 sit / 提醒 remind / 指针 drag.fall 等）：
 * 设置动作、重置 lastChange（重新起算 idle 门槛）、清零 vy（松手下落从静止开始）。
 */
export function setForcedAction(ctx: PetCtx, action: PetAction, now: number): PetCtx {
  return { ...ctx, action, vy: 0, lastChange: now }
}
