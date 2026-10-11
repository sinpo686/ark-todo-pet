/** 主进程入口：单实例锁、三窗口、托盘、IPC 路由、30s 提醒/番茄钟调度循环。 */

import { app, BrowserWindow, dialog, ipcMain, net, Notification, screen } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
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
import { extractTextFromFile } from './docExtract'

// arkmodel:// 必须在 app ready 之前注册为特权 scheme（standard+supportFetchAPI
// 才能被 renderer 的 fetch 正确解析），模块加载期即生效
registerArkModelSchemePrivileges()

// ---------- 全局状态（主进程内存） ----------

let petWin: BrowserWindow | null = null
let trayRef: TrayWithRefresh | null = null
/** 桌宠窗口当前穿透态（渲染层翻转时同步；setBounds 后需重断言以维持 forward 转发） */
let petMouseIgnored = true
/** 角色命中盒（视口坐标；渲染层上报，主进程叠加窗口位置得屏幕坐标） */
let petHitbox: { x: number; y: number; w: number; h: number } | null = null
/** 拖拽锁定：按住角色期间强制不穿透（渲染层上报） */
let petPointerLocked = false
/** 按压拖动状态：pointerdown 时记录原点，轮询光标驱动窗口跟随（真实 pointermove 不投递的兜底） */
let petPressing = false
let petPressCursor = { x: 0, y: 0 }
let petPressWin = { x: 0, y: 0 }

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

/**
 * 桌宠穿透轮询（33ms）：主进程权威判定「光标是否在角色命中盒内」并切换
 * setIgnoreMouseEvents。不再依赖 setIgnoreMouseEvents(forward) 的消息转发——
 * 实测转发在透明窗 + setBounds 移动后不再向渲染层投递 mousemove（真实鼠标
 * 事件因此到不了页面，拖拽/点击全部失效）。命中盒为视口坐标，叠加窗口位置
 * 得屏幕坐标；拖拽锁定期间跳过（保持不穿透）。
 */
function startPetHitPoller(): void {
  setInterval(() => {
    if (!petWin || petWin.isDestroyed()) return
    const pt = screen.getCursorScreenPoint()
    // 按压拖动：窗口跟随光标（渲染层收不到真实 pointermove，由这里权威驱动）
    if (petPressing) {
      const size = getPinnedPetSize()
      const tx = Math.round(petPressWin.x + pt.x - petPressCursor.x)
      const ty = Math.round(petPressWin.y + pt.y - petPressCursor.y)
      petWin.setBounds({ x: tx, y: ty, width: size.width, height: size.height })
      return
    }
    if (!petHitbox) return
    if (petPointerLocked) return // 锁定态已在 petSetPointerLock 即时应用
    const b = petWin.getBounds()
    const inside =
      pt.x >= b.x + petHitbox.x &&
      pt.x <= b.x + petHitbox.x + petHitbox.w &&
      pt.y >= b.y + petHitbox.y &&
      pt.y <= b.y + petHitbox.y + petHitbox.h
    const shouldIgnore = !inside
    if (shouldIgnore !== petMouseIgnored) {
      petMouseIgnored = shouldIgnore
      petWin.setIgnoreMouseEvents(shouldIgnore, { forward: true })
      // 广播 near 态：渲染层在光标停留在角色身上时暂停自主走动（伸手抓她时她不走开）
      broadcast(IPC.petCursorNear, inside)
      if (is.dev) console.log(`[pet-hit] 光标${inside ? '进入' : '离开'}角色命中盒 -> ignore=${shouldIgnore}`)
    }
  }, 33)
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
    // 兼容通道（渲染层翻转让位于主进程轮询，正常不再发送）
    petMouseIgnored = payload.ignore
    petWin?.setIgnoreMouseEvents(payload.ignore, { forward: true })
  })

  ipcMain.on(IPC.petSetHitbox, (_e, box: { x: number; y: number; w: number; h: number }) => {
    petHitbox = box
  })

  ipcMain.on(IPC.petSetPointerLock, (_e, payload: { locked: boolean }) => {
    petPointerLocked = payload.locked
    if (petWin) {
      // 仅状态真正变化时重断言——按住手势中途重设穿透标志会打断指针捕获
      // （页面上表现为 pointerdown 后立刻 pointerup，按压瞬灭）
      const target = !payload.locked
      if (target !== petMouseIgnored) {
        petMouseIgnored = target
        petWin.setIgnoreMouseEvents(target, { forward: true })
      }
    }
  })

  ipcMain.on(IPC.petPressBegin, (_e, p: { screenX: number; screenY: number }) => {
    if (!petWin || petWin.isDestroyed()) return
    petPressing = true
    petPressCursor = { x: p.screenX, y: p.screenY }
    const b = petWin.getBounds()
    petPressWin = { x: b.x, y: b.y }
    if (is.dev) console.log(`[pet-press] 按压开始 @${p.screenX},${p.screenY} win=${b.x},${b.y}`)
  })

  ipcMain.on(IPC.petPressEnd, () => {
    petPressing = false
  })

  // 走动/拖拽/下落的窗口移动：渲染层已按帧节流（16ms）。用 setBounds 钉死尺寸——
  // Windows 上对 transparent 窗口反复 setPosition 会因 DPI 取整累积漂移（越拖越大）。
  // 但 setBounds 会打断 setIgnoreMouseEvents 的 forward 消息转发（真实鼠标事件不再
  // 抵达渲染层），因此每次移动后按当前穿透态重断言一次。
  ipcMain.on(IPC.petMoveWindow, (_e, payload: { x: number; y: number }) => {
    if (petWin && petWin.isVisible()) {
      const size = getPinnedPetSize()
      petWin.setBounds({
        x: Math.round(payload.x),
        y: Math.round(payload.y),
        width: size.width,
        height: size.height
      })
      petWin.setIgnoreMouseEvents(petMouseIgnored, { forward: true })
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

  ipcMain.handle(
    IPC.chatSend,
    async (
      _e,
      payload: { text: string; attachment?: { name: string; text: string; truncated: boolean } }
    ): Promise<ReturnType<typeof aiService.send>> => aiService.send(payload.text, payload.attachment)
  )
  ipcMain.handle(IPC.chatHistory, () => aiService.getUiHistory())
  ipcMain.handle(IPC.chatAttach, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '附加文档（pdf / docx / txt / md）',
      filters: [
        { name: '文档', extensions: ['pdf', 'docx', 'txt', 'md'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, error: '已取消' }
    }
    const r = await extractTextFromFile(result.filePaths[0])
    if (!r.ok) return { ok: false, error: r.error }
    return { ok: true, name: r.name, text: r.text, truncated: r.truncated }
  })

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
    startPetHitPoller()

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
