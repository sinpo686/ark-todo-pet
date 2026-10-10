import { ElectronAPI } from '@electron-toolkit/preload'
import type { ApiShape } from '../shared/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    /** preload contextBridge 暴露的 IPC 包装，形状见 src/shared/ipc.ts 的 ApiShape */
    api: ApiShape
  }
}
