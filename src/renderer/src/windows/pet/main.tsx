/**
 * 桌宠窗口入口：React 壳（后续 ChatPanel/气泡层在此叠加）+ PetStage 透明 pixi 画布。
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

    // dev 冒烟自检：程序化派发矩形内/外 mousemove 各一次，
    // 主进程 [ipc] pet:set-mouse-ignore 日志应看到 ignore=false -> true 翻转
    const selfCheckTimers: number[] = []
    if (import.meta.env.DEV) {
      selfCheckTimers.push(
        window.setTimeout(() => {
          // 角色底部居中：模型主体覆盖窗口中下部
          window.dispatchEvent(
            new MouseEvent('mousemove', {
              clientX: window.innerWidth / 2,
              clientY: window.innerHeight - 40
            })
          )
        }, 2500),
        window.setTimeout(
          () => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 2, clientY: 2 })),
          2700
        )
      )
    }

    return () => {
      disposed = true
      selfCheckTimers.forEach((t) => window.clearTimeout(t))
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
      {/* T9+ ChatPanel / 气泡层叠加于此（保持 React 壳） */}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetWindow />
  </StrictMode>
)
