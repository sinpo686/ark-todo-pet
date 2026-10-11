/**
 * AI 对话服务（主进程）：OpenAI 兼容 chat/completions + function calling 工具循环。
 * - 上下文仅内存保留最近 20 条（不落盘，规格 §7.2）
 * - 工具：add_todo / list_todos / complete_todo（经与 UI 同一 mutate 路径，source='ai'）
 * - 失败熔断：连续 3 次失败本会话禁用（规格 §7.4）
 */

import { net } from 'electron'
import { AI_TOOLS, validateAddArgs, completeByKeyword } from '../shared/aiTools'
import { groupTodos } from '../shared/todoStore'
import type { Todo, Priority } from '../shared/types'
import type { Mood } from '../shared/mood'
import type { AiConfig } from './store'

/** UI 侧聊天消息（shared 形状，renderer 直接渲染） */
export interface ChatMsg {
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 工具执行提示行（如「已添加：交报告」） */
  toolNote?: boolean
}

/** OpenAI 协议层消息（含 tool 细节，仅本模块使用） */
interface ApiMsg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
  name?: string
}

export interface AiServiceDeps {
  getAiConfig: () => AiConfig
  getTodos: () => Todo[]
  getMood: () => Mood
  addTodo: (input: { title: string; dueAt?: number; priority: Priority; notes?: string; source: 'ai' }) => Promise<void>
  completeTodo: (id: string) => Promise<void>
}

const MAX_HISTORY = 20
const MAX_TOOL_ROUNDS = 3
const FAIL_LIMIT = 3
const TIMEOUT_MS = 30_000

function buildSystemPrompt(todos: Todo[], mood: Mood): string {
  const now = Date.now()
  const g = groupTodos(todos, now)
  const fmt = (t: Todo): string => {
    const due = t.dueAt ? `（截止 ${new Date(t.dueAt).toLocaleString('zh-CN', { hour12: false })}）` : ''
    return `- ${t.title}${due}`
  }
  const overdue = g.overdue.slice(0, 8).map(fmt).join('\n')
  const today = g.upcoming.slice(0, 8).map(fmt).join('\n')
  const undated = g.undated.slice(0, 5).map(fmt).join('\n')
  const moodHint =
    mood === 'gloomy' ? '用户待办堆积较多，语气可以关切一些。' : mood === 'happy' ? '用户完成得不错，语气轻快一些。' : ''
  return [
    '你是用户的桌面干员助理（明日方舟风格），语气简洁干练、少语气词，中文回复。',
    `当前时间：${new Date(now).toLocaleString('zh-CN', { hour12: false })}。${moodHint}`,
    '你可以用工具管理用户的待办：用户表达"要做某事/提醒我"时调用 add_todo（时间解析成 due_at）；用户问待办时调用 list_todos；用户说完成某事时调用 complete_todo。',
    '除用户明确要求外不要主动罗列全部待办。',
    '【当前待办】',
    `逾期（${g.overdue.length}）：\n${overdue || '（无）'}`,
    `今天与未来（${g.upcoming.length}）：\n${today || '（无）'}`,
    `无日期（${g.undated.length}）：\n${undated || '（无）'}`
  ].join('\n')
}

export function createAiService(deps: AiServiceDeps): {
  send: (text: string) => Promise<ChatMsg[]>
  getUiHistory: () => ChatMsg[]
  isDisabled: () => boolean
  /** 测试/恢复用 */
  resetFailures: () => void
} {
  let history: ApiMsg[] = []
  let uiHistory: ChatMsg[] = []
  let failCount = 0

  const trimHistory = (): void => {
    if (history.length > MAX_HISTORY) {
      history = history.slice(-MAX_HISTORY)
    }
  }

  const pushUi = (m: ChatMsg): void => {
    uiHistory.push(m)
    if (uiHistory.length > MAX_HISTORY * 2) uiHistory = uiHistory.slice(-MAX_HISTORY * 2)
  }

  /** 执行一次工具调用，返回给 API 的 tool 结果消息 + 给 UI 的系统行 */
  async function executeTool(
    name: string,
    argsJson: string
  ): Promise<{ apiMsg: ApiMsg; uiLine: ChatMsg | null }> {
    const id = `t${Date.now()}${Math.floor(Math.random() * 1000)}`
    let result = ''
    let uiLine: ChatMsg | null = null
    let args: unknown = {}
    try {
      args = JSON.parse(argsJson || '{}')
    } catch {
      result = '参数不是合法 JSON'
    }
    if (result === '') {
      if (name === 'add_todo') {
        const v = validateAddArgs(args, Date.now())
        if (!v.ok) {
          result = `参数错误：${v.error}`
        } else {
          await deps.addTodo({ ...v.value, source: 'ai' })
          const due = v.value.dueAt
            ? `，截止 ${new Date(v.value.dueAt).toLocaleString('zh-CN', { hour12: false })}`
            : ''
          result = `已添加待办「${v.value.title}」${due}`
          uiLine = { role: 'system', content: `✓ ${result}`, toolNote: true }
        }
      } else if (name === 'list_todos') {
        const filter = (args as { filter?: string }).filter ?? 'all'
        const now = Date.now()
        const g = groupTodos(deps.getTodos(), now)
        const lines: string[] = []
        if (filter === 'overdue' || filter === 'all') lines.push(`逾期 ${g.overdue.length} 条`)
        if (filter === 'today' || filter === 'all') {
          const today = g.upcoming
            .filter((t) => new Date(t.dueAt ?? 0).toDateString() === new Date(now).toDateString())
            .concat(g.overdue)
          lines.push(`今天 ${today.length} 条`)
        }
        if (filter === 'all') lines.push(`无日期 ${g.undated.length} 条`)
        const all = [...g.overdue, ...g.upcoming, ...g.undated]
          .slice(0, 15)
          .map((t) => `${t.done ? '[x]' : '[ ]'} ${t.title}`)
          .join('\n')
        result = `${lines.join('，')}\n${all}`
      } else if (name === 'complete_todo') {
        const kw = (args as { keyword?: string }).keyword ?? ''
        const { matched } = completeByKeyword(deps.getTodos(), kw)
        if (matched.length === 1) {
          await deps.completeTodo(matched[0].id)
          result = `已完成「${matched[0].title}」`
          uiLine = { role: 'system', content: `✓ ${result}`, toolNote: true }
        } else if (matched.length === 0) {
          result = `没有找到包含「${kw}」的未完成待办`
        } else {
          result = `匹配到多条：\n${matched.map((t) => `- ${t.title}`).join('\n')}\n请让用户明确指出要完成哪一条。`
        }
      } else {
        result = `未知工具：${name}`
      }
    }
    return {
      apiMsg: { role: 'tool', content: result, tool_call_id: id, name },
      uiLine
    }
  }

  async function callApi(messages: ApiMsg[]): Promise<Response> {
    const cfg = deps.getAiConfig()
    return net.fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, tools: AI_TOOLS }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  }

  return {
    isDisabled: (): boolean => failCount >= FAIL_LIMIT,
    resetFailures: (): void => {
      failCount = 0
    },
    getUiHistory: (): ChatMsg[] => [...uiHistory],
    async send(text: string): Promise<ChatMsg[]> {
      const out: ChatMsg[] = []
      const cfg = deps.getAiConfig()
      if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
        const m: ChatMsg = {
          role: 'assistant',
          content: '还没有配置 AI。打开 设置 → AI 对话，填写 Base URL / API Key / 模型名（或选预设）后就能和我聊天、口头添加待办了。'
        }
        pushUi({ role: 'user', content: text })
        pushUi(m)
        out.push(m)
        return out
      }
      if (failCount >= FAIL_LIMIT) {
        const m: ChatMsg = { role: 'assistant', content: '（AI 连续失败已达上限，本次会话已停用。重启应用可重试。）' }
        out.push(m)
        return out
      }

      pushUi({ role: 'user', content: text })
      const messages: ApiMsg[] = [
        { role: 'system', content: buildSystemPrompt(deps.getTodos(), deps.getMood()) },
        ...history,
        { role: 'user', content: text }
      ]

      try {
        let round = 0
        while (round < MAX_TOOL_ROUNDS) {
          round++
          const res = await callApi(messages)
          if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`HTTP ${res.status} ${body.slice(0, 160)}`)
          }
          const data = (await res.json()) as {
            choices: Array<{
              message: { role: 'assistant'; content: string | null; tool_calls?: ApiMsg['tool_calls'] }
            }>
          }
          const msg = data.choices?.[0]?.message
          if (!msg) throw new Error('响应缺少 choices[0].message')

          if (msg.tool_calls && msg.tool_calls.length > 0) {
            messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls })
            for (const call of msg.tool_calls) {
              const { apiMsg, uiLine } = await executeTool(
                call.function.name,
                call.function.arguments
              )
              apiMsg.tool_call_id = call.id
              messages.push(apiMsg)
              if (uiLine) {
                pushUi(uiLine)
                out.push(uiLine)
              }
            }
            continue // 带着 tool 结果再问一轮
          }

          // 纯文本回复：收尾
          const reply = msg.content ?? '（空回复）'
          messages.push({ role: 'assistant', content: reply })
          history = messages.slice(1) // 去掉 system（每次重建）
          trimHistory()
          pushUi({ role: 'assistant', content: reply })
          out.push({ role: 'assistant', content: reply })
          failCount = 0
          return out
        }
        throw new Error(`工具调用轮数超过 ${MAX_TOOL_ROUNDS}，中止`)
      } catch (err) {
        failCount++
        console.error(`[ai] 请求失败（${failCount}/${FAIL_LIMIT}）:`, String(err))
        const m: ChatMsg = {
          role: 'assistant',
          content: `请求失败：${String(err)}${failCount >= FAIL_LIMIT ? '（连续失败达上限，本次会话已停用 AI）' : ''}`
        }
        pushUi(m)
        out.push(m)
        return out
      }
    }
  }
}
