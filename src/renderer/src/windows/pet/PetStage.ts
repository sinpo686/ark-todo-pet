/**
 * PetStage：桌宠 pixi 画布封装（透明渲染 + 鼠标穿透控制）。
 *
 * - 构造时创建透明背景的 PIXI.Application 并随窗口尺寸自适应，画布挂载到 canvasParent。
 * - setHitTest 注册「角色命中区域」判定回调（视口坐标）；当前为临时中央矩形，
 *   Task 8 起换成 Spine 骨骼包围盒判定。
 * - 监听 window mousemove（50ms 节流 + trailing 兜底），命中状态翻转时调用
 *   window.api.petSetMouseIgnore(!inside)：
 *     命中区域内 -> 不穿透（可交互）；空白区域 -> 穿透（点击落到桌面/下层窗口）。
 *   穿透态下事件仍能到达页面，依赖 setIgnoreMouseEvents 的 forward:true 转发（见 main/windows.ts）。
 */

// CSP（script-src 'self'）禁 eval，而 pixi 着色器编译依赖 new Function；
// 官方垫片包在 import 时自装补丁（改写 ShaderSystem，免 eval），必须先于 Application 生效
import '@pixi/unsafe-eval'
import { Application } from 'pixi.js'

/** 命中区域判定回调：参数为视口坐标（clientX/clientY），返回该点是否落在角色上 */
export type HitTestFn = (x: number, y: number) => boolean

/** mousemove 评估节流间隔（ms） */
const THROTTLE_MS = 50

export class PetStage {
  private readonly app: Application
  private hitTest: HitTestFn | null = null
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

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
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
