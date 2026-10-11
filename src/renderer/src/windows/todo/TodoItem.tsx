/**
 * 单条待办：勾选框（toggle）/ 标题（逾期红）/ 截止时间（友好文案或「已逾期」）/
 * 优先级色点 / hover 显示 编辑·删除 / 行内展开编辑表单（标题/备注/datetime-local/优先级）。
 * 所有变更经 mutate 发往主进程，等广播回来自行刷新（本组件不做本地状态回写）。
 */

import { useState } from 'react'
import { datetimeLocalToTs, formatDue, tsToDatetimeLocal } from '../../../../shared/dueFormat'
import type { TodosMutateMsg } from '../../../../shared/ipc'
import type { Priority, Todo } from '../../../../shared/types'

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 'high', label: '高优先级' },
  { value: 'normal', label: '普通' },
  { value: 'low', label: '低优先级' }
]

const priorityLabel = (p: Priority): string =>
  PRIORITY_OPTIONS.find((o) => o.value === p)?.label ?? p

interface TodoItemProps {
  todo: Todo
  overdue: boolean
  now: number
  mutate: (msg: TodosMutateMsg) => void
  onDelete: (todo: Todo) => void
}

export function TodoItem({
  todo,
  overdue,
  now,
  mutate,
  onDelete
}: TodoItemProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [notesDraft, setNotesDraft] = useState('')
  const [dueDraft, setDueDraft] = useState('')
  const [priorityDraft, setPriorityDraft] = useState<Priority>('normal')

  const startEdit = (): void => {
    setTitleDraft(todo.title)
    setNotesDraft(todo.notes ?? '')
    setDueDraft(todo.dueAt !== undefined ? tsToDatetimeLocal(todo.dueAt) : '')
    setPriorityDraft(todo.priority)
    setEditing(true)
  }

  const cancelEdit = (): void => setEditing(false)

  /** 保存：只提交有变化的字段；datetime-local 清空无法表达「移除截止」——保留原值（edit op 契约限制） */
  const saveEdit = (): void => {
    const patch: { title?: string; notes?: string; dueAt?: number; priority?: string } = {}
    const title = titleDraft.trim()
    if (title && title !== todo.title) patch.title = title
    if (notesDraft.trim() !== (todo.notes ?? '')) patch.notes = notesDraft.trim()
    const dueTs = datetimeLocalToTs(dueDraft)
    if (dueTs !== undefined && dueTs !== todo.dueAt) patch.dueAt = dueTs
    if (priorityDraft !== todo.priority) patch.priority = priorityDraft
    if (Object.keys(patch).length > 0) {
      mutate({ op: 'edit', payload: { id: todo.id, patch } })
    }
    setEditing(false)
  }

  const handleFormKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') cancelEdit()
    else if (e.key === 'Enter') saveEdit()
  }

  if (editing) {
    return (
      <li className="todo-item editing" data-id={todo.id}>
        <div className="edit-form">
          <input
            className="edit-title"
            value={titleDraft}
            placeholder="标题"
            autoFocus
            onChange={(e) => setTitleDraft(e.target.value)}
            onKeyDown={handleFormKey}
          />
          <input
            className="edit-notes"
            value={notesDraft}
            placeholder="备注（可选）"
            onChange={(e) => setNotesDraft(e.target.value)}
            onKeyDown={handleFormKey}
          />
          <div className="edit-row2">
            <input
              className="edit-due"
              type="datetime-local"
              value={dueDraft}
              onChange={(e) => setDueDraft(e.target.value)}
            />
            <select
              className="edit-priority"
              value={priorityDraft}
              onChange={(e) => setPriorityDraft(e.target.value as Priority)}
            >
              {PRIORITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="edit-actions">
            <button type="button" className="btn btn-ghost edit-cancel" onClick={cancelEdit}>
              取消
            </button>
            <button type="button" className="btn btn-primary edit-save" onClick={saveEdit}>
              保存
            </button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <li className={`todo-item${overdue ? ' overdue' : ''}`} data-id={todo.id}>
      <input
        type="checkbox"
        aria-label="完成"
        checked={todo.done}
        onChange={() => mutate({ op: 'toggle', payload: { id: todo.id } })}
      />
      <div className="todo-main">
        <div className="todo-title-row">
          <span className="todo-title">{todo.title}</span>
          {todo.dueAt !== undefined && (
            <span className="todo-due" title={new Date(todo.dueAt).toLocaleString()}>
              {overdue ? '已逾期' : formatDue(todo.dueAt, now)}
            </span>
          )}
          <span
            className={`prio ${todo.priority}`}
            title={`优先级：${priorityLabel(todo.priority)}`}
          />
        </div>
        {todo.notes ? <div className="todo-notes">备注 · {todo.notes}</div> : null}
      </div>
      <div className="actions">
        <button type="button" className="icon-btn btn-edit" title="编辑" onClick={startEdit}>
          改
        </button>
        <button
          type="button"
          className="icon-btn danger btn-delete"
          title="删除"
          onClick={() => onDelete(todo)}
        >
          删
        </button>
      </div>
    </li>
  )
}
