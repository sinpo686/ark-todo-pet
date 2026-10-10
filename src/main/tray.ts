/** 托盘菜单：显示/隐藏桌宠、打开待办、打开设置、退出。 */

import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'

export function createTray(onTogglePet: () => void, onOpenTodo: () => void, onOpenSettings: () => void): Tray {
  // Windows 托盘用 png 可直接接受（自动缩放）；打包后 resources 目录由 electron-builder 保留
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
  let image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) {
    image = nativeImage.createEmpty()
  }
  const tray = new Tray(image)
  tray.setToolTip('代办桌宠 ArkTodoPet')

  const rebuild = (): void => {
    const menu = Menu.buildFromTemplate([
      { label: '显示 / 隐藏桌宠', click: onTogglePet }, // T12 会在此插入「切换干员」子菜单
      { label: '打开待办', click: onOpenTodo },
      { label: '设置', click: onOpenSettings },
      { type: 'separator' },
      { label: '退出', click: (): void => {
        app.quit()
      } }
    ])
    tray.setContextMenu(menu)
  }
  rebuild()

  console.log('[tray] 托盘已创建')
  return tray
}
