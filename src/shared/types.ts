/** 共享数据模型：main / preload / renderer 与测试均可复用（纯类型，无 IO） */

export type Priority = 'low' | 'normal' | 'high'

export interface Todo {
  id: string
  title: string
  notes?: string
  dueAt?: number
  priority: Priority
  done: boolean
  completedAt?: number
  createdAt: number
  source: 'manual' | 'ai'
}

export type TodoGroup = { overdue: Todo[]; upcoming: Todo[]; undated: Todo[] }
