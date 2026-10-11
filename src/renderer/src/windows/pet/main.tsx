/**
 * 桌宠窗口入口：React 壳（后续 ChatPanel/气泡层在此叠加）+ PetStage 透明 pixi 画布
 * + T9 行为接线（单击开待办面板 / 情绪联动走动概率 / 番茄钟坐姿 / 提醒动作）。
 * 挂载后经 IPC 取本地模型清单，加载首个含 .skel 的模型（Spine 3.8 二进制）；
 * 无模型 / 加载失败时显示引导文案（正式下载入口在设置页 T12）。
 */

import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PetStage } from './PetStage'

type SpineState = 'loading' | 'ok' | 'no-model' | 'failed'

function PetWindow(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [spineState, setSpineState] = useState<SpineState>('loading')
  const [spineError, setSpineError] = useState('')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    const stage = new PetStage(host)

    // T9 行为接线：单击 → 待办面板；窗口移动 → 主进程 setPosition（渲染层已节流）
    let behaviorStarted = false
    const startBehavior = (): void => {
      if (behaviorStarted || disposed) return
      behaviorStarted = true
      stage.startBehavior({
        onPointerClick: (): void => window.api.openTodoPanel(),
        onWindowMove: (x, y): void => window.api.petMoveWindow(x, y)
      })
    }

    window.api
      .modelsListLocal()
      .then(async (models) => {
        const target = models.find((m) => m.skel)
        if (disposed) return
        if (!target || !target.skel) {
          console.warn('[pet] 未找到本地干员模型（userData/models/ 无 .skel 目录）')
          setSpineState('no-model')
          return
        }
        try {
          await stage.loadSpine(target.dir, target.skel, target.mapping)
          if (disposed) return
          startBehavior()
          setSpineState('ok')
        } catch (err) {
          console.error('[pet] Spine 加载失败:', err)
          if (disposed) return
          setSpineError(String(err))
          setSpineState('failed')
        }
      })
      .catch((err: unknown) => {
        console.error('[pet] modelsListLocal 失败:', err)
        if (!disposed) {
          setSpineError(String(err))
          setSpineState('failed')
        }
      })

    // 情绪联动：影响走动概率与动画选片（moodParams 在 PetStage 内消费）
    const offMood = window.api.onMoodChanged((mood) => stage.setMood(mood))
    // 番茄钟：focus 期间强制坐姿，rest/idle 解除
    const offPomo = window.api.onPomoChanged((s) => stage.holdSit(s.phase === 'focus'))
    window.api
      .getPomoState()
      .then((s) => stage.holdSit(s.phase === 'focus'))
      .catch(() => {})
    // 待办提醒：special 动画一次
    const offRemind = window.api.onRemindTrigger(() => stage.triggerRemind())

    // dev 冒烟自检（T8 命中穿透 + T9 指针/行为路由）：
    // 2.5s/2.7s 矩形内/外 mousemove → 主进程 [ipc] pet:set-mouse-ignore 翻转；
    // 4s   pointerdown/up 原地点击 → classify=click → openTodoPanel（主进程 [windows] todo 面板已创建）；
    // 6s   按下 + 上移 50px + 松开 → drag（拎起）→ fall → idle（落地）；
    // 8s   forceAction('walk') → [behavior] action=idle -> walk，窗口沿底边移动；
    // 10s  连两次快速点击 → 第一击 click（面板聚焦），第二击 classify=double → interact。
    const selfCheckTimers: number[] = []
    if (import.meta.env.DEV) {
      const petPoint = (): { x: number; y: number } => ({
        x: window.innerWidth / 2,
        y: window.innerHeight - 40
      })
      const firePointer = (type: string, x: number, y: number): void => {
        const canvas = document.querySelector('canvas')
        if (!canvas) {
          console.warn(`[smoke] 无画布，跳过 ${type}`)
          return
        }
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: type === 'pointerup' ? 0 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: x,
            clientY: y,
            screenX: window.screenX + x,
            screenY: window.screenY + y,
            bubbles: true
          })
        )
      }
      const at = (ms: number, fn: () => void): number =>
        window.setTimeout(() => {
          if (!disposed) fn()
        }, ms)
      const whenReady =
        (fn: () => void): (() => void) =>
        (): void => {
          if (!stage.behaviorReady) {
            console.warn('[smoke] 行为未就绪，跳过一步')
            return
          }
          fn()
        }

      selfCheckTimers.push(
        // T8 命中穿透翻转
        at(2500, () =>
          window.dispatchEvent(
            new MouseEvent('mousemove', { clientX: petPoint().x, clientY: petPoint().y })
          )
        ),
        at(2700, () =>
          window.dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 2 }))
        ),
        // T9 click → openTodoPanel
        at(4000, () =>
          whenReady(() => {
            const p = petPoint()
            firePointer('pointerdown', p.x, p.y)
            firePointer('pointerup', p.x, p.y)
          })()
        ),
        // T9 drag → fall → idle
        at(6000, () =>
          whenReady(() => {
            const p = petPoint()
            firePointer('pointerdown', p.x, p.y)
          })()
        ),
        at(6150, () =>
          whenReady(() => {
            firePointer('pointermove', petPoint().x, petPoint().y - 50)
          })()
        ),
        at(6500, () =>
          whenReady(() => {
            firePointer('pointerup', petPoint().x, petPoint().y - 50)
          })()
        ),
        // T9 walk 行为循环
        at(8000, () =>
          whenReady(() => {
            stage.forceAction('walk')
          })()
        ),
        // T9 double → interact
        at(10000, () =>
          whenReady(() => {
            const p = petPoint()
            firePointer('pointerdown', p.x, p.y)
            firePointer('pointerup', p.x, p.y)
          })()
        ),
        at(10150, () =>
          whenReady(() => {
            const p = petPoint()
            firePointer('pointerdown', p.x, p.y)
            firePointer('pointerup', p.x, p.y)
          })()
        )
      )
    }

    return () => {
      disposed = true
      selfCheckTimers.forEach((t) => window.clearTimeout(t))
      offMood()
      offPomo()
      offRemind()
      stage.destroy()
    }
  }, [])

  return (
    <div id="pet-window-root" style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {spineState !== 'ok' && spineState !== 'loading' && (
        <div
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            maxWidth: 280,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'rgba(15,23,42,0.82)',
            color: '#e2e8f0',
            fontSize: 12,
            lineHeight: 1.6,
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'none',
            userSelect: 'none'
          }}
        >
          {spineState === 'no-model'
            ? '未找到干员模型。请把 Ark-Models 的模型目录（含 .atlas/.png/.skel）放入应用的 models/ 文件夹，或在设置中下载（即将上线）。'
            : `干员模型加载失败，请检查模型文件是否完整。${spineError ? `（${spineError}）` : ''}`}
        </div>
      )}
      {/* T10+ ChatPanel / 气泡层叠加于此（保持 React 壳） */}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetWindow />
  </StrictMode>
)
