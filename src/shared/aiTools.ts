/** AI 工具调用（function calling）的纯逻辑层：schema、参数校验、关键词匹配。无 IO / electron。 */

import type { Todo, Priority } from './types'

/** OpenAI 兼容 tools 参数（chat/completions 的 tools 字段） */
export const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'add_todo',
      description: '为用户添加一条待办事项',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '待办标题（简短）' },
          due_at: {
            type: 'string',
            description: '截止时间：ISO 8601 或 "YYYY-MM-DD HH:mm" 本地时间；无截止则省略'
          },
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
          notes: { type: 'string', description: '备注（可选）' }
        },
        required: ['title']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_todos',
      description: '查看用户待办清单',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', enum: ['today', 'overdue', 'all'], description: '默认 all' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'complete_todo',
      description: '把用户提到的某条待办标记为完成',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '待办标题的关键词' }
        },
        required: ['keyword']
      }
    }
  }
] as const

/** 解析 AI 给的 due_at：ISO 8601 或 "YYYY-MM-DD HH:mm" 本地时间；解析不了返回 undefined */
export function parseDueAtInput(s: string | undefined, now: number): number | undefined {
  if (s === undefined || s === null || String(s).trim() === '') return undefined
  const str = String(s).trim()
  // ISO 8601（含时区后缀 Z/±hh:mm，或无时区按本地）
  const iso = new Date(str)
  if (!Number.isNaN(iso.getTime())) {
    const t = iso.getTime()
    if (t > now - 365 * 86_400_000 && t < now + 10 * 365 * 86_400_000) return t
  }
  // "YYYY-MM-DD HH:mm" / "YYYY-MM-DD HH:mm:ss"（本地时间）
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(str)
  if (m) {
    const d = new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4]),
      Number(m[5]),
      m[6] ? Number(m[6]) : 0
    )
    if (!Number.isNaN(d.getTime())) return d.getTime()
  }
  return undefined
}

export type ValidatedAddArgs =
  | { ok: true; value: { title: string; dueAt?: number; priority: Priority; notes?: string } }
  | { ok: false; error: string }

/** add_todo 参数校验：title 必填非空；priority 白名单；due_at 可解析（不可解析则忽略时间不报错） */
export function validateAddArgs(args: unknown, now: number): ValidatedAddArgs {
  if (typeof args !== 'object' || args === null) return { ok: false, error: 'args 不是对象' }
  const a = args as Record<string, unknown>
  const title = typeof a.title === 'string' ? a.title.trim() : ''
  if (!title) return { ok: false, error: 'title required' }
  let priority: Priority = 'normal'
  if (a.priority !== undefined) {
    if (a.priority !== 'low' && a.priority !== 'normal' && a.priority !== 'high') {
      return { ok: false, error: `priority 非法: ${String(a.priority)}` }
    }
    priority = a.priority
  }
  const value: { title: string; dueAt?: number; priority: Priority; notes?: string } = {
    title,
    priority
  }
  const dueAt = parseDueAtInput(a.due_at as string | undefined, now)
  if (dueAt !== undefined) value.dueAt = dueAt
  if (typeof a.notes === 'string' && a.notes.trim() !== '') value.notes = a.notes.trim()
  return { ok: true, value }
}

/** complete_todo 的关键词匹配：未完成待办中标题含关键词（大小写不敏感） */
export function completeByKeyword(todos: Todo[], keyword: string): { matched: Todo[] } {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return { matched: [] }
  return { matched: todos.filter((t) => !t.done && t.title.toLowerCase().includes(kw)) }
}
