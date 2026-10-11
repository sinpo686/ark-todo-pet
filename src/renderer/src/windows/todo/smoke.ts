/**
 * DEV 冒烟脚本（仅 import.meta.env.DEV，由 App 挂载时调用，返回清理函数）。
 * 无人工交互替代：程序化驱动真实 DOM（输入框回车 / 勾选框 click / 悬停按钮 click），
 * 同时自订阅 onTodosChanged / onPomoChanged 验证「变更 → 主进程回执广播」的单向数据流。
 * 序列：清理残留 → add 三条（逾期直发 + 未来走输入框覆盖 parseDue + 无日期）→ 分组渲染取证 →
 * toggle（UI）+ toggle 回（数据层，面板无已完成区）→ 删除 + 撤销（id 复用取证）→
 * 行内编辑（标题/优先级/datetime-local）→ 番茄钟 开始/每秒倒计时/中止 → 自清理。
 * 所有日志经主进程 [todo-console] 转发到终端；步骤失败用 ✗+warn 标记（不算应用 ERROR）。
 */

import { tsToDatetimeLocal } from '../../../../shared/dueFormat'
import type { TodosMutateMsg } from '../../../../shared/ipc'
import type { PomoState } from '../../../../shared/pomodoro'
import { groupTodos } from '../../../../shared/todoStore'
import type { Todo } from '../../../../shared/types'

const PREFIX = '冒烟'
const log = (...args: unknown[]): void => console.log('[todo-smoke]', ...args)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** React 受控组件需走原型 setter + input/change 事件才能真正更新 state */
function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) return
  setter.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function setSelectValue(el: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  if (!setter) return
  setter.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

const countIn = (group: string): number =>
  document.querySelectorAll(`[data-group="${group}"] .todo-item`).length
const itemEl = (id: string): HTMLElement | null =>
  document.querySelector(`.todo-item[data-id="${id}"]`)
const remainText = (): string => document.querySelector('[data-pomo-remain]')?.textContent ?? ''
const remainSec = (s: string): number => {
  const m = /^(\d+):(\d+)$/.exec(s.trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : -1
}

export function runSmoke(): () => void {
  let stopped = false
  /** 最近一次未消费的广播（mutateAndWait 的回执） */
  let snap: Todo[] | null = null
  /** 最近一次广播（永不重置，供随时读取当前主进程权威数据） */
  let lastList: Todo[] = []
  let pomoSnap: PomoState | null = null

  const offTodos = window.api.onTodosChanged((list) => {
    snap = list
    lastList = list
  })
  const offPomo = window.api.onPomoChanged((s) => {
    pomoSnap = s
  })

  const ok = async (desc: string, pred: () => boolean, timeoutMs = 4000): Promise<boolean> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (stopped) return false
      if (pred()) {
        log(`✓ ${desc}`)
        return true
      }
      await sleep(100)
    }
    log(`✗ ${desc}（超时 ${timeoutMs}ms）`)
    return false
  }

  /** 发 op → 等主进程 onTodosChanged 回包（单向数据流取证） */
  const mutateAndWait = async (msg: TodosMutateMsg, desc: string): Promise<Todo[]> => {
    snap = null
    window.api.todosMutate(msg)
    await ok(`${desc} → onTodosChanged 回包`, () => snap !== null)
    const result = snap ?? []
    snap = null
    return result
  }

  void (async () => {
    try {
      log('启动')
      await sleep(600)
      if (stopped) return

      // 0) 清理上次运行残留（脚本中途被杀时可能留下）
      const initial = await window.api.getTodos()
      const leftovers = initial.filter((t) => t.title.startsWith(PREFIX))
      if (leftovers.length > 0) {
        log(`清理上次残留 ${leftovers.length} 条`)
        for (const t of leftovers) {
          await mutateAndWait({ op: 'delete', payload: { id: t.id } }, `清理残留 ${t.title}`)
        }
      }

      // 基线：期望组内条数 = 既有条数 + 冒烟新增 1 条（防用户存量数据干扰断言）
      const before = await window.api.getTodos()
      const g0 = groupTodos(before, Date.now())
      const exp = {
        overdue: g0.overdue.length + 1,
        upcoming: g0.upcoming.length + 1,
        undated: g0.undated.length + 1
      }
      log(
        `基线（清理后）：overdue=${g0.overdue.length} upcoming=${g0.upcoming.length} undated=${g0.undated.length}`
      )

      // 1) add 三条：逾期直发（parseDue 表达不了过去时刻），未来走真实输入框（覆盖 parseDue），无日期走输入框
      const r1 = await mutateAndWait(
        { op: 'add', payload: { title: `${PREFIX}-逾期`, dueAt: Date.now() - 3600_000 } },
        'add 逾期（1 小时前，直发 op）'
      )
      const overdueTodo = r1.find((t) => t.title === `${PREFIX}-逾期`)

      const typeAndEnter = async (text: string, desc: string): Promise<void> => {
        const el = document.querySelector<HTMLInputElement>('.add-input')
        if (!el) {
          log(`✗ ${desc}：找不到新增输入框`)
          return
        }
        snap = null
        setInputValue(el, text)
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        await ok(`${desc} → onTodosChanged 回包`, () => snap !== null)
        snap = null
      }
      await typeAndEnter(`${PREFIX}-未来 2小时后`, 'add 未来（输入框回车 + parseDue）')
      const futureTodo = lastList.find((t) => t.title === `${PREFIX}-未来`)
      const futureDiffMin = futureTodo?.dueAt
        ? Math.round((futureTodo.dueAt - Date.now()) / 60_000)
        : NaN
      log(
        `parseDue 解析：「${PREFIX}-未来 2小时后」→ title="${futureTodo?.title}"（时间词已剥） dueAt≈${futureDiffMin}min 后（期望≈120）`
      )

      await typeAndEnter(`${PREFIX}-无日期`, 'add 无日期（输入框回车）')
      const undatedTodo = lastList.find((t) => t.title === `${PREFIX}-无日期`)

      // 2) 分组渲染取证
      await ok(`分组渲染 overdue=${exp.overdue}`, () => countIn('overdue') === exp.overdue)
      await ok(`分组渲染 upcoming=${exp.upcoming}`, () => countIn('upcoming') === exp.upcoming)
      await ok(`分组渲染 undated=${exp.undated}`, () => countIn('undated') === exp.undated)
      log(
        `分组结果：overdue=${countIn('overdue')} upcoming=${countIn('upcoming')} undated=${countIn('undated')}（期望 ${exp.overdue}/${exp.upcoming}/${exp.undated}）`
      )
      if (overdueTodo) {
        const el = itemEl(overdueTodo.id)
        log(
          `逾期样式：.overdue=${el?.classList.contains('overdue')} / 时间文案="${el?.querySelector('.todo-due')?.textContent}"（期望 true / 已逾期）`
        )
      }

      // 3) toggle：点击真实勾选框 → 完成项从组中消失；再走数据层 toggle 回（面板无已完成区）
      if (undatedTodo) {
        const cb = itemEl(undatedTodo.id)?.querySelector<HTMLInputElement>('input[type="checkbox"]')
        snap = null
        cb?.click()
        await ok('toggle 勾选（UI click）→ 回包', () => snap !== null)
        const after = lastList.find((t) => t.id === undatedTodo.id)
        log(`toggle 后：done=${after?.done}（期望 true）`)
        await ok(
          `toggle 后 undated=${exp.undated - 1}（完成项不入组）`,
          () => countIn('undated') === exp.undated - 1
        )
        snap = null

        await mutateAndWait(
          { op: 'toggle', payload: { id: undatedTodo.id } },
          'toggle 取消（数据层 op）'
        )
        const back = lastList.find((t) => t.id === undatedTodo.id)
        log(
          `toggle 回：done=${back?.done}（期望 false）completedAt=${back?.completedAt ?? '无'}（期望无）`
        )
        await ok(`toggle 回 undated=${exp.undated}`, () => countIn('undated') === exp.undated)
      }

      // 4) 删除 + 撤销（add 携带原 id）
      if (futureTodo) {
        itemEl(futureTodo.id)?.querySelector<HTMLButtonElement>('.btn-delete')?.click()
        await ok('删除（UI click）→ 回包', () => {
          const gone = snap !== null
          return gone
        })
        snap = null
        await ok(
          `删除后 upcoming=${exp.upcoming - 1}`,
          () => countIn('upcoming') === exp.upcoming - 1
        )
        await ok('撤销 toast 出现', () => document.querySelector('[data-toast]') !== null)
        document.querySelector<HTMLButtonElement>('[data-toast] .undo')?.click()
        await ok('撤销（add 携带原 id）→ 回包', () => snap !== null)
        snap = null
        await ok(`撤销后 upcoming=${exp.upcoming}`, () => countIn('upcoming') === exp.upcoming)
        const restored = lastList.find((t) => t.id === futureTodo.id)
        log(
          `撤销恢复：id 一致=${restored?.id === futureTodo.id} title="${restored?.title}" dueAt 保留=${restored?.dueAt === futureTodo.dueAt}`
        )
      }

      // 5) 行内编辑：标题 + 优先级 + datetime-local（走真实表单与保存按钮）
      if (undatedTodo) {
        itemEl(undatedTodo.id)?.querySelector<HTMLButtonElement>('.btn-edit')?.click()
        await ok('编辑表单展开', () => itemEl(undatedTodo.id)?.querySelector('.edit-form') != null)
        const form = itemEl(undatedTodo.id)
        const tomorrowTs = Date.now() + 86_400_000
        const titleEl = form?.querySelector<HTMLInputElement>('.edit-title')
        const dueEl = form?.querySelector<HTMLInputElement>('.edit-due')
        const prioEl = form?.querySelector<HTMLSelectElement>('.edit-priority')
        if (titleEl) setInputValue(titleEl, `${PREFIX}-无日期-已改`)
        if (dueEl) setInputValue(dueEl, tsToDatetimeLocal(tomorrowTs))
        if (prioEl) setSelectValue(prioEl, 'high')
        snap = null
        form?.querySelector<HTMLButtonElement>('.edit-save')?.click()
        await ok('保存编辑 → 回包', () => snap !== null)
        snap = null
        const edited = lastList.find((t) => t.id === undatedTodo.id)
        log(
          `编辑生效：title="${edited?.title}"（期望 ${PREFIX}-无日期-已改） priority=${edited?.priority}（期望 high） dueAt≈明天=${edited?.dueAt != null && Math.abs(edited.dueAt - tomorrowTs) < 90_000}`
        )
        await ok(
          `编辑后 undated=${exp.undated - 1} / upcoming=${exp.upcoming + 1}（设截止后跨组）`,
          () => countIn('undated') === exp.undated - 1 && countIn('upcoming') === exp.upcoming + 1
        )
      }

      // 6) 番茄钟：开始 → 每秒倒计时 → 中止
      log(
        `番茄钟初始：phase="${document.querySelector('[data-pomo-phase]')?.textContent}" remain=${remainText()}`
      )
      document.querySelector<HTMLButtonElement>('.pomo-start')?.click()
      await ok('pomoCommand start → pomoChanged phase=focus', () => pomoSnap?.phase === 'focus')
      const t1 = remainText()
      const s1 = remainSec(t1)
      await sleep(2100)
      const t2 = remainText()
      log(`倒计时跳动：${t1} → ${t2}（本地每秒 tick 生效）`)
      if (s1 >= 0 && remainSec(t2) >= 0) {
        await ok('倒计时在走（秒数递减 ≥2）', () => s1 - remainSec(t2) >= 2)
      }
      document.querySelector<HTMLButtonElement>('.pomo-stop')?.click()
      await ok('pomoCommand stop → phase=idle', () => pomoSnap?.phase === 'idle')
      log(
        `中止后 DOM：phase="${document.querySelector('[data-pomo-phase]')?.textContent}" remain=${remainText()}（期望 未开始 / --:--）`
      )

      // 7) 自清理
      const fin = await window.api.getTodos()
      const mine = fin.filter((t) => t.title.startsWith(PREFIX))
      for (const t of mine) {
        await mutateAndWait({ op: 'delete', payload: { id: t.id } }, `清理 ${t.title}`)
      }
      let cleaned = false
      for (let i = 0; i < 20; i++) {
        const list = await window.api.getTodos()
        if (!list.some((t) => t.title.startsWith(PREFIX))) {
          cleaned = true
          break
        }
        await sleep(150)
      }
      log(cleaned ? '✓ 清理完成：无冒烟残留' : '✗ 清理未完成（有残留）')
      log('冒烟脚本结束')
    } catch (err) {
      console.warn('[todo-smoke] 异常终止:', err)
    }
  })()

  return () => {
    stopped = true
    offTodos()
    offPomo()
  }
}
