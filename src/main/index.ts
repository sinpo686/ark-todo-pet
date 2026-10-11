/** 主进程入口：单实例锁、三窗口、托盘、IPC 路由、30s 提醒/番茄钟调度循环。 */

import { app, BrowserWindow, ipcMain, net, Notification } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IPC } from '../shared/ipc'
import type { TodosMutateMsg, AppSettingsShape } from '../shared/ipc'
import type { Todo, Priority } from '../shared/types'
import { addTodo, toggleTodo, editTodo, deleteTodo } from '../shared/todoStore'
import { groupTodos } from '../shared/todoStore'
import { computeMood } from '../shared/mood'
import type { Mood } from '../shared/mood'
import { decideReminders } from '../shared/reminders'
import type { ReminderEvent } from '../shared/reminders'
import { pomoStart, pomoTick, pomoStop, POMO_IDLE } from '../shared/pomodoro'
import type { PomoState } from '../shared/pomodoro'
import {
  loadTodos,
  saveTodos,
  idGen,
  getSettings,
  setSetting,
  bumpTodayFocusCount,
  getTodayFocusCount
} from './store'
import type { AiConfig } from './store'
import {
  createPetWindow,
  openTodoPanel,
  setPanelPinned,
  openSettingsWindow,
  openChatWindow,
  broadcast,
  sendToPet,
  applyPetScale,
  getPinnedPetSize
} from './windows'
import { createTray } from './tray'
import type { TrayWithRefresh } from './tray'
import {
  registerArkModelSchemePrivileges,
  registerArkModelProtocol,
  registerModelIpc,
  listLocalModels,
  deleteModel
} from './modelLibrary'
import { createAiService } from './ai'

// arkmodel:// 必须在 app ready 之前注册为特权 scheme（standard+supportFetchAPI
// 才能被 renderer 的 fetch 正确解析），模块加载期即生效
registerArkModelSchemePrivileges()

// ---------- 全局状态（主进程内存） ----------

let petWin: BrowserWindow | null = null
let trayRef: TrayWithRefresh | null = null

// AI 对话服务（T13）：工具执行走与 UI 相同的 mutate 路径（source='ai'）
const aiService = createAiService({
  getAiConfig: (): AiConfig => getSettings().ai,
  getTodos: (): Todo[] => todos,
  getMood: (): Mood => computeMood(todos, pomoState.phase, Date.now()),
  addTodo: async (input): Promise<void> => {
    await mutateTodos({
      op: 'add',
      payload: { title: input.title, dueAt: input.dueAt, priority: input.priority, notes: input.notes, source: 'ai' }
    })
  },
  completeTodo: async (id): Promise<void> => {
    await mutateTodos({ op: 'toggle', payload: { id } })
  }
})
let todos: Todo[] = loadTodos()
let pomoState: PomoState = { ...POMO_IDLE, focusCount: getTodayFocusCount(Date.now()) }
const remindedSet = new Set<string>()
let schedulerTimer: NodeJS.Timeout | null = null

// ---------- 广播 ----------

function broadcastTodos(): void {
  broadcast(IPC.todosChanged, todos)
}

function broadcastMood(): void {
  if (!petWin) return
  const mood: Mood = computeMood(todos, pomoState.phase, Date.now())
  sendToPet(petWin, IPC.moodChanged, mood)
}

function broadcastPomo(): void {
  broadcast(IPC.pomoChanged, pomoState)
}

// ---------- todos 变更路由 ----------

async function mutateTodos(msg: TodosMutateMsg): Promise<void> {
  const now = Date.now()
  switch (msg.op) {
    case 'add': {
      const p = msg.payload
      // id 可由载荷携带（撤销恢复原条目时复用原 id）
      const carryId = p.id
      const gen = carryId ? (): string => carryId : idGen
      todos = addTodo(
        todos,
        {
          title: p.title,
          dueAt: p.dueAt,
          priority: p.priority as Priority | undefined,
          notes: p.notes,
          source: p.source
        },
        now,
        gen
      )
      break
    }
    case 'toggle':
      todos = toggleTodo(todos, msg.payload.id, now)
      break
    case 'edit':
      todos = editTodo(
        todos,
        msg.payload.id,
        msg.payload.patch as { title?: string; notes?: string; dueAt?: number; priority?: Priority }
      )
      break
    case 'delete':
      todos = deleteTodo(todos, msg.payload.id)
      break
  }
  await saveTodos(todos)
  broadcastTodos()
  broadcastMood()
  trayRef?.refresh() // 托盘徽标计数随待办更新（规格 §5.2）
}

// ---------- 提醒与番茄钟调度（30s 一拍；纯逻辑见 src/shared） ----------

function notify(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show()
  }
}

function runSchedulerTick(): void {
  const now = Date.now()
  const settings = getSettings()

  // 提醒：先发送（通知+pet 窗口），成功后才记 key——先记后发遇失败会永久丢提醒
  const events: ReminderEvent[] = decideReminders(todos, now, remindedSet, settings.reminderLeadMin)
  for (const ev of events) {
    const key = `${ev.todoId}:${ev.kind}`
    if (ev.kind === 'due') {
      notify('⏰ 已到截止时间', ev.title)
    } else {
      notify('⏳ 即将到期', `${ev.title}（${settings.reminderLeadMin} 分钟后截止）`)
    }
    if (petWin) sendToPet(petWin, IPC.remindTrigger, ev)
    remindedSet.add(key)
  }

  // 番茄钟
  const tick = pomoTick(pomoState, now, settings.pomoFocusMin, settings.pomoRestMin)
  if (tick.event === 'focusEnd') {
    pomoState = tick.state
    notify('🍅 专注结束', '休息一下吧')
    broadcastPomo()
    broadcastMood()
  } else if (tick.event === 'restEnd') {
    // 纯逻辑已 +1，但每日计数以磁盘为准（跨天重置）：bump 写盘并返回权威值
    pomoState = { ...tick.state, focusCount: bumpTodayFocusCount(now) }
    notify('☕ 休息结束', `今日已完成 ${pomoState.focusCount} 个番茄`)
    broadcastPomo()
    broadcastMood()
  } else {
    pomoState = tick.state
  }
}

function startScheduler(): void {
  if (schedulerTimer) clearInterval(schedulerTimer)
  schedulerTimer = setInterval(runSchedulerTick, 30_000)
  console.log('[scheduler] 30s 调度循环已启动（提醒 + 番茄钟）')
  runSchedulerTick() // 首拍立即执行，便于冒烟观察
}

// ---------- IPC 注册 ----------

function registerIpc(): void {
  ipcMain.on(IPC.petSetMouseIgnore, (_e, payload: { ignore: boolean }) => {
    // 命中翻转打点：renderer 仅在布尔翻转时发送，日志可据此确认穿透切换生效
    console.log(`[ipc] pet:set-mouse-ignore ignore=${payload.ignore}`)
    petWin?.setIgnoreMouseEvents(payload.ignore, { forward: true })
  })

  // 走动/拖拽/下落的窗口移动：渲染层已按帧节流（16ms）。用 setBounds 钉死尺寸——
  // Windows 上对 transparent 窗口反复 setPosition 会因 DPI 取整累积漂移（越拖越大）
  ipcMain.on(IPC.petMoveWindow, (_e, payload: { x: number; y: number }) => {
    if (petWin && petWin.isVisible()) {
      const size = getPinnedPetSize()
      petWin.setBounds({
        x: Math.round(payload.x),
        y: Math.round(payload.y),
        width: size.width,
        height: size.height
      })
    }
  })

  ipcMain.on(IPC.openTodoPanel, () => {
    if (petWin) openTodoPanel(petWin)
  })

  ipcMain.on(IPC.todoPanelPin, (_e, payload: { pinned: boolean }) => {
    setPanelPinned(payload.pinned)
  })

  ipcMain.on(IPC.todosMutate, (_e, msg: TodosMutateMsg) => {
    mutateTodos(msg).catch((err) => console.error('[ipc] todosMutate 失败:', err))
  })

  ipcMain.on(IPC.pomoCommand, (_e, payload: { op: 'start' | 'stop' }) => {
    const now = Date.now()
    const settings = getSettings()
    if (payload.op === 'start') {
      pomoState = pomoStart(pomoState, now, settings.pomoFocusMin)
    } else {
      pomoState = pomoStop(pomoState)
    }
    broadcastPomo()
    broadcastMood()
  })

  ipcMain.on(IPC.openSettings, () => {
    openSettingsWindow()
  })

  ipcMain.on(IPC.openChat, () => {
    if (petWin) openChatWindow(petWin)
  })

  ipcMain.handle('todos:get', (): Todo[] => todos)
  ipcMain.handle('pomo:get-state', (): PomoState => pomoState)

  // ---------- 设置（T12） ----------

  ipcMain.handle(IPC.settingsGet, (): AppSettingsShape => {
    const s = getSettings()
    return {
      autostart: s.autostart,
      currentModel: s.currentModel,
      reminderLeadMin: s.reminderLeadMin,
      pomoFocusMin: s.pomoFocusMin,
      pomoRestMin: s.pomoRestMin,
      petScale: s.petScale,
      ai: s.ai
    }
  })

  ipcMain.handle(IPC.settingsSet, async (_e, patch: Partial<AppSettingsShape>): Promise<void> => {
    if (patch.autostart !== undefined) {
      setSetting('autostart', patch.autostart)
      app.setLoginItemSettings({ openAtLogin: patch.autostart })
      console.log(`[settings] autostart=${patch.autostart}`)
    }
    if (patch.reminderLeadMin !== undefined) setSetting('reminderLeadMin', patch.reminderLeadMin)
    if (patch.pomoFocusMin !== undefined) setSetting('pomoFocusMin', patch.pomoFocusMin)
    if (patch.pomoRestMin !== undefined) setSetting('pomoRestMin', patch.pomoRestMin)
    if (patch.petScale !== undefined) {
      setSetting('petScale', patch.petScale)
      if (petWin) applyPetScale(petWin, patch.petScale)
      console.log(`[settings] petScale=${patch.petScale}`)
    }
    if (patch.ai !== undefined) setSetting('ai', patch.ai)
    if (patch.currentModel !== undefined && patch.currentModel !== null) {
      await setCurrentModel(patch.currentModel)
    }
  })

  ipcMain.handle(IPC.modelsSetCurrent, async (_e, payload: { dir: string }): Promise<void> => {
    await setCurrentModel(payload.dir)
  })

  // 删除模型：若删的是当前干员 → 自动切到剩余可用模型；一个不剩 → 清空指向（桌宠显示引导）
  ipcMain.handle(IPC.modelsDelete, async (_e, payload: { dir: string }): Promise<void> => {
    await deleteModel(payload.dir)
    if (getSettings().currentModel === payload.dir) {
      const remaining = (await listLocalModels()).filter((m) => m.skel && m.dir !== payload.dir)
      const next = remaining[0]
      if (next) {
        await setCurrentModel(next.dir)
      } else {
        setSetting('currentModel', null)
        broadcast(IPC.modelChanged, { dir: '', name: '' }) // 无 skel → 桌宠回落引导文案
      }
    }
    trayRef?.refresh()
  })

  ipcMain.handle(IPC.chatSend, async (_e, payload: { text: string }) => aiService.send(payload.text))
  ipcMain.handle(IPC.chatHistory, () => aiService.getUiHistory())

  ipcMain.handle(IPC.aiTest, async (): Promise<{ ok: boolean; latencyMs?: number; error?: string }> => {
    const { ai } = getSettings()
    if (!ai.baseUrl || !ai.apiKey || !ai.model) {
      return { ok: false, error: '请先填写 Base URL / API Key / 模型名' }
    }
    const started = Date.now()
    try {
      const res = await net.fetch(`${ai.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
        body: JSON.stringify({ model: ai.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 }),
        signal: AbortSignal.timeout(20_000)
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false, error: `HTTP ${res.status} ${body.slice(0, 120)}` }
      }
      return { ok: true, latencyMs: Date.now() - started }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })
}

/** 切换当前模型：校验本地存在 → 写设置 → 广播 modelChanged（pet 窗口重载）→ 托盘刷新 */
async function setCurrentModel(dir: string): Promise<void> {
  const models = await listLocalModels()
  const target = models.find((m) => m.dir === dir)
  if (!target || !target.skel) {
    throw new Error(`本地不存在可用的模型: ${dir}`)
  }
  setSetting('currentModel', dir)
  broadcast(IPC.modelChanged, target)
  trayRef?.refresh()
  console.log(`[settings] 切换干员 -> ${dir}（${target.name}）`)
}

// ---------- 应用生命周期 ----------

// 单实例锁：第二个实例启动时聚焦已有实例的桌宠窗口后退出
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (petWin) {
      if (petWin.isMinimized()) petWin.restore()
      petWin.show()
      petWin.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.sinpo686.arktodopet')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpc()
    registerModelIpc(() => trayRef?.refresh())
    registerArkModelProtocol()
    petWin = createPetWindow()
    trayRef = createTray(
      (): void => {
        if (!petWin) return
        if (petWin.isVisible()) {
          petWin.hide()
        } else {
          petWin.show()
        }
      },
      (): void => {
        if (petWin) openTodoPanel(petWin)
      },
      (): void => openSettingsWindow(),
      {
        getModels: () => listLocalModels(),
        getCurrent: () => getSettings().currentModel,
        onSwitchModel: (dir: string): void => {
          setCurrentModel(dir).catch((err) => console.error('[tray] 切换模型失败:', String(err)))
        },
        getTodoCounts: (): { open: number; overdue: number } => {
          const now = Date.now()
          const g = groupTodos(todos, now)
          return { open: g.overdue.length + g.upcoming.length + g.undated.length, overdue: g.overdue.length }
        }
      }
    )
    startScheduler()

    // 开机自启（设置页 T12 提供开关，此处按存量设置应用）
    app.setLoginItemSettings({ openAtLogin: getSettings().autostart })

    // 初始广播：让已就绪的窗口拿到首份数据
    setTimeout(() => {
      broadcastTodos()
      broadcastPomo()
      broadcastMood()
    }, 1500)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        petWin = createPetWindow()
      }
    })
  })
}

app.on('window-all-closed', () => {
  // 桌宠应用：所有窗口关闭≠退出（托盘常驻），退出走托盘菜单/单实例外退出
  if (process.platform !== 'darwin') {
    // 不 app.quit()：由托盘「退出」显式退出
  }
})

app.on('before-quit', () => {
  if (schedulerTimer) clearInterval(schedulerTimer)
  setSetting('petX', petWin?.getPosition()?.[0] ?? getSettings().petX)
  setSetting('petY', petWin?.getPosition()?.[1] ?? getSettings().petY)
})
