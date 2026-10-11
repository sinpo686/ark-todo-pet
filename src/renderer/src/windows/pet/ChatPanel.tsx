/** 桌宠窗聊天层（T13）：右键桌宠唤起；Esc/× 收起；未配置 AI 时显示引导。 */

import { useEffect, useRef, useState } from 'react'
import type { ChatMsgShape } from '../../../../shared/ipc'
import './index.css'

export function ChatPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
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
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages])

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
    <div className="chat-panel">
      <div className="chat-head">
        <span>干员通讯</span>
        <button className="chat-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">和我聊聊，或说「明天下午3点提醒我交报告」。</div>
        )}
        {messages.map((m, i) =>
          m.toolNote ? (
            <div key={i} className="chat-tool">
              {m.content}
            </div>
          ) : (
            <div key={i} className={`chat-msg ${m.role}`}>
              {m.content}
            </div>
          )
        )}
        {sending && <div className="chat-tool">…</div>}
      </div>
      <div className="chat-input-row">
        <input
          className="chat-input"
          value={input}
          placeholder="输入消息，回车发送…"
          onChange={(e): void => setInput(e.target.value)}
          onKeyDown={(e): void => {
            if (e.key === 'Enter') send()
          }}
        />
        <button className="chat-send" onClick={send} disabled={sending || !input.trim()}>
          发送
        </button>
      </div>
    </div>
  )
}
