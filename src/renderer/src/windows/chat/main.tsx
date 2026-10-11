/** 干员通讯（独立窗口，T13 修正版）：不再塞在桌宠窗口内（会被小缩放裁切、且受角色命中穿透影响无法点击/输入）。 */

import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ChatMsgShape } from '../../../../shared/ipc'
import './index.css'

function ChatWindow(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMsgShape[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api
      .chatGetHistory()
      .then((h) => setMessages(h))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        window.close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

  // DEV 冒烟：加载后自动发一条，未配置 key 时应收到引导回复（取证主进程→聊天窗链路）
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const t = window.setTimeout(() => {
      void window.api.chatSend('冒烟测试').then((replies) => {
        console.log(`[chat-smoke] 回复 ${replies.length} 条：${replies[0]?.content.slice(0, 40) ?? '（无）'}…`)
      })
    }, 2000)
    return () => window.clearTimeout(t)
  }, [])

  const send = (): void => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setSending(true)
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    window.api
      .chatSend(text)
      .then((replies) => {
        setMessages((prev) => [...prev, ...replies])
      })
      .catch((e) => {
        setMessages((prev) => [...prev, { role: 'assistant', content: `发送失败：${String(e)}` }])
      })
      .finally(() => setSending(false))
  }

  return (
    <div className="chat-root">
      <header className="chat-titlebar">
        <span className="chat-title">干员通讯</span>
        <button type="button" className="chat-close" onClick={(): void => window.close()} aria-label="关闭">
          ×
        </button>
      </header>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">和我聊聊，或说「明天下午3点提醒我交报告」。</div>
        )}
        {messages.map((m, i) =>
          m.toolNote ? (
            <div key={i} className="chat-toolnote">
              {m.content}
            </div>
          ) : (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.content}
            </div>
          )
        )}
        {sending && <div className="chat-toolnote">…</div>}
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          value={input}
          placeholder="输入消息，回车发送…"
          autoFocus
          onChange={(e): void => setInput(e.target.value)}
          onKeyDown={(e): void => {
            if (e.key === 'Enter') send()
          }}
        />
        <button type="button" className="chat-send" onClick={send} disabled={sending || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChatWindow />
  </StrictMode>
)
