/**
 * 桌宠窗口入口：React 壳（后续 ChatPanel/气泡层在此叠加）+ PetStage 透明 pixi 画布。
 * 当前临时命中区：窗口中央 200×300 半透明矩形（Task 8 换成 Spine 骨骼包围盒）。
 */

import { StrictMode, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { Graphics } from 'pixi.js'
import { PetStage } from './PetStage'

/** 临时命中区尺寸（可视化 = 中央半透明矩形；T8 换 Spine 骨骼包围盒） */
const HIT_AREA = { width: 200, height: 300 }

function PetWindow(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const stage = new PetStage(host)

    // ---- 临时可视化命中区：中央半透明矩形，与下方 hitTest 判定严格一致 ----
    const rect = new Graphics()
    rect.beginFill(0x38bdf8, 0.35)
    rect.lineStyle(2, 0x38bdf8, 0.9)
    rect.drawRect(-HIT_AREA.width / 2, -HIT_AREA.height / 2, HIT_AREA.width, HIT_AREA.height)
    rect.endFill()
    rect.position.set(stage.pixiApp.screen.width / 2, stage.pixiApp.screen.height / 2)
    stage.pixiApp.stage.addChild(rect)

    stage.setHitTest((x, y) => {
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      return Math.abs(x - cx) <= HIT_AREA.width / 2 && Math.abs(y - cy) <= HIT_AREA.height / 2
    })

    // dev 冒烟自检：程序化派发矩形内/外 mousemove 各一次，
    // 主进程 [ipc] pet:set-mouse-ignore 日志应看到 ignore=false -> true 翻转
    const selfCheckTimers: number[] = []
    if (import.meta.env.DEV) {
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      selfCheckTimers.push(
        window.setTimeout(
          () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy })),
          300
        ),
        window.setTimeout(
          () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 2 })),
          450
        )
      )
    }

    return () => {
      selfCheckTimers.forEach((t) => window.clearTimeout(t))
      stage.destroy()
    }
  }, [])

  return (
    <div id="pet-window-root" style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {/* T9+ ChatPanel / 气泡层叠加于此（保持 React 壳） */}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetWindow />
  </StrictMode>
)
