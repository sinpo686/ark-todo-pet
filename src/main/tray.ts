/** 托盘菜单：切换干员子菜单、显示/隐藏桌宠、打开待办、打开设置、退出。 */

import { Tray, Menu, nativeImage, app } from 'electron'
import { join } from 'path'
import type { ModelEntry } from '../shared/ipc'

/** 带刷新能力的托盘句柄（模型清单变化后重建菜单） */
export type TrayWithRefresh = Tray & { refresh: () => void }

export interface TrayModelHooks {
  /** 本地模型清单（菜单展开时拉取） */
  getModels: () => Promise<ModelEntry[]>
  /** 当前使用中的模型目录名 */
  getCurrent: () => string | null
  /** 切换模型 */
  onSwitchModel: (dir: string) => void
}

export function createTray(
  onTogglePet: () => void,
  onOpenTodo: () => void,
  onOpenSettings: () => void,
  modelHooks?: TrayModelHooks
): Tray & { refresh: () => void } {
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
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: '显示 / 隐藏桌宠', click: onTogglePet },
      { label: '打开待办', click: onOpenTodo },
      { label: '设置', click: onOpenSettings },
      { type: 'separator' },
      { label: '退出', click: (): void => app.quit() }
    ]
    if (modelHooks) {
      // 切换干员子菜单：菜单构建是同步的，模型清单用上次缓存（refresh 时重建）
      const current = modelHooks.getCurrent()
      const items = modelCache.map((m) => ({
        label: `${m.dir === current ? '● ' : ''}${m.name}`,
        click: (): void => modelHooks.onSwitchModel(m.dir)
      }))
      template.splice(1, 0, {
        label: '切换干员',
        submenu: items.length > 0 ? items : [{ label: '（先去设置下载模型）', enabled: false }]
      })
    }
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  // 模型清单缓存：菜单 API 是同步的，异步清单落地后 refresh() 重建
  let modelCache: ModelEntry[] = []
  const refresh = (): void => {
    if (!modelHooks) {
      rebuild()
      return
    }
    modelHooks
      .getModels()
      .then((models) => {
        modelCache = models
        rebuild()
      })
      .catch(() => rebuild())
  }
  refresh()

  console.log('[tray] 托盘已创建')
  return Object.assign(tray, { refresh })
}
