/**
 * 待办面板主界面（360×480 无边框置顶窗）：
 * - 顶部自绘标题栏（-webkit-app-region: drag 拖拽区 + pin 按钮 no-drag 上报 todoPanelPin）
 * - 新增框：回车 → parseDue 解析时间词 → todosMutate add；Esc 清空
 * - 三组渲染 🔴 逾期 / 📅 今天与未来 / 📥 无日期（groupTodos，空组隐藏，全空显示空态）
 * - 删除 → 5s 撤销 toast（撤销 = add 携带原 id 与全部字段）
 * - 底部番茄钟：phase + 剩余 mm:ss（phaseEndsAt − 本地每秒 tick）+ 开始/中止 + 今日计数
 * 数据流见 useTodos：一切变更只发 todosMutate，等主进程广播回来再改 state。
 */

import { useEffect, useRef, useState } from 'react'
import { formatRemain } from '../../../../shared/dueFormat'
import { parseDue } from '../../../../shared/parseDue'
import type { PomoState } from '../../../../shared/pomodoro'
import { groupTodos } from '../../../../shared/todoStore'
import type { Todo } from '../../../../shared/types'
import { runSmoke } from './smoke'
import { TodoItem } from './TodoItem'
import { useTodos } from './useTodos'

const POMO_PHASE_TEXT: Record<PomoState['phase'], string> = {
  idle: '未开始',
  focus: '专注中',
  rest: '休息中'
}

/** 每秒重取当前时间：逾期分组边界刷新 + 番茄钟倒计时 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function App(): React.JSX.Element {
  const { todos, mutate } = useTodos()
  const now = useNow()
  const [input, setInput] = useState('')
  const [pinned, setPinned] = useState(false)
  const [undoTodo, setUndoTodo] = useState<Todo | null>(null)
  const undoTimer = useRef<number | null>(null)
  const [pomo, setPomo] = useState<PomoState>({ phase: 'idle', phaseEndsAt: 0, focusCount: 0 })

  // 番茄钟：初值 + 广播
  useEffect(() => {
    let disposed = false
    window.api
      .getPomoState()
      .then((s) => {
        if (!disposed) setPomo(s)
      })
      .catch(() => {})
    const off = window.api.onPomoChanged((s) => setPomo(s))
    return () => {
      disposed = true
      off()
    }
  }, [])

  // DEV 冒烟：加载后自动跑 增/分组/toggle/删除+撤销/编辑/番茄钟，日志取证后自清理
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined
    return runSmoke()
  }, [])

  // 卸载时清掉悬挂的撤销计时器
  useEffect(
    () => () => {
      if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    },
    []
  )

  const handleDelete = (todo: Todo): void => {
    mutate({ op: 'delete', payload: { id: todo.id } })
    setUndoTodo(todo)
    if (undoTimer.current !== null) window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndoTodo(null), 5000)
  }

  /** 撤销 = add 携带原 id 与全部字段（主进程 add 支持载荷带 id）；撤销后立即关 toast 防重复 */
  const handleUndo = (): void => {
    if (!undoTodo) return
    mutate({
      op: 'add',
      payload: {
        id: undoTodo.id,
        title: undoTodo.title,
        dueAt: undoTodo.dueAt,
        priority: undoTodo.priority,
        notes: undoTodo.notes,
        source: undoTodo.source
      }
    })
    setUndoTodo(null)
    if (undoTimer.current !== null) {
      window.clearTimeout(undoTimer.current)
      undoTimer.current = null
    }
  }

  const handleInputKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      const text = input.trim()
      if (!text) return
      const { dueAt, cleanTitle } = parseDue(text, new Date())
      // 时间词剥掉后标题为空（如只输入「2小时后」）→ 原文整体当标题
      mutate({ op: 'add', payload: { title: cleanTitle.trim() || text, dueAt } })
      setInput('')
    } else if (e.key === 'Escape') {
      setInput('')
    }
  }

  const togglePin = (): void => {
    const next = !pinned
    setPinned(next)
    window.api.todoPanelPin(next)
  }

  const groups = groupTodos(todos, now)
  const total = groups.overdue.length + groups.upcoming.length + groups.undated.length

  const renderGroup = (
    key: string,
    label: string,
    list: Todo[],
    overdue: boolean
  ): React.JSX.Element | null => {
    if (list.length === 0) return null
    return (
      <section className="group" data-group={key}>
        <div className="group-head">
          <span className="group-name">{label}</span>
          <span className="group-count">{list.length}</span>
        </div>
        <ul className="group-list">
          {list.map((t) => (
            <TodoItem
              key={t.id}
              todo={t}
              overdue={overdue}
              now={now}
              mutate={mutate}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      </section>
    )
  }

  return (
    <div id="todo-panel">
      <header className="titlebar">
        <span className="titlebar-title">待 办</span>
        <button
          type="button"
          className="pin-btn"
          title="设置（模型 / 缩放 / AI / 番茄钟）"
          onClick={(): void => window.api.openSettings()}
        >
          ⚙
        </button>
        <button
          type="button"
          className={`pin-btn${pinned ? ' pinned' : ''}`}
          title={pinned ? '已固定：失焦不收起，点击取消' : '固定面板：失焦不自动收起'}
          onClick={togglePin}
        >
          {pinned ? '📍' : '📌'}
        </button>
      </header>

      <div className="add-row">
        <input
          className="add-input"
          value={input}
          placeholder="新增待办，回车添加（支持「明天下午3点」「40分钟后」）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleInputKey}
        />
      </div>

      <main className="groups">
        {total === 0 && (
          <div className="empty">
            🎉 没有待办事项
            <br />
            在上方输入框添加一条吧
          </div>
        )}
        {renderGroup('overdue', '🔴 逾期', groups.overdue, true)}
        {renderGroup('upcoming', '📅 今天与未来', groups.upcoming, false)}
        {renderGroup('undated', '📥 无日期', groups.undated, false)}
      </main>

      <footer className="pomo-bar">
        {pomo.phase === 'idle' ? (
          <button
            type="button"
            className="pomo-btn pomo-start"
            onClick={() => window.api.pomoCommand('start')}
          >
            ▶ 开始专注
          </button>
        ) : (
          <button
            type="button"
            className="pomo-btn pomo-stop"
            onClick={() => window.api.pomoCommand('stop')}
          >
            ■ 中止
          </button>
        )}
        <div className="pomo-info">
          <span className={`pomo-phase ${pomo.phase}`} data-pomo-phase="" data-phase={pomo.phase}>
            {POMO_PHASE_TEXT[pomo.phase]}
          </span>
          <span className="pomo-remain" data-pomo-remain="">
            {pomo.phase === 'idle' ? '--:--' : formatRemain(pomo.phaseEndsAt - now)}
          </span>
        </div>
        <span className="pomo-count">🍅 今日 {pomo.focusCount}</span>
      </footer>

      {undoTodo && (
        <div className="toast" data-toast="">
          <span className="toast-text">已删除「{undoTodo.title}」</span>
          <button type="button" className="undo" onClick={handleUndo}>
            撤销
          </button>
        </div>
      )}
    </div>
  )
}
