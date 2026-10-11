/**
 * PetStage：桌宠 pixi 画布封装（透明渲染 + 鼠标穿透控制 + Spine 模型加载 + 行为状态机驱动）。
 *
 * - 构造时创建透明背景的 PIXI.Application 并随窗口尺寸自适应，画布挂载到 canvasParent。
 * - loadSpine(dir, skel)：经 arkmodel:// 协议加载 Ark-Models 的 Spine 3.8 二进制模型
 *   （pixi-spine 的 .skel Assets 解析器会自动连带同名 .atlas 与 .png 页），
 *   按 Ark-Pets AnimType 的 offsetY 校正落点，播放 pickAnimation 选出的待机动画，
 *   并把命中判定切到 Spine 骨骼包围盒（skeleton.getBounds；取不到回落固定 200×300）。
 * - 监听 window mousemove（50ms 节流 + trailing 兜底），命中状态翻转时调用
 *   window.api.petSetMouseIgnore(!inside)：命中角色 -> 不穿透；空白 -> 穿透。
 *
 * T9 行为驱动（startBehavior 后由 pixi ticker 每帧推进，纯逻辑在 src/shared/petBehavior）：
 * - ctx.x/y 是窗口左上角的逻辑屏幕坐标：walk 沿工作区底边推进、fall 半隐式欧拉下落，
 *   位置变化经 hooks.onWindowMove 节流（16ms）回传（渲染层 → IPC petMoveWindow → setPosition）；
 * - 指针手势（画布 pointerdown/move/up + setPointerCapture）：≥8px 即入 drag（窗口跟手、
 *   固定不穿透），松手 fall 落地回 idle；<8px 由 classifyPointer 分 click/double ——
 *   click 延迟 300ms 派发 hooks.onPointerClick（开待办面板，双击窗口内的下一次按压取消
 *   挂起派发，计划 §4.3），double → interact 动画；
 * - sit 由番茄钟外部注入（holdSit(true/false)），remind 由提醒事件注入（triggerRemind）。
 */

// CSP（script-src 'self'）禁 eval，而 pixi 着色器编译依赖 new Function；
// 官方垫片包在 import 时自装补丁（改写 ShaderSystem，免 eval），必须先于 Application 生效
import '@pixi/unsafe-eval'
import { Application, Assets } from 'pixi.js'
// 副作用导入：注册 .skel/.atlas 的 Assets 加载/解析器（uni loader 内置 3.7/3.8/4.0/4.1
// 运行时，按 .skel 二进制头部版本自动探测 —— Ark-Models 是 3.8）
import 'pixi-spine'
import { Spine, Vector2 } from 'pixi-spine'
import type { ISkeletonData } from 'pixi-spine'
import { classifyAnimation, pickAnimation } from '../../../../shared/animMap'
import type { AnimKind, PetMood } from '../../../../shared/animMap'
import { moodParams } from '../../../../shared/mood'
import {
  classifyPointer,
  nextAction,
  stepFall,
  stepWalk,
  DOUBLE_MS,
  DRAG_PX,
  INTERACT_MS,
  REMIND_MS
} from '../../../../shared/petBehavior'
import type { PetAction, PetCtx } from '../../../../shared/petBehavior'

/** 命中区域判定回调：参数为视口坐标（clientX/clientY），返回该点是否落在角色上 */
export type HitTestFn = (x: number, y: number) => boolean

/** 行为驱动向宿主（React 壳）的回调 */
export interface BehaviorHooks {
  /** 单击路由（打开待办面板） */
  onPointerClick(): void
  /** 窗口移动请求（屏幕 DIP 坐标；已按 16ms 节流，动效关键时刻强制发） */
  onWindowMove(x: number, y: number): void
}

/** mousemove 评估节流间隔（ms） */
const THROTTLE_MS = 50

/** 自主决策节流间隔（nextAction 每拍评估一次） */
const DECISION_MS = 500
/** 窗口移动 IPC 最小间隔（ms，≈一帧） */
const MOVE_SEND_MS = 16
/** 单帧 dt 上限（后台节流恢复时防大跳步） */
const MAX_FRAME_MS = 100

/** 地面留白（模型脚底距窗口底边） */
const GROUND_MARGIN = 8
/** 模型目标高度占视口比例 */
const TARGET_HEIGHT_RATIO = 0.85
/** bounds 取不到时的兜底命中矩形与兜底缩放 */
const FALLBACK_HIT = { width: 200, height: 300 }
const FALLBACK_SCALE = 0.4

export class PetStage {
  private readonly app: Application
  private hitTest: HitTestFn | null = null
  private spine: Spine | null = null
  /** 当前动画的 Ark-Pets offsetY 校正（世界像素，向下为正） */
  private animOffsetY = 0
  /** 人工动画映射覆盖（mapping.json）：AnimKind → 动画全名，优先于正则启发式 */
  private mapping: Partial<Record<string, string>> | null = null
  /** 当前是否处于命中态；初始 false 与主进程建窗时默认 setIgnoreMouseEvents(true) 对齐 */
  private inside = false
  private lastRunAt = 0
  private trailingTimer: number | null = null
  private pendingX = 0
  private pendingY = 0
  private destroyed = false

  // ---- T9 行为状态 ----
  private hooks: BehaviorHooks | null = null
  private ctx: PetCtx | null = null
  private mood: PetMood = 'normal'
  /** 番茄钟 focus 期间的强制坐姿（外部注入，非自主转移） */
  private sitHeld = false
  private lastDecisionAt = 0
  private lastMoveSentAt = 0
  /** 拖拽期间锁定不穿透（命中翻转器暂停） */
  private pointerLocked = false
  // 指针手势状态
  private ptrDown: { x: number; y: number; t: number } | null = null
  private ptrDownScreen: { x: number; y: number } | null = null
  private grabbing = false
  private grabDX = 0
  private grabDY = 0
  /** 上一次判定为 click 的抬起时刻（双击窗口起点） */
  private lastClickUpAt = 0
  /** 单击 300ms 双击消歧：click 判定后挂起的 onPointerClick 派发（计划 §4.3） */
  private pendingClickTimer: number | null = null

  constructor(canvasParent: HTMLElement) {
    this.app = new Application({ backgroundAlpha: 0, resizeTo: window, antialias: true })
    canvasParent.appendChild(this.app.view as unknown as HTMLCanvasElement)
    window.addEventListener('mousemove', this.onMouseMove)
    const view = this.app.view as unknown as HTMLCanvasElement
    view.addEventListener('pointerdown', this.onPointerDown)
    view.addEventListener('pointermove', this.onPointerMove)
    view.addEventListener('pointerup', this.onPointerUp)
    view.addEventListener('pointercancel', this.onPointerCancel)
  }

  get pixiApp(): Application {
    return this.app
  }

  /** 行为驱动是否已启动（冒烟自检据此判断可否注入指针序列） */
  get behaviorReady(): boolean {
    return this.ctx !== null
  }

  setHitTest(fn: HitTestFn): void {
    this.hitTest = fn
  }

  /**
   * 加载 userData/models/<modelDir>/ 下的 Spine 模型并登台（底部居中）。
   * @param modelDir 模型目录名（userData/models/ 相对）
   * @param skelName 目录内 .skel 文件名（如 build_char_002_amiya.skel）
   */
  async loadSpine(
    modelDir: string,
    skelName: string,
    mapping?: Partial<Record<string, string>>
  ): Promise<void> {
    this.mapping = mapping ?? null
    const url = `arkmodel://m/${encodeURIComponent(modelDir)}/${encodeURIComponent(skelName)}`
    console.log(`[PetStage] 载入 Spine 模型 ${modelDir}/${skelName}（${url}）`)
    // pixi-spine 解析器：加载 .skel 时自动拉同名 .atlas，atlas 再拉 .png 页
    const resource = (await Assets.load(url)) as { spineData: ISkeletonData }
    if (this.destroyed) return

    const spine = new Spine(resource.spineData)
    const names = resource.spineData.animations.map((a) => a.name)
    console.log(
      `[PetStage] spine 载入成功：动画清单 ${names.length} 条 [${names.slice(0, 8).join(' / ')}${names.length > 8 ? ' / …' : ''}]`
    )

    // 换模：先移除并销毁旧 spine（T12 切换干员支持）
    if (this.spine) {
      this.app.stage.removeChild(this.spine)
      this.spine.destroy()
      this.spine = null
    }
    this.spine = spine
    this.app.stage.addChild(spine)
    const current = this.play('idle', 'normal') ?? this.playFirstAvailable(names)
    this.layout()

    // 命中判定：Spine 骨骼包围盒（miss 时回落固定矩形）
    this.setHitTest((x, y) => this.hitTestSpineBounds(x, y))
    console.log(
      `[PetStage] 当前动画: ${current ?? '(无)'} offsetY=${this.animOffsetY} scale=${spine.scale.x.toFixed(3)}`
    )
  }

  /**
   * 按 Ark-Pets 动画类别切动画；返回实际播放名，无可播返回 null。
   * mood 语义见 animMap.pickAnimation（gloomy 偏向 Sleep、happy 禁用 Sleep）。
   */
  play(kind: AnimKind, mood: PetMood): string | null {
    const spine = this.spine
    if (!spine) return null
    const names = spine.spineData.animations.map((a) => a.name)
    // mapping.json 人工覆盖优先（值必须真实存在于动画清单，否则回落启发式）
    const manual = this.mapping?.[kind]
    const picked = manual && names.includes(manual) ? manual : pickAnimation(names, kind, mood)
    if (!picked) return null
    spine.state.setAnimation(0, picked, true)
    this.animOffsetY = classifyAnimation(picked).offsetY
    this.layout()
    return picked
  }

  // ---- T9：行为驱动公共接口 ----

  /** 启动行为循环（幂等）：初始化 ctx 并挂上 pixi ticker；窗口吸附到工作区底边 */
  startBehavior(hooks: BehaviorHooks): void {
    if (this.destroyed || this.ctx) return
    this.hooks = hooks
    const wa = this.workArea()
    const bounds = this.walkBounds()
    const now = performance.now()
    this.ctx = {
      action: 'idle',
      facing: 1,
      x: Math.min(Math.max(window.screenX, bounds.minX), bounds.maxX),
      y: this.floorY(), // 启动即贴地（旧存档可能停在半空）
      vy: 0,
      lastChange: now
    }
    this.lastDecisionAt = now
    this.sendMove(this.ctx.x, this.ctx.y, true)
    this.app.ticker.add(this.onTick)
    console.log(
      `[behavior] 启动：x=${this.ctx.x} y=${this.ctx.y} floor=${this.floorY()} workArea=${JSON.stringify(wa)}`
    )
  }

  /** 情绪变化（onMoodChanged）：影响转移概率（moodParams）与当前动作的选片 */
  setMood(mood: PetMood): void {
    if (this.destroyed || mood === this.mood) return
    this.mood = mood
    if (this.ctx) this.playFor(this.ctx.action) // 按新情绪重选当前动作动画
  }

  /** 番茄钟强制坐姿：focus 期间保持 sit（drag/fall 中不打断，落地后下一拍再生效） */
  holdSit(hold: boolean): void {
    this.sitHeld = hold
  }

  /** 提醒事件：special 动画（拖拽/下落中不抢戏，通知本身已由主进程发出） */
  triggerRemind(): void {
    if (this.destroyed || !this.ctx) return
    if (this.ctx.action === 'drag' || this.ctx.action === 'fall') return
    this.setAction('remind', performance.now())
  }

  /** 外部注入动作（dev 冒烟走动演示等） */
  forceAction(action: PetAction): void {
    if (this.destroyed || !this.ctx) return
    this.setAction(action, performance.now())
  }

  private readonly onTick = (): void => {
    if (!this.ctx || this.destroyed) return
    const now = performance.now()
    const dt = Math.min(this.app.ticker.deltaMS, MAX_FRAME_MS)

    // 1) 下落：每帧积分，落地贴地回 idle
    if (this.ctx.action === 'fall') {
      const landed = stepFall(this.ctx, dt, this.floorY())
      if (landed.action === 'idle') {
        this.ctx = { ...landed, lastChange: now } // 落地时刻 = 新 idle 起点
        this.sendMove(this.ctx.x, this.ctx.y, true)
        this.playFor('idle')
        console.log('[behavior] action=fall -> idle（落地）')
      } else {
        this.ctx = landed
        this.sendMove(landed.x, landed.y)
      }
      return
    }

    // 2) 拖拽：由指针事件逐事件驱动（pointermove 即时 setPosition），tick 不插手
    if (this.ctx.action === 'drag') return

    // 3) 走动：沿工作区底边推进，越界贴边翻转（scale.x 随 facing 翻转镜像）
    if (this.ctx.action === 'walk') {
      const prevFacing = this.ctx.facing
      this.ctx = stepWalk(this.ctx, dt, this.walkBounds())
      this.sendMove(this.ctx.x, this.ctx.y)
      if (this.ctx.facing !== prevFacing) {
        console.log(`[behavior] 屏幕边缘转身 facing=${prevFacing} -> ${this.ctx.facing}`)
        this.layout()
      }
    }

    // 4) 一次性动作到时回收（interact/remind 播完回 idle）
    const act = this.ctx.action
    if (act === 'interact' && now - this.ctx.lastChange >= INTERACT_MS) {
      this.setAction('idle', now)
    } else if (act === 'remind' && now - this.ctx.lastChange >= REMIND_MS) {
      this.setAction('idle', now)
    }

    // 5) 番茄钟强制坐姿（外部注入优先于自主决策）
    if (this.sitHeld) {
      if (this.ctx.action !== 'sit') this.setAction('sit', now)
    } else if (this.ctx.action === 'sit') {
      this.setAction('idle', now)
    }

    // 6) 自主决策（idle ↔ walk，500ms 一拍；sit 持续期间不自主转移）
    if (!this.sitHeld && now - this.lastDecisionAt >= DECISION_MS) {
      this.lastDecisionAt = now
      const a = this.ctx.action
      if (a === 'idle' || a === 'walk') {
        const next = nextAction(
          this.ctx,
          this.mood,
          now,
          moodParams(this.mood),
          Math.random,
          window.screen.width
        )
        if (next !== this.ctx.action) this.setAction(next, now)
      }
    }
  }

  /** 切换动作：更新 ctx、按动作选片、打点、强制同步一次窗口位置 */
  private setAction(action: PetAction, now: number): void {
    const ctx = this.ctx
    if (!ctx || ctx.action === action) return
    const prev = ctx.action
    this.ctx = { ...ctx, action, vy: 0, lastChange: now }
    this.sendMove(this.ctx.x, this.ctx.y, true)
    this.playFor(action)
    console.log(`[behavior] action=${prev} -> ${action}`)
    if (action === 'drag') {
      // 拎起时按住手势固定不穿透
      this.setPointerLocked(true)
    }
  }

  /** 动作 → 动画选片（缺该类动画时保持当前动画或回落 idle） */
  private playFor(action: PetAction): void {
    switch (action) {
      case 'idle': {
        // 待机花样：idleSpecialProb 概率播 special（多数模型无 Special，自动回落 idle）
        const special = Math.random() < moodParams(this.mood).idleSpecialProb
        if (special) {
          if (!this.play('special', this.mood)) this.play('idle', this.mood)
        } else {
          this.play('idle', this.mood)
        }
        break
      }
      case 'walk':
        this.play('move', this.mood)
        break
      case 'sit':
        this.play('sit', this.mood) // gloomy 在 pickAnimation 内映射 Sleep；缺 Sit 保持当前
        break
      case 'drag':
        this.play('move', this.mood) // 拎起蹬腿；缺失保持当前
        break
      case 'fall':
        break // 保持下落前的动画（拎起时的 move）
      case 'interact':
        if (!this.play('interact', this.mood)) this.play('idle', this.mood)
        break
      case 'remind':
        if (!this.play('special', this.mood)) {
          if (!this.play('interact', this.mood)) this.play('idle', this.mood)
        }
        break
    }
  }

  // ---- T9：屏幕几何 ----

  private workArea(): { left: number; top: number; width: number; height: number } {
    // renderer 的 screen.* 为 DIP（与 Electron setPosition 同一坐标系）；
    // availLeft/availTop 是 Chromium 支持的非标准扩展（DOM 类型库未收录）
    const s = window.screen as Screen & { availLeft?: number; availTop?: number }
    return {
      left: s.availLeft ?? 0,
      top: s.availTop ?? 0,
      width: s.availWidth,
      height: s.availHeight
    }
  }

  /** 窗口左上角的走动活动区间（工作区去掉窗宽） */
  private walkBounds(): { minX: number; maxX: number } {
    const wa = this.workArea()
    return { minX: wa.left, maxX: wa.left + wa.width - window.innerWidth }
  }

  /** 地面：窗口左上角的 y（脚底贴工作区底边） */
  private floorY(): number {
    const wa = this.workArea()
    return wa.top + wa.height - window.innerHeight
  }

  /** 拖拽目标钳制在工作区内（防拖出屏幕找回不回） */
  private clampToWorkArea(x: number, y: number): { x: number; y: number } {
    const b = this.walkBounds()
    const wa = this.workArea()
    const maxY = this.floorY()
    return {
      x: Math.min(Math.max(x, b.minX), Math.max(b.minX, b.maxX)),
      y: Math.min(Math.max(y, wa.top), Math.max(wa.top, maxY))
    }
  }

  /** 窗口移动请求（16ms 节流；force 用于动作切换/落地等关键时刻的最终定位） */
  private sendMove(x: number, y: number, force = false): void {
    const now = performance.now()
    if (!force && now - this.lastMoveSentAt < MOVE_SEND_MS) return
    this.lastMoveSentAt = now
    this.hooks?.onWindowMove(Math.round(x), Math.round(y))
  }

  // ---- T9：指针手势（画布层） ----

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (this.destroyed || !this.ctx) return
    if (e.button !== 0) return
    // 只响应落在角色身上的按压：不穿透窗口矩形内的空白区域不触发任何交互
    if (!this.hitTestSpineBounds(e.clientX, e.clientY)) return
    // 双击消歧（计划 §4.3）：300ms 窗口内的下一次有效按压取消挂起的单击派发
    if (this.pendingClickTimer !== null) {
      this.cancelPendingClick()
      console.log('[pet-pointer] 双击窗口内按下 -> 取消挂起的单击派发')
    }
    this.ptrDown = { x: e.clientX, y: e.clientY, t: performance.now() }
    this.ptrDownScreen = { x: e.screenX, y: e.screenY }
    try {
      ;(this.app.view as HTMLCanvasElement).setPointerCapture(e.pointerId)
    } catch {
      // 合成事件（冒烟自检）无活跃指针，捕获失败无碍：监听在画布上仍收到后续派发
    }
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.destroyed || !this.ctx || !this.ptrDown) return
    if (!this.grabbing) {
      // 未过 8px 阈值前不启动拖拽（期间的移动仍可能构成 click/double 的位移判定）
      if (Math.hypot(e.clientX - this.ptrDown.x, e.clientY - this.ptrDown.y) < DRAG_PX) return
      this.grabbing = true
      // 抓取偏移 = 按下时指针屏幕坐标 - 窗口屏幕坐标（窗口左上角跟随指针平移）
      this.grabDX = (this.ptrDownScreen?.x ?? e.screenX) - window.screenX
      this.grabDY = (this.ptrDownScreen?.y ?? e.screenY) - window.screenY
      this.setAction('drag', performance.now()) // 内部锁定不穿透
    }
    const target = this.clampToWorkArea(e.screenX - this.grabDX, e.screenY - this.grabDY)
    this.ctx = { ...this.ctx, x: target.x, y: target.y }
    this.sendMove(target.x, target.y)
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    const down = this.ptrDown
    this.ptrDown = null
    this.ptrDownScreen = null
    if (this.destroyed || !this.ctx) return
    if (this.grabbing) {
      // 松手：自由落体（vy 已在 setAction 清零）
      this.endDrag()
      return
    }
    if (!down) return
    const up = { x: e.clientX, y: e.clientY, t: performance.now() }
    // 双击窗口：上一次 click 的抬起 → 本次按下，间隔 < 300ms
    const second = this.lastClickUpAt > 0 && down.t - this.lastClickUpAt < DOUBLE_MS
    const kind = classifyPointer(down, up, second)
    if (kind === 'click') {
      this.lastClickUpAt = up.t
      // 计划 §4.3：单击延迟 300ms 派发，等待双击判定窗口；窗口内的下一次有效
      // pointerdown（onPointerDown）会取消挂起 —— 双击的第一击不再弹出待办面板
      this.cancelPendingClick()
      console.log('[pet-pointer] classify=click -> 挂起 300ms 派发（双击消歧）')
      this.pendingClickTimer = window.setTimeout(() => {
        this.pendingClickTimer = null
        console.log('[pet-pointer] 单击确认（300ms 无二次按压）-> onPointerClick')
        this.hooks?.onPointerClick()
      }, DOUBLE_MS)
    } else {
      this.lastClickUpAt = 0
      this.cancelPendingClick()
      if (kind === 'double') {
        console.log('[pet-pointer] classify=double -> interact（第一击的单击派发已取消）')
        this.setAction('interact', performance.now())
      } else {
        // 位移超阈值但未经 pointermove 预热（极端/合成场景）：按位移平移窗口后下落
        console.log('[pet-pointer] classify=drag（无 move 预热）-> 平移 + fall')
        const target = this.clampToWorkArea(
          this.ctx.x + (up.x - down.x),
          this.ctx.y + (up.y - down.y)
        )
        this.ctx = { ...this.ctx, x: target.x, y: target.y }
        this.sendMove(target.x, target.y, true)
        this.setAction('fall', performance.now())
      }
    }
  }

  private readonly onPointerCancel = (): void => {
    this.ptrDown = null
    this.ptrDownScreen = null
    if (this.grabbing) this.endDrag()
  }

  private endDrag(): void {
    this.grabbing = false
    this.setPointerLocked(false)
    this.setAction('fall', performance.now())
  }

  /** 取消挂起的单击派发（双击窗口内的下一次按压 / 双击判定成立 / 销毁） */
  private cancelPendingClick(): void {
    if (this.pendingClickTimer !== null) {
      window.clearTimeout(this.pendingClickTimer)
      this.pendingClickTimer = null
    }
  }

  /** 拖拽锁定：固定不穿透；解锁时重置命中态并按最后已知鼠标位置强制重评估 */
  private setPointerLocked(lock: boolean): void {
    this.pointerLocked = lock
    if (lock) {
      this.inside = true
      window.api.petSetMouseIgnore(false)
    } else {
      this.inside = false
      this.evaluate(performance.now(), true)
    }
  }

  private playFirstAvailable(names: string[]): string | null {
    if (names.length === 0) return null
    this.spine?.state.setAnimation(0, names[0], true)
    this.animOffsetY = 0
    return names[0]
  }

  /** 缩放到底部居中落位 + offsetY 校正（Sit=50 / Sleep=25 / 其余=5，见 animMap）；
   *  scale.x 符号随 ctx.facing（走动转身时镜像） */
  private layout(): void {
    const spine = this.spine
    if (!spine) return
    const screen = this.app.screen
    const bounds = this.measureBounds()
    const rawH = bounds ? bounds.height : 0
    const scale =
      rawH > 0
        ? Math.min(Math.max((screen.height * TARGET_HEIGHT_RATIO) / rawH, 0.1), 2)
        : FALLBACK_SCALE
    const facing = this.ctx?.facing ?? 1
    spine.scale.set(scale * facing, scale)
    spine.position.set(screen.width / 2, screen.height - GROUND_MARGIN + this.animOffsetY)
  }

  /** 当前姿势的骨骼包围盒（spine 本地坐标，y 向上为负）；无附件时返回 null */
  private measureBounds(): { x: number; y: number; width: number; height: number } | null {
    const spine = this.spine
    if (!spine) return null
    try {
      const offset = new Vector2(0, 0)
      const size = new Vector2(0, 0)
      spine.skeleton.getBounds(offset, size, [])
      if (size.x <= 0 || size.y <= 0) return null
      return { x: offset.x, y: offset.y, width: size.x, height: size.y }
    } catch (err) {
      console.warn('[PetStage] getBounds 失败，回落固定命中矩形:', String(err))
      return null
    }
  }

  private hitTestSpineBounds(x: number, y: number): boolean {
    const spine = this.spine
    if (!spine) return false
    const b = this.measureBounds()
    if (!b) {
      // 兜底：挂载点上方固定 200×300
      const cx = spine.x
      const cy = spine.y - FALLBACK_HIT.height / 2
      return (
        Math.abs(x - cx) <= FALLBACK_HIT.width / 2 && Math.abs(y - cy) <= FALLBACK_HIT.height / 2
      )
    }
    // scale.x 可能为负（facing=-1 镜像）：先算两端点再取 min/max
    const sx = spine.scale.x
    const sy = spine.scale.y
    const xa = spine.x + b.x * sx
    const xb = spine.x + (b.x + b.width) * sx
    const ya = spine.y + b.y * sy
    const yb = spine.y + (b.y + b.height) * sy
    return (
      x >= Math.min(xa, xb) &&
      x <= Math.max(xa, xb) &&
      y >= Math.min(ya, yb) &&
      y <= Math.max(ya, yb)
    )
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.ctx = null
    this.spine = null
    this.cancelPendingClick()
    this.cancelTrailing()
    window.removeEventListener('mousemove', this.onMouseMove)
    const view = this.app.view as unknown as HTMLCanvasElement
    view.removeEventListener('pointerdown', this.onPointerDown)
    view.removeEventListener('pointermove', this.onPointerMove)
    view.removeEventListener('pointerup', this.onPointerUp)
    view.removeEventListener('pointercancel', this.onPointerCancel)
    this.app.ticker.remove(this.onTick)
    // removeView=true 移除画布 DOM；children=true 连带销毁 stage 上的显示对象
    this.app.destroy(true, { children: true })
  }

  private readonly onMouseMove = (e: MouseEvent): void => {
    this.pendingX = e.clientX
    this.pendingY = e.clientY
    const now = performance.now()
    const elapsed = now - this.lastRunAt
    if (elapsed >= THROTTLE_MS) {
      this.evaluate(now)
    } else if (this.trailingTimer === null) {
      // trailing 兜底：节流窗口内的最后一次移动也要被评估，避免鼠标停在边界处状态滞留
      this.trailingTimer = window.setTimeout(() => {
        this.trailingTimer = null
        this.evaluate(performance.now())
      }, THROTTLE_MS - elapsed)
    }
  }

  private cancelTrailing(): void {
    if (this.trailingTimer !== null) {
      window.clearTimeout(this.trailingTimer)
      this.trailingTimer = null
    }
  }

  /** 命中评估；force=true 时无视「无翻转不发」约定（拖拽解锁后校正悬挂的 ignore 态） */
  private evaluate(now: number, force = false): void {
    this.lastRunAt = now
    if (this.pointerLocked) return // 拖拽锁定期不翻转
    const inside = this.hitTest !== null ? this.hitTest(this.pendingX, this.pendingY) : false
    if (inside === this.inside && !force) return // 仅布尔值翻转时发送，避免 IPC 洪水
    this.inside = inside
    console.log(`[PetStage] hit=${inside} -> petSetMouseIgnore(${!inside})`)
    window.api.petSetMouseIgnore(!inside)
  }
}
