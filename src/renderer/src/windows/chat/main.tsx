/** 干员通讯（独立窗口，T13 修正版）：不再塞在桌宠窗口内（会被小缩放裁切、且受角色命中穿透影响无法点击/输入）。 */

import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ChatMsgShape } from '../../../../shared/ipc'
import './index.css'

function ChatWindow(): React.JSX.Element {
  const [messages, setMessages] = useState<ChatMsgShape[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [attachment, setAttachment] = useState<{ name: string; text: string; truncated: boolean } | null>(null)
  const [attachError, setAttachError] = useState('')
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
    const att = attachment // 本轮附件（随发随清，一次性）
    setInput('')
    setAttachment(null)
    setSending(true)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: att ? `${text}\n📎 ${att.name}` : text }
    ])
    window.api
      .chatSend(text, att ?? undefined)
      .then((replies) => {
        setMessages((prev) => [...prev, ...replies])
      })
      .catch((e) => {
        setMessages((prev) => [...prev, { role: 'assistant', content: `发送失败：${String(e)}` }])
      })
      .finally(() => setSending(false))
  }

  const attach = (): void => {
    setAttachError('')
    window.api
      .chatAttach()
      .then((r) => {
        if (!r.ok || !r.name || r.text === undefined) {
          if (r.error && r.error !== '已取消') setAttachError(r.error)
          return
        }
        setAttachment({ name: r.name, text: r.text, truncated: r.truncated ?? false })
      })
      .catch((e) => setAttachError(String(e)))
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
      {attachment && (
        <div className="chat-attach-chip" title={attachment.truncated ? '文档过长，仅取前 3 万字' : attachment.name}>
          <span className="chip-name">
            📎 {attachment.name}（{attachment.text.length} 字{attachment.truncated ? '，已截断' : ''}）
          </span>
          <button type="button" className="chip-remove" onClick={(): void => setAttachment(null)} aria-label="移除附件">
            ×
          </button>
        </div>
      )}
      {attachError && <div className="chat-attach-error">{attachError}</div>}
      <div className="chat-input-row">
        <button
          type="button"
          className="chat-attach-btn"
          title="附加文档（pdf / docx / txt / md）——她可以读文档并提取行动项"
          onClick={attach}
        >
          📎
        </button>
        <input
          className="chat-input"
          value={input}
          placeholder={attachment ? '文档已附上，说要提取哪些待办…' : '输入消息，回车发送…'}
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
