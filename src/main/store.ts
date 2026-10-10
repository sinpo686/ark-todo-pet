/** 持久化外壳：todos（写前轮换备份）、设置、番茄钟每日计数。所有磁盘 IO 集中于此。 */

import { app } from 'electron'
import { join } from 'path'
import { copyFile } from 'fs/promises'
import { existsSync } from 'fs'
import ElectronStore from 'electron-store'
import { randomUUID } from 'crypto'
import type { Todo } from '../shared/types'

const todosStore = new ElectronStore<{ todos: Todo[] }>({ name: 'todos', defaults: { todos: [] } })

const settingsStore = new ElectronStore<{
  petX: number | null
  petY: number | null
  autostart: boolean
  currentModel: string | null
  reminderLeadMin: number
  pomoFocusMin: number
  pomoRestMin: number
}>({
  name: 'settings',
  defaults: { petX: null, petY: null, autostart: false, currentModel: null, reminderLeadMin: 15, pomoFocusMin: 25, pomoRestMin: 5 }
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
}

export function getSettings(): AppSettings {
  return {
    petX: settingsStore.get('petX'),
    petY: settingsStore.get('petY'),
    autostart: settingsStore.get('autostart'),
    currentModel: settingsStore.get('currentModel'),
    reminderLeadMin: settingsStore.get('reminderLeadMin'),
    pomoFocusMin: settingsStore.get('pomoFocusMin'),
    pomoRestMin: settingsStore.get('pomoRestMin')
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
