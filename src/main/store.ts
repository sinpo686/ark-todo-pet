/** 持久化外壳：todos（写前轮换备份）、设置、番茄钟每日计数。所有磁盘 IO 集中于此。 */

import { app, dialog } from 'electron'
import { join } from 'path'
import { copyFile } from 'fs/promises'
import { existsSync, copyFileSync, renameSync } from 'fs'
import ElectronStore from 'electron-store'
import { randomUUID } from 'crypto'
import type { Todo } from '../shared/types'

/**
 * todos.json 的 electron-store：构造期会同步读取并 JSON.parse 主文件——
 * 文件损坏时构造直接抛错（主进程崩溃且重启循环）。因此：
 * 1) 构造失败 → 用 todos.json.bak 恢复主文件后重试；
 * 2) 仍失败 → 把坏文件改名为 .corrupt-<ts> 隔离，重建空库，并弹窗告知。
 */
function createTodosStore(): ElectronStore<{ todos: Todo[] }> {
  const opts = { name: 'todos', defaults: { todos: [] as Todo[] } } as const
  try {
    return new ElectronStore<{ todos: Todo[] }>(opts)
  } catch (err) {
    console.error('[store] todos.json 损坏，尝试 .bak 恢复:', String(err))
    const mainPath = join(app.getPath('userData'), 'todos.json')
    const bakPath = join(app.getPath('userData'), 'todos.json.bak')
    try {
      if (existsSync(bakPath)) {
        copyFileSync(bakPath, mainPath)
        return new ElectronStore<{ todos: Todo[] }>(opts)
      }
    } catch (err2) {
      console.error('[store] .bak 恢复失败:', String(err2))
    }
    try {
      renameSync(mainPath, `${mainPath}.corrupt-${Date.now()}`)
    } catch {
      /* 主文件不存在等情况 */
    }
    try {
      dialog.showErrorBox(
        '待办数据已重置',
        'todos.json 损坏且备份不可用，已将坏文件隔离为 todos.json.corrupt-* 并重建空清单。'
      )
    } catch {
      /* app 未就绪时静默 */
    }
    return new ElectronStore<{ todos: Todo[] }>(opts)
  }
}

const todosStore = createTodosStore()

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const settingsStore = new ElectronStore<{
  petX: number | null
  petY: number | null
  autostart: boolean
  currentModel: string | null
  reminderLeadMin: number
  pomoFocusMin: number
  pomoRestMin: number
  petScale: number
  hourlyRemind: boolean
  hourlyRemindMin: number
  ai: AiConfig
}>({
  name: 'settings',
  defaults: {
    petX: null,
    petY: null,
    autostart: false,
    currentModel: null,
    reminderLeadMin: 15,
    pomoFocusMin: 25,
    pomoRestMin: 5,
    petScale: 1,
    hourlyRemind: true,
    hourlyRemindMin: 60,
    ai: { baseUrl: '', apiKey: '', model: '' }
  }
})

const pomoStore = new ElectronStore<Record<string, number>>({ name: 'pomodoro', defaults: {} })

function todosFilePath(): string {
  return join(app.getPath('userData'), 'todos.json')
}
function todosBakPath(): string {
  return join(app.getPath('userData'), 'todos.json.bak')
}

/** 读取 todos；主文件损坏时回退 .bak，仍失败则重置（T14 会加用户提示） */
export function loadTodos(): Todo[] {
  try {
    return todosStore.get('todos', [])
  } catch {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const raw = require('fs').readFileSync(todosBakPath(), 'utf-8')
      const parsed = JSON.parse(raw) as { todos: Todo[] }
      return Array.isArray(parsed.todos) ? parsed.todos : []
    } catch {
      return []
    }
  }
}

/** 保存 todos；写前把当前 todos.json 轮换为 .bak（存在才轮换） */
export async function saveTodos(todos: Todo[]): Promise<void> {
  try {
    if (existsSync(todosFilePath())) {
      await copyFile(todosFilePath(), todosBakPath())
    }
  } catch (err) {
    console.warn('[store] todos 备份轮换失败（继续写入）:', err)
  }
  todosStore.set('todos', todos)
}

export function idGen(): string {
  return randomUUID()
}

// ---------- 设置 ----------

export interface AppSettings {
  petX: number | null
  petY: number | null
  autostart: boolean
  currentModel: string | null
  reminderLeadMin: number
  pomoFocusMin: number
  pomoRestMin: number
  petScale: number
  hourlyRemind: boolean
  hourlyRemindMin: number
  ai: AiConfig
}

export function getSettings(): AppSettings {
  return {
    petX: settingsStore.get('petX'),
    petY: settingsStore.get('petY'),
    autostart: settingsStore.get('autostart'),
    currentModel: settingsStore.get('currentModel'),
    reminderLeadMin: settingsStore.get('reminderLeadMin'),
    pomoFocusMin: settingsStore.get('pomoFocusMin'),
    pomoRestMin: settingsStore.get('pomoRestMin'),
    petScale: settingsStore.get('petScale'),
    hourlyRemind: settingsStore.get('hourlyRemind'),
    hourlyRemindMin: settingsStore.get('hourlyRemindMin'),
    ai: settingsStore.get('ai')
  }
}

export function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
  settingsStore.set(key, value)
}

// ---------- 番茄钟每日计数（key: focus-YYYY-MM-DD，本地日期） ----------

function todayKey(now: number): string {
  const d = new Date(now)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `focus-${d.getFullYear()}-${mm}-${dd}`
}

export function getTodayFocusCount(now: number): number {
  return pomoStore.get(todayKey(now), 0)
}

export function bumpTodayFocusCount(now: number): number {
  const key = todayKey(now)
  const next = pomoStore.get(key, 0) + 1
  pomoStore.set(key, next)
  return next
}
