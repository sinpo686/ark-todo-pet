/** IPC 通道常量与载荷类型。main / preload / renderer 三侧共同的契约，禁止 import electron。 */

import type { Todo } from './types'
import type { PomoState } from './pomodoro'
import type { ReminderEvent } from './reminders'
import type { Mood } from './mood'

export const IPC = {
  petSetMouseIgnore: 'pet:set-mouse-ignore',
  petMoveWindow: 'pet:move-window',
  openTodoPanel: 'todo:open-panel',
  todoPanelPin: 'todo:panel-pin',
  todosChanged: 'todos:changed',
  todosMutate: 'todos:mutate',
  pomoCommand: 'pomo:command',
  pomoChanged: 'pomo:changed',
  moodChanged: 'mood:changed',
  remindTrigger: 'remind:trigger',
  openSettings: 'settings:open',
  modelsListLocal: 'models:list-local',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  modelsListRemote: 'models:list-remote',
  modelsDownload: 'models:download',
  modelsDownloadProgress: 'models:download-progress',
  modelsImportZip: 'models:import-zip',
  modelsSetCurrent: 'models:set-current',
  modelsDelete: 'models:delete',
  modelChanged: 'model:changed',
  aiTest: 'ai:test',
  chatSend: 'chat:send',
  chatHistory: 'chat:history',
  openChat: 'chat:open'
} as const

export type TodosMutateMsg =
  | {
      op: 'add'
      payload: {
        title: string
        dueAt?: number
        priority?: string
        notes?: string
        source?: 'manual' | 'ai'
        id?: string
      }
    }
  | { op: 'toggle'; payload: { id: string } }
  | {
      op: 'edit'
      payload: {
        id: string
        patch: { title?: string; notes?: string; dueAt?: number; priority?: string }
      }
    }
  | { op: 'delete'; payload: { id: string } }

/** 模型库条目（本地含 skel 文件名，供 renderer 直接构造 arkmodel:// URL） */
export interface ModelEntry {
  /** userData/models/ 下的目录名（Ark-Models 仓库内同名） */
  dir: string
  /** 展示名（中文干员名；缺省回落目录名） */
  name: string
  /** 目录内首个 .skel 文件名（仅本地） */
  skel?: string
  /** 人工动画映射覆盖（<模型目录>/mapping.json，键=AnimKind，值=动画全名；优先于正则启发式） */
  mapping?: Partial<Record<string, string>>
}

/** renderer 侧 window.api 的形状（preload 按此实现；UI 任务按此消费） */
export interface ApiShape {
  petSetMouseIgnore(ignore: boolean): void
  /** 移动桌宠窗口到屏幕坐标（走动/拖拽/下落；主进程一次性 setPosition，节流由渲染层做） */
  petMoveWindow(x: number, y: number): void
  openTodoPanel(): void
  todoPanelPin(pinned: boolean): void
  todosMutate(msg: TodosMutateMsg): void
  pomoCommand(op: 'start' | 'stop'): void
  openSettings(): void
  getTodos(): Promise<Todo[]>
  getPomoState(): Promise<PomoState>
  modelsListLocal(): Promise<ModelEntry[]>
  settingsGet(): Promise<AppSettingsShape>
  settingsSet(patch: Partial<AppSettingsShape>): Promise<void>
  modelsListRemote(): Promise<ModelEntry[]>
  modelsDownload(dir: string): Promise<void>
  onModelsDownloadProgress(cb: (p: { dir: string; pct: number }) => void): () => void
  modelsImportZip(): Promise<{ ok: boolean; dir?: string; error?: string }>
  modelsSetCurrent(dir: string): Promise<void>
  modelsDelete(dir: string): Promise<void>
  onModelChanged(cb: (entry: ModelEntry) => void): () => void
  aiTest(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>
  openChat(): void
  chatSend(text: string): Promise<ChatMsgShape[]>
  chatGetHistory(): Promise<ChatMsgShape[]>
  onTodosChanged(cb: (todos: Todo[]) => void): () => void
  onPomoChanged(cb: (state: PomoState) => void): () => void
  onMoodChanged(cb: (mood: Mood) => void): () => void
  onRemindTrigger(cb: (event: ReminderEvent) => void): () => void
}

/** settings:get / settings:set 的载荷形状（与 main 侧 AppSettings 对应，electron 无关） */
export interface AppSettingsShape {
  autostart: boolean
  currentModel: string | null
  reminderLeadMin: number
  pomoFocusMin: number
  pomoRestMin: number
  petScale: number
  ai: { baseUrl: string; apiKey: string; model: string }
}

/** 聊天消息（UI 渲染形状） */
export interface ChatMsgShape {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolNote?: boolean
}
