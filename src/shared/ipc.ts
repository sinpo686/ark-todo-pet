/** IPC 通道常量与载荷类型。main / preload / renderer 三侧共同的契约，禁止 import electron。 */

import type { Todo } from './types'
import type { PomoState } from './pomodoro'
import type { ReminderEvent } from './reminders'
import type { Mood } from './mood'

export const IPC = {
  petSetMouseIgnore: 'pet:set-mouse-ignore',
  /** 渲染层上报角色命中盒（视口坐标）；主进程轮询光标权威判定穿透 */
  petSetHitbox: 'pet:set-hitbox',
  /** 拖拽期间锁定不穿透（主进程轮询跳过） */
  petSetPointerLock: 'pet:set-pointer-lock',
  petMoveWindow: 'pet:move-window',
  /** 拖拽按压：渲染层 pointerdown/up 可达但真实 pointermove 不投递（透明窗限制），
   *  按压期间由主进程光标轮询驱动窗口跟随 */
  petPressBegin: 'pet:press-begin',
  petPressEnd: 'pet:press-end',
  /** 光标进入/离开角色命中盒（主进程轮询翻转时广播；渲染层据此暂停自主走动） */
  petCursorNear: 'pet:cursor-near',
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
  hourlyRemind: 'hourly:remind',
  chatSend: 'chat:send',
  chatHistory: 'chat:history',
  openChat: 'chat:open',
  chatAttach: 'chat:attach'
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
  /** 上报角色命中盒（视口坐标，随布局/模型变化重报）；主进程据此轮询光标切换穿透 */
  petSetHitbox(box: { x: number; y: number; w: number; h: number }): void
  /** 拖拽锁定：true=按住期间强制不穿透 */
  petSetPointerLock(locked: boolean): void
  /** 按压开始/结束（屏幕坐标）：主进程轮询光标驱动窗口跟随拖动 */
  petPressBegin(screenX: number, screenY: number): void
  petPressEnd(): void
  onPetCursorNear(cb: (near: boolean) => void): () => void
  onHourlyRemind(cb: (items: HourlyRemindItem[]) => void): () => void
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
  chatSend(text: string, attachment?: { name: string; text: string; truncated: boolean }): Promise<ChatMsgShape[]>
  chatGetHistory(): Promise<ChatMsgShape[]>
  /** 选择并提取文档文本（pdf/docx/txt/md；主进程弹文件框） */
  chatAttach(): Promise<{ ok: boolean; name?: string; text?: string; truncated?: boolean; error?: string }>
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
  hourlyRemind: boolean
  hourlyRemindMin: number
  ai: { baseUrl: string; apiKey: string; model: string }
}

/** 每小时高优先级提醒的条目（main→pet） */
export interface HourlyRemindItem {
  title: string
  dueAt?: number
}

/** 聊天消息（UI 渲染形状） */
export interface ChatMsgShape {
  role: 'user' | 'assistant' | 'system'
  content: string
  toolNote?: boolean
}
