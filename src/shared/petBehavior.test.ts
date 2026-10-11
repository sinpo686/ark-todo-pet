import { describe, it, expect } from 'vitest'
import {
  classifyPointer,
  nextAction,
  setForcedAction,
  stepFall,
  stepWalk,
  DOUBLE_MS,
  DRAG_PX,
  GRAVITY,
  WALK_SPEED
} from './petBehavior'
import type { PetCtx } from './petBehavior'
import type { Mood } from './mood'

const ctx = (over: Partial<PetCtx> = {}): PetCtx => ({
  action: 'idle',
  facing: 1,
  x: 500,
  y: 300,
  vy: 0,
  lastChange: 0,
  ...over
})

const PARAMS = { walkProbPerMin: 1.5, idleSpecialProb: 0.12 }

/** 恒定 rand：两次采样（时长门槛 / 概率）取同一值，边界可精确构造 */
const constRand = (v: number) => (): number => v

describe('classifyPointer（位移 8px / 按住 300ms 阈值）', () => {
  const down = { x: 100, y: 100, t: 0 }

  it('位移恰好 8px → drag（阈值含等号）', () => {
    expect(classifyPointer(down, { x: 100 + DRAG_PX, y: 100, t: 100 }, false)).toBe('drag')
  })

  it('位移 7px（横/纵）→ click，不够 drag', () => {
    expect(classifyPointer(down, { x: 107, y: 100, t: 100 }, false)).toBe('click')
    expect(classifyPointer(down, { x: 100, y: 107, t: 100 }, false)).toBe('click')
  })

  it('对角位移按欧氏距离（6,6 → √72 ≈ 8.49）→ drag', () => {
    expect(classifyPointer(down, { x: 106, y: 106, t: 100 }, false)).toBe('drag')
  })

  it('<8px 且按住 <300ms 且窗口内第二次点击 → double', () => {
    expect(classifyPointer(down, { x: 102, y: 101, t: 150 }, true)).toBe('double')
  })

  it('按住 ≥300ms（即使第二次点击）→ click', () => {
    expect(classifyPointer(down, { x: 102, y: 101, t: DOUBLE_MS }, true)).toBe('click')
  })

  it('按住 <300ms 但非第二次点击 → click', () => {
    expect(classifyPointer(down, { x: 102, y: 101, t: 150 }, false)).toBe('click')
  })
})

describe('nextAction（idle 8-20s 门槛 + walkProbPerMin 概率门）', () => {
  it('等待不足 8s：必不转移', () => {
    // rand=0 → 门槛 = 8000 + 0*12000 = 8000；wait=7999 未过门槛
    const r = nextAction(ctx({ lastChange: 0 }), 'normal', 7999, PARAMS, constRand(0), 1920)
    expect(r).toBe('idle')
  })

  it('rand≈0：过 8s 门槛且概率必中（prob=0.225 > 0.001）→ walk', () => {
    const r = nextAction(ctx({ lastChange: 0 }), 'normal', 9000, PARAMS, constRand(0.001), 1920)
    expect(r).toBe('walk')
  })

  it('rand≈1：wait 19s < 门槛≈19988 → 不转移', () => {
    const r = nextAction(ctx({ lastChange: 0 }), 'normal', 19000, PARAMS, constRand(0.999), 1920)
    expect(r).toBe('idle')
  })

  it('rand≈1：门槛过了但概率不中（prob=1.5*25/60=0.625 < 0.999）→ 不转移', () => {
    const r = nextAction(ctx({ lastChange: 0 }), 'normal', 25000, PARAMS, constRand(0.999), 1920)
    expect(r).toBe('idle')
  })

  it('概率钳制 ≤1：长等待 + rand≈0 必走（gloomy 参数也照常参与）', () => {
    const gloomy = { walkProbPerMin: 0.3, idleSpecialProb: 0.03 }
    const r = nextAction(ctx({ lastChange: 0 }), 'gloomy', 600000, gloomy, constRand(0.001), 1920)
    expect(r).toBe('walk')
  })

  it('walk 持续 3-10s：rand≈1 且 wait 12s 过门槛 → 回 idle；rand≈0 且 wait 2s → 续走', () => {
    expect(
      nextAction(
        ctx({ action: 'walk', lastChange: 0 }),
        'normal',
        12000,
        PARAMS,
        constRand(0.999),
        1920
      )
    ).toBe('idle')
    expect(
      nextAction(
        ctx({ action: 'walk', lastChange: 0 }),
        'normal',
        2000,
        PARAMS,
        constRand(0.001),
        1920
      )
    ).toBe('walk')
  })

  it('外部注入类动作（sit/drag/fall/interact/remind）兜底交还 idle；mood 三值均不炸', () => {
    const actions = ['sit', 'drag', 'fall', 'interact', 'remind'] as const
    const moods = ['happy', 'normal', 'gloomy'] as Mood[]
    for (const action of actions) {
      for (const mood of moods) {
        expect(
          nextAction(ctx({ action, lastChange: 0 }), mood, 60000, PARAMS, constRand(0.5), 1920)
        ).toBe('idle')
      }
    }
  })
})

describe('stepFall（g=0.002 px/ms²，落地钳制回 idle）', () => {
  it('空中一帧：vy += g*dt、y += vy*dt，action=fall，返回新对象不改原 ctx', () => {
    const c = ctx({ action: 'fall', y: 100, vy: 0 })
    const n = stepFall(c, 100, 1000)
    expect(n.vy).toBeCloseTo(GRAVITY * 100) // 0.2
    expect(n.y).toBeCloseTo(100 + GRAVITY * 100 * 100) // +20px
    expect(n.action).toBe('fall')
    expect(n).not.toBe(c)
    expect(c.y).toBe(100)
    expect(c.action).toBe('fall')
  })

  it('落地：y 越过 floorY → 贴地、vy=0、回 idle', () => {
    // vy'=0.1+0.2=0.3 → y'=295+30=325 ≥ 300
    const n = stepFall(ctx({ action: 'fall', y: 295, vy: 0.1 }), 100, 300)
    expect(n).toMatchObject({ y: 300, vy: 0, action: 'idle' })
  })

  it('贴地下落（y=floorY）：一帧后越过 → 同样钳制落地', () => {
    const n = stepFall(ctx({ action: 'fall', y: 300, vy: 0 }), 16, 300)
    expect(n).toMatchObject({ y: 300, vy: 0, action: 'idle' })
  })
})

describe('stepWalk（0.06 px/ms，屏幕边缘贴边翻转）', () => {
  const bounds = { minX: 0, maxX: 1620 }

  it('按 facing 前进，不触碰边界时其余字段不变', () => {
    const n = stepWalk(ctx({ action: 'walk', x: 500, facing: 1 }), 1000, bounds)
    expect(n.x).toBeCloseTo(500 + WALK_SPEED * 1000) // +60px
    expect(n.facing).toBe(1)
    expect(n.action).toBe('walk')
  })

  it('左缘（x ≤ minX）→ 贴边并翻向右（facing=1）', () => {
    const n = stepWalk(ctx({ action: 'walk', x: 5, facing: -1 }), 1000, bounds)
    expect(n).toMatchObject({ x: 0, facing: 1 })
  })

  it('右缘（x ≥ maxX）→ 贴边并翻向左（facing=-1）', () => {
    const n = stepWalk(ctx({ action: 'walk', x: 1615, facing: 1 }), 1000, bounds)
    expect(n).toMatchObject({ x: 1620, facing: -1 })
  })
})

describe('setForcedAction（外部注入：番茄钟 sit / 提醒 remind / 拖拽 drag）', () => {
  it('设置动作与 lastChange，清零 vy，朝向保留，返回新对象', () => {
    const c = ctx({ action: 'walk', vy: 0.5, facing: -1, lastChange: 0 })
    const n = setForcedAction(c, 'sit', 12345)
    expect(n).toMatchObject({ action: 'sit', lastChange: 12345, vy: 0, facing: -1 })
    expect(n).not.toBe(c)
  })
})
