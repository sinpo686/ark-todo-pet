/**
 * PetStage：桌宠 pixi 画布封装（透明渲染 + 鼠标穿透控制 + Spine 模型加载）。
 *
 * - 构造时创建透明背景的 PIXI.Application 并随窗口尺寸自适应，画布挂载到 canvasParent。
 * - loadSpine(dir, skel)：经 arkmodel:// 协议加载 Ark-Models 的 Spine 3.8 二进制模型
 *   （pixi-spine 的 .skel Assets 解析器会自动连带同名 .atlas 与 .png 页），
 *   按 Ark-Pets AnimType 的 offsetY 校正落点，播放 pickAnimation 选出的待机动画，
 *   并把命中判定切到 Spine 骨骼包围盒（skeleton.getBounds；取不到回落固定 200×300）。
 * - 监听 window mousemove（50ms 节流 + trailing 兜底），命中状态翻转时调用
 *   window.api.petSetMouseIgnore(!inside)：命中角色 -> 不穿透；空白 -> 穿透。
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

/** 命中区域判定回调：参数为视口坐标（clientX/clientY），返回该点是否落在角色上 */
export type HitTestFn = (x: number, y: number) => boolean

/** mousemove 评估节流间隔（ms） */
const THROTTLE_MS = 50

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

  constructor(canvasParent: HTMLElement) {
    this.app = new Application({ backgroundAlpha: 0, resizeTo: window, antialias: true })
    canvasParent.appendChild(this.app.view as unknown as HTMLCanvasElement)
    window.addEventListener('mousemove', this.onMouseMove)
  }

  get pixiApp(): Application {
    return this.app
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
   * 按 Ark-Pets 动画类别切动画（T9 情绪/移动接此口）；返回实际播放名，无可播返回 null。
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

  private playFirstAvailable(names: string[]): string | null {
    if (names.length === 0) return null
    this.spine?.state.setAnimation(0, names[0], true)
    this.animOffsetY = 0
    return names[0]
  }

  /** 缩放到底部居中落位 + offsetY 校正（Sit=50 / Sleep=25 / 其余=5，见 animMap） */
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
    spine.scale.set(scale)
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
    const s = spine.scale.x
    const x0 = spine.x + b.x * s
    const y0 = spine.y + b.y * s
    return x >= x0 && x <= x0 + b.width * s && y >= y0 && y <= y0 + b.height * s
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.spine = null
    this.cancelTrailing()
    window.removeEventListener('mousemove', this.onMouseMove)
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

  private evaluate(now: number): void {
    this.lastRunAt = now
    const inside = this.hitTest !== null ? this.hitTest(this.pendingX, this.pendingY) : false
    if (inside === this.inside) return // 仅布尔值翻转时发送，避免 IPC 洪水
    this.inside = inside
    console.log(`[PetStage] hit=${inside} -> petSetMouseIgnore(${!inside})`)
    window.api.petSetMouseIgnore(!inside)
  }
}
