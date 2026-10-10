/** 窗口工厂：桌宠窗（透明置顶）、待办面板（懒创建）、设置窗（懒创建）。 */

import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { getSettings, setSetting } from './store'

export const PET_SIZE = { width: 300, height: 360 }

function loadWindowPage(win: BrowserWindow, page: 'pet' | 'todo' | 'settings'): void {
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
  const win = new BrowserWindow({
    width: PET_SIZE.width,
    height: PET_SIZE.height,
    x: settings.petX ?? Math.floor(screenW * 0.7),
    y: settings.petY ?? Math.floor(screenH - PET_SIZE.height),
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
