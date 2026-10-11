/** 窗口工厂：桌宠窗（透明置顶）、待办面板（懒创建）、设置窗（懒创建）。 */

import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getSettings, setSetting } from './store'

export const PET_SIZE = { width: 300, height: 360 }

/**
 * 桌宠窗口的钉死尺寸：Windows 上对 transparent 窗口反复 setPosition 会因 DPI
 * 取整累积漂移（探针实测 184→190+ 持续变大），因此移动一律走 setBounds 并
 * 每次带上该固定尺寸；仅 applyPetScale（用户改缩放）与建窗允许改变它。
 */
let petPinnedSize: { width: number; height: number } = { ...PET_SIZE }

export function getPinnedPetSize(): { width: number; height: number } {
  return { ...petPinnedSize }
}

/** 缩放安全边界（与设置页滑杆 0.5–2.0 一致） */
export function clampScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1
  return Math.min(2, Math.max(0.5, scale))
}

/** 应用桌宠缩放：重设窗口尺寸并保持底部锚定（模型按窗口高度自适应）；同时更新钉死尺寸 */
export function applyPetScale(petWin: BrowserWindow, scale: number): void {
  const s = clampScale(scale)
  const bounds = petWin.getBounds()
  petPinnedSize = { width: Math.round(PET_SIZE.width * s), height: Math.round(PET_SIZE.height * s) }
  petWin.setBounds({
    x: bounds.x,
    y: bounds.y + (bounds.height - petPinnedSize.height),
    width: petPinnedSize.width,
    height: petPinnedSize.height
  })
}

function loadWindowPage(win: BrowserWindow, page: 'pet' | 'todo' | 'chat' | 'settings'): void {
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/src/windows/${page}/index.html`)
  } else {
    win.loadFile(join(__dirname, `../renderer/src/windows/${page}/index.html`))
  }
}

function baseWebPrefs(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: false
  }
}

/** 桌宠窗口：无边框透明置顶、不占任务栏、默认鼠标穿透（forward 转发） */
export function createPetWindow(): BrowserWindow {
  const settings = getSettings()
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
  const scale = clampScale(settings.petScale)
  petPinnedSize = { width: Math.round(PET_SIZE.width * scale), height: Math.round(PET_SIZE.height * scale) }
  const win = new BrowserWindow({
    width: petPinnedSize.width,
    height: petPinnedSize.height,
    x: settings.petX ?? Math.floor(screenW * 0.7),
    y: settings.petY ?? Math.floor(screenH - PET_SIZE.height * scale),
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    show: false,
    webPreferences: baseWebPrefs()
  })
  win.setIgnoreMouseEvents(true, { forward: true })
  win.once('ready-to-show', () => win.show())
  if (is.dev) {
    // dev 冒烟：renderer 的 console 默认不进主进程终端，转发出来便于无人工验证
    win.webContents.on('console-message', (_event, ...args) => {
      console.log('[pet-console]', ...args)
    })
  }
  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  // 位置持久化（防抖）
  let saveTimer: NodeJS.Timeout | null = null
  const savePos = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      const [x, y] = win.getPosition()
      setSetting('petX', x)
      setSetting('petY', y)
    }, 800)
  }
  win.on('moved', savePos)
  loadWindowPage(win, 'pet')
  console.log('[windows] pet 窗口已创建')
  return win
}

let todoPanelWin: BrowserWindow | null = null

/** 待办面板：懒创建；弹出位置在桌宠右侧，屏幕边缘自动翻转防出屏 */
export function openTodoPanel(petWin: BrowserWindow): void {
  if (!todoPanelWin || todoPanelWin.isDestroyed()) {
    todoPanelWin = new BrowserWindow({
      width: 360,
      height: 480,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: baseWebPrefs()
    })
    todoPanelWin.on('blur', () => {
      // 未固定时失焦自动收起（固定态由 renderer 经 todoPanelPin 通知 main 维持）
      if (todoPanelWin && !panelPinned) todoPanelWin.hide()
    })
    if (is.dev) {
      // dev 冒烟：转发面板 renderer 的 console 到主进程终端（无人工验证取证）
      todoPanelWin.webContents.on('console-message', (_event, ...args) => {
        console.log('[todo-console]', ...args)
      })
    }
    loadWindowPage(todoPanelWin, 'todo')
    console.log('[windows] todo 面板已创建（懒）')
  }
  if (todoPanelWin) {
    const petBounds = petWin.getBounds()
    const panelW = 360
    const workArea = screen.getDisplayMatching(petBounds).workArea
    let x = petBounds.x + petBounds.width + 8
    if (x + panelW > workArea.x + workArea.width) {
      x = petBounds.x - panelW - 8 // 右侧放不下翻到左侧
    }
    if (x < workArea.x) x = workArea.x
    let y = petBounds.y
    if (y + 480 > workArea.y + workArea.height) {
      y = workArea.y + workArea.height - 480
    }
    if (y < workArea.y) y = workArea.y
    todoPanelWin.setPosition(x, y, false)
    todoPanelWin.show()
    todoPanelWin.focus()
  }
}

let panelPinned = false

export function setPanelPinned(pinned: boolean): void {
  panelPinned = pinned
}

let chatWin: BrowserWindow | null = null

/**
 * 干员通讯（T13 修正）：独立小窗而非桌宠窗口内嵌层——内嵌会被小缩放的窗口裁切，
 * 且桌宠的鼠标穿透按角色命中盒开启，聊天层点不到也打不了字。
 */
export function openChatWindow(petWin: BrowserWindow): void {
  if (!chatWin || chatWin.isDestroyed()) {
    chatWin = new BrowserWindow({
      width: 300,
      height: 420,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: baseWebPrefs()
    })
    chatWin.on('closed', () => {
      chatWin = null
    })
    if (is.dev) {
      chatWin.webContents.on('console-message', (_event, ...args) => {
        console.log('[chat-console]', ...args)
      })
    }
    loadWindowPage(chatWin, 'chat')
    console.log('[windows] chat 窗口已创建（懒）')
  }
  if (chatWin) {
    const petBounds = petWin.getBounds()
    const w = 300
    const h = 420
    const workArea = screen.getDisplayMatching(petBounds).workArea
    let x = petBounds.x + petBounds.width + 8
    if (x + w > workArea.x + workArea.width) x = petBounds.x - w - 8
    if (x < workArea.x) x = workArea.x
    let y = petBounds.y
    if (y + h > workArea.y + workArea.height) y = workArea.y + workArea.height - h
    if (y < workArea.y) y = workArea.y
    chatWin.setPosition(x, y, false)
    chatWin.show()
    chatWin.focus()
  }
}

let settingsWin: BrowserWindow | null = null

export function openSettingsWindow(): void {
  if (!settingsWin || settingsWin.isDestroyed()) {
    settingsWin = new BrowserWindow({
      width: 560,
      height: 640,
      show: false,
      autoHideMenuBar: true,
      webPreferences: baseWebPrefs()
    })
    settingsWin.on('closed', () => {
      settingsWin = null
    })
    if (is.dev) {
      settingsWin.webContents.on('console-message', (_event, ...args) => {
        console.log('[settings-console]', ...args)
      })
    }
    loadWindowPage(settingsWin, 'settings')
    console.log('[windows] settings 窗口已创建（懒）')
  }
  settingsWin.show()
  settingsWin.focus()
}

/** 广播辅助：向所有存活窗口发送 */
export function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }
}

/** 定向：仅桌宠窗口 */
export function sendToPet(petWin: BrowserWindow, channel: string, payload: unknown): void {
  if (petWin && !petWin.isDestroyed()) {
    petWin.webContents.send(channel, payload)
  }
}

export function hideTodoPanel(): void {
  if (todoPanelWin && !todoPanelWin.isDestroyed()) todoPanelWin.hide()
}
