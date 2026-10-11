/**
 * 桌宠窗口入口：React 壳（后续 ChatPanel/气泡层在此叠加）+ PetStage 透明 pixi 画布
 * + T9 行为接线（单击开待办面板 / 情绪联动走动概率 / 番茄钟坐姿 / 提醒动作）。
 * 挂载后经 IPC 取本地模型清单，加载首个含 .skel 的模型（Spine 3.8 二进制）；
 * 无模型 / 加载失败时显示引导文案（正式下载入口在设置页 T12）。
 */

import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PetStage } from './PetStage'
import { ChatPanel } from './ChatPanel'

type SpineState = 'loading' | 'ok' | 'no-model' | 'failed'

function PetWindow(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [spineState, setSpineState] = useState<SpineState>('loading')
  const [spineError, setSpineError] = useState('')
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    const stage = new PetStage(host)

    // T9 行为接线：单击 → 待办面板（PetStage 内已做 300ms 双击消歧延迟派发，计划 §4.3）；
    // 窗口移动 → 主进程 setPosition（渲染层已节流）。clickDispatchCount 供 dev 冒烟取证
    let clickDispatchCount = 0
    let behaviorStarted = false
    const startBehavior = (): void => {
      if (behaviorStarted || disposed) return
      behaviorStarted = true
      stage.startBehavior({
        onPointerClick: (): void => {
          clickDispatchCount++
          console.log(`[pet] onPointerClick -> openTodoPanel（第 ${clickDispatchCount} 次）`)
          window.api.openTodoPanel()
        },
        onWindowMove: (x, y): void => window.api.petMoveWindow(x, y),
        onContextMenu: (): void => {
          console.log('[pet] 右键 -> 切换聊天层')
          setChatOpen((v) => !v)
        }
      })
    }

    const loadEntry = async (
      target: { dir: string; skel?: string; mapping?: Partial<Record<string, string>> } | undefined
    ): Promise<void> => {
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
    }

    // 启动选模：优先设置里的 currentModel（T12 切换干员），否则首个含 .skel 的本地模型
    Promise.all([window.api.modelsListLocal(), window.api.settingsGet()])
      .then(([models, settings]) => {
        if (disposed) return
        const target =
          models.find((m) => m.dir === settings.currentModel && m.skel) ??
          models.find((m) => m.skel)
        return loadEntry(target)
      })
      .catch((err: unknown) => {
        console.error('[pet] 模型清单/设置读取失败:', err)
        if (!disposed) {
          setSpineError(String(err))
          setSpineState('failed')
        }
      })

    // 切换干员（托盘菜单 / 设置页）→ 重载 Spine
    const offModelChanged = window.api.onModelChanged((entry) => {
      console.log(`[pet] 收到切换干员: ${entry.dir}（${entry.name}）`)
      setSpineState('loading')
      loadEntry(entry)
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

    // dev 冒烟自检（T8 命中穿透 + T9 指针/行为路由 + §4.3 单击双击消歧）：
    // 2.5s/2.7s  矩形内/外 mousemove → 主进程 [ipc] pet:set-mouse-ignore 翻转；
    // 4s   pointerdown/up 原地点击 → classify=click 挂起；
    // 4.5s 取证：300ms 已过 → [pet-pointer] 单击确认 + [pet] onPointerClick（计数=1），
    //            主进程 [windows] todo 面板已创建；
    // 6s   按下 + 上移 50px + 松开 → drag（拎起）→ fall → idle（落地）；
    // 8s   forceAction('walk') → [behavior] action=idle -> walk，窗口沿底边移动；
    // 10s/10.15s 连两次快速点击 → 第一击挂起被第二击 down 取消（无单击确认日志），
    //            第二击 classify=double → interact；
    // 10.7s 取证：单击派发计数仍=1（双击未弹面板）。
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
        // T9 click → 挂起；4.5s 取证 300ms 延迟派发（单击 → openTodoPanel）
        at(4000, () =>
          whenReady(() => {
            const p = petPoint()
            firePointer('pointerdown', p.x, p.y)
            firePointer('pointerup', p.x, p.y)
          })()
        ),
        at(4500, () =>
          console.log(
            `[smoke] 单击取证：派发计数=${clickDispatchCount}（期望=1，300ms 延迟已过应已派发）`
          )
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
        // T9 double → interact（第一击挂起派发被第二击 down 取消）
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
        ),
        // 双击序列后 300ms+ 取证：计数未增长 → 双击未弹面板
        at(10700, () =>
          console.log(
            `[smoke] 双击取证：派发计数=${clickDispatchCount}（期望仍=1，第一击派发已被取消）`
          )
        ),
        // T12 冒烟：12s 打开设置窗（settings-smoke 2.5s 后自跑切换 → modelChanged 回流本页）
        at(12000, () => window.api.openSettings()),
        // T13 冒烟：14s 右键（命中角色）→ 聊天层打开；16s 自动发一条 → 未配置 AI 的引导回复取证
        at(14000, () => {
          const canvas = document.querySelector('canvas')
          if (canvas) {
            canvas.dispatchEvent(
              new MouseEvent('contextmenu', {
                clientX: window.innerWidth / 2,
                clientY: window.innerHeight - 40,
                bubbles: true
              })
            )
          }
        }),
        at(16500, () => {
          const input = document.querySelector<HTMLInputElement>('.chat-input')
          if (!input) {
            console.warn('[chat-smoke] 聊天层未打开（contextmenu 未生效）')
            return
          }
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
          setter?.call(input, '冒烟测试')
          input.dispatchEvent(new Event('input', { bubbles: true }))
          window.setTimeout(() => {
            input.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
            )
          }, 100)
        }),
        at(19000, () => {
          const last = document.querySelector('.chat-list > div:last-child')
          console.log(
            `[chat-smoke] 最后一条消息：${last?.textContent?.slice(0, 60) ?? '（无）'}（未配置 key 时应为引导文案）`
          )
        })
      )
    }

    return () => {
      disposed = true
      selfCheckTimers.forEach((t) => window.clearTimeout(t))
      offMood()
      offPomo()
      offRemind()
      offModelChanged()
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
            ? '未找到干员模型。点桌宠打开待办面板 → 右上角 ⚙ 设置 → 干员模型，从远端模型库下载；或把模型目录（含 .atlas/.png/.skel）放入应用的 models/ 文件夹。'
            : `干员模型加载失败，请检查模型文件是否完整。${spineError ? `（${spineError}）` : ''}`}
        </div>
      )}
      {/* T13 聊天层（右键桌宠唤起）；T11 气泡层后续叠加于此 */}
      {chatOpen && <ChatPanel onClose={(): void => setChatOpen(false)} />}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetWindow />
  </StrictMode>
)
