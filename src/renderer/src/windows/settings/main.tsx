/** 设置窗口：AI 配置、模型管理（远端下载/本地切换/zip 导入）、偏好（提醒/番茄钟/自启/缩放）。 */

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { AppSettingsShape, ModelEntry } from '../../../../shared/ipc'
import './index.css'

/** AI 预设模板 */
const AI_PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: '自定义', baseUrl: '', model: '' }
]

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section className="section">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

function SettingsWindow(): React.JSX.Element {
  const [settings, setSettings] = useState<AppSettingsShape | null>(null)
  const [localModels, setLocalModels] = useState<ModelEntry[]>([])
  const [remoteModels, setRemoteModels] = useState<ModelEntry[] | null>(null)
  const [remoteError, setRemoteError] = useState('')
  const [search, setSearch] = useState('')
  const [downloading, setDownloading] = useState<Record<string, number>>({})
  const [testResult, setTestResult] = useState('')
  const [testing, setTesting] = useState(false)
  const saveTimer = useRef<number | null>(null)

  const reloadLocal = (): void => {
    window.api.modelsListLocal().then(setLocalModels).catch(() => {})
  }

  useEffect(() => {
    window.api.settingsGet().then(setSettings).catch(() => {})
    window.api.modelsListLocal().then(setLocalModels).catch(() => {})
    const offProgress = window.api.onModelsDownloadProgress(({ dir, pct }) => {
      setDownloading((prev) => ({ ...prev, [dir]: pct }))
    })
    // DEV 冒烟自检：设置加载取证 + 若有本地模型则自跑一次「切换」流程（触发 modelChanged → pet 重载）
    if (import.meta.env.DEV) {
      window.setTimeout(() => {
        void Promise.all([window.api.settingsGet(), window.api.modelsListLocal()]).then(
          ([s, models]) => {
            console.log(
              `[settings-smoke] settings 加载：currentModel=${s.currentModel} petScale=${s.petScale} autostart=${s.autostart}；本地模型 ${models.length} 个`
            )
            const target = models.find((m) => m.skel)
            if (target) {
              void window.api
                .modelsSetCurrent(target.dir)
                .then(() => console.log(`[settings-smoke] 切换指令已发：${target.dir}`))
                .catch((e) => console.warn('[settings-smoke] 切换失败:', String(e)))
            }          }
        )
      }, 2500)
    }
    return () => {
      offProgress()
    }
  }, [])

  // 设置更新（文本类 debounce 600ms，开关/滑杆立即）
  const patch = (p: Partial<AppSettingsShape>, immediate = true): void => {
    setSettings((prev) => (prev ? { ...prev, ...p } : prev))
    if (!immediate) {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        window.api.settingsSet(p).catch(() => {})
      }, 600)
      return
    }
    window.api.settingsSet(p).catch(() => {})
  }

  const filteredRemote = useMemo(() => {
    if (!remoteModels) return null
    const q = search.trim().toLowerCase()
    const list = q
      ? remoteModels.filter((m) => m.name.toLowerCase().includes(q) || m.dir.toLowerCase().includes(q))
      : remoteModels
    return list.slice(0, 80)
  }, [remoteModels, search])

  if (!settings) {
    return <div className="loading">加载设置中…</div>
  }

  return (
    <div id="settings-root">
      <h1>设置</h1>

      <Section title="干员模型">
        <div className="local-list">
          <div className="row-head">
            <span>本地干员（{localModels.length}）</span>
            <button
              className="btn"
              onClick={(): void => {
                window.api
                  .modelsImportZip()
                  .then((r) => {
                    if (r.ok) reloadLocal()
                  })
                  .catch(() => {})
              }}
            >
              导入 zip
            </button>
          </div>
          {localModels.length === 0 && <div className="empty">还没有模型，从下面列表下载一个吧</div>}
          {localModels.map((m) => (
            <div key={m.dir} className="model-row">
              <span className="model-name">
                {m.dir === settings.currentModel ? '● ' : ''}
                {m.name}
              </span>
              <span className="model-actions">
                <button
                  className="btn primary"
                  disabled={m.dir === settings.currentModel || !m.skel}
                  onClick={(): void => {
                    window.api
                      .modelsSetCurrent(m.dir)
                      .then(() => window.api.settingsGet().then(setSettings))
                      .catch((e) => console.error('切换失败:', String(e)))
                  }}
                >
                  {m.dir === settings.currentModel ? '使用中' : '使用'}
                </button>
                <button
                  className="btn danger"
                  title="删除该模型的本地文件"
                  onClick={(): void => {
                    if (!window.confirm(`确定删除干员「${m.name}」的本地模型文件？`)) return
                    window.api
                      .modelsDelete(m.dir)
                      .then(() => {
                        reloadLocal()
                        return window.api.settingsGet().then(setSettings)
                      })
                      .catch((e) => console.error('删除失败:', String(e)))
                  }}
                >
                  删除
                </button>
              </span>
            </div>
          ))}
        </div>
        <div className="remote-list">
          <div className="row-head">
            <span>远端模型库（Ark-Models）</span>
            {remoteModels === null && (
              <button
                className="btn"
                onClick={(): void => {
                  setRemoteError('')
                  window.api
                    .modelsListRemote()
                    .then(setRemoteModels)
                    .catch((e) => setRemoteError(String(e)))
                }}
              >
                加载列表
              </button>
            )}
          </div>
          {remoteError && <div className="error">加载失败：{remoteError}（网络不稳可重试）</div>}
          {remoteModels !== null && (
            <input
              className="input search"
              placeholder="搜索干员名…"
              value={search}
              onChange={(e): void => setSearch(e.target.value)}
            />
          )}
          <div className="remote-scroll">
            {(filteredRemote ?? []).map((m) => {
              const pct = downloading[m.dir]
              const isLocal = localModels.some((l) => l.dir === m.dir)
              return (
                <div key={m.dir} className="model-row">
                  <span className="model-name">{m.name}</span>
                  {pct !== undefined ? (
                    <span className="progress">
                      <span className="progress-bar" style={{ width: `${pct}%` }} />
                      <span className="progress-text">{pct}%</span>
                    </span>
                  ) : isLocal ? (
                    <button className="btn" disabled>
                      已下载
                    </button>
                  ) : (
                    <button
                      className="btn"
                      onClick={(): void => {
                        setDownloading((prev) => ({ ...prev, [m.dir]: 0 }))
                        window.api
                          .modelsDownload(m.dir)
                          .then(() => {
                            setDownloading((prev) => {
                              const next = { ...prev }
                              delete next[m.dir]
                              return next
                            })
                            reloadLocal()
                          })
                          .catch((e) => {
                            console.error('下载失败:', String(e))
                            setDownloading((prev) => {
                              const next = { ...prev }
                              delete next[m.dir]
                              return next
                            })
                          })
                      }}
                    >
                      下载
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      <Section title="桌宠">
        <Field label={`缩放 ${settings.petScale.toFixed(1)}×`}>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={settings.petScale}
            onChange={(e): void => patch({ petScale: Number(e.target.value) })}
          />
        </Field>
        <Field label="开机自启">
          <input
            type="checkbox"
            checked={settings.autostart}
            onChange={(e): void => patch({ autostart: e.target.checked })}
          />
        </Field>
      </Section>

      <Section title="提醒与番茄钟">
        <Field label="提前提醒（分钟）">
          <input
            className="input num"
            type="number"
            min={0}
            max={1440}
            value={settings.reminderLeadMin}
            onChange={(e): void => patch({ reminderLeadMin: Number(e.target.value) || 0 }, false)}
          />
        </Field>
        <Field label="专注时长（分钟）">
          <input
            className="input num"
            type="number"
            min={1}
            max={120}
            value={settings.pomoFocusMin}
            onChange={(e): void => patch({ pomoFocusMin: Number(e.target.value) || 25 }, false)}
          />
        </Field>
        <Field label="休息时长（分钟）">
          <input
            className="input num"
            type="number"
            min={1}
            max={60}
            value={settings.pomoRestMin}
            onChange={(e): void => patch({ pomoRestMin: Number(e.target.value) || 5 }, false)}
          />
        </Field>
      </Section>

      <Section title="AI 对话（可选，OpenAI 兼容接口）">
        <Field label="服务商预设">
          <select
            className="input"
            value={AI_PRESETS.find((p) => p.baseUrl === settings.ai.baseUrl)?.label ?? '自定义'}
            onChange={(e): void => {
              const preset = AI_PRESETS.find((p) => p.label === e.target.value)
              if (preset) patch({ ai: { ...settings.ai, baseUrl: preset.baseUrl, model: preset.model } })
            }}
          >
            {AI_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Base URL">
          <input
            className="input"
            placeholder="https://…/v1"
            value={settings.ai.baseUrl}
            onChange={(e): void => patch({ ai: { ...settings.ai, baseUrl: e.target.value } }, false)}
          />
        </Field>
        <Field label="API Key">
          <input
            className="input"
            type="password"
            placeholder="sk-…"
            value={settings.ai.apiKey}
            onChange={(e): void => patch({ ai: { ...settings.ai, apiKey: e.target.value } }, false)}
          />
        </Field>
        <Field label="模型名">
          <input
            className="input"
            placeholder="glm-4.7"
            value={settings.ai.model}
            onChange={(e): void => patch({ ai: { ...settings.ai, model: e.target.value } }, false)}
          />
        </Field>
        <div className="row-head">
          <span className="hint">配置后可对话并用自然语言管理待办（T13）</span>
          <button
            className="btn"
            disabled={testing}
            onClick={(): void => {
              setTesting(true)
              setTestResult('')
              window.api
                .aiTest()
                .then((r) => {
                  setTestResult(r.ok ? `连接成功（${r.latencyMs}ms）` : `失败：${r.error ?? '未知错误'}`)
                })
                .finally(() => setTesting(false))
            }}
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
        </div>
        {testResult && (
          <div className={testResult.startsWith('连接成功') ? 'ok' : 'error'}>{testResult}</div>
        )}
        <div className="footnote">⚠ API Key 以明文保存在本机设置文件中，请勿在共用电脑上保存重要密钥。</div>
      </Section>

      <div className="footnote center">ArkTodoPet · 模型资产版权归鹰角网络，仅供个人使用</div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsWindow />
  </StrictMode>
)
