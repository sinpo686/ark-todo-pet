/** preload：把主进程 IPC 包装成 window.api（形状 = src/shared/ipc.ts 的 ApiShape）。 */

import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
import type { TodosMutateMsg } from '../shared/ipc'
import type { ModelEntry, AppSettingsShape } from '../shared/ipc'
import type { Todo } from '../shared/types'
import type { PomoState } from '../shared/pomodoro'
import type { Mood } from '../shared/mood'
import type { ReminderEvent } from '../shared/reminders'

const api = {
  petSetMouseIgnore(ignore: boolean): void {
    ipcRenderer.send(IPC.petSetMouseIgnore, { ignore })
  },
  petMoveWindow(x: number, y: number): void {
    ipcRenderer.send(IPC.petMoveWindow, { x, y })
  },
  openTodoPanel(): void {
    ipcRenderer.send(IPC.openTodoPanel)
  },
  todoPanelPin(pinned: boolean): void {
    ipcRenderer.send(IPC.todoPanelPin, { pinned })
  },
  todosMutate(msg: TodosMutateMsg): void {
    ipcRenderer.send(IPC.todosMutate, msg)
  },
  pomoCommand(op: 'start' | 'stop'): void {
    ipcRenderer.send(IPC.pomoCommand, { op })
  },
  openSettings(): void {
    ipcRenderer.send(IPC.openSettings)
  },
  getTodos(): Promise<Todo[]> {
    return ipcRenderer.invoke('todos:get')
  },
  getPomoState(): Promise<PomoState> {
    return ipcRenderer.invoke('pomo:get-state')
  },
  modelsListLocal(): Promise<ModelEntry[]> {
    return ipcRenderer.invoke(IPC.modelsListLocal)
  },
  settingsGet(): Promise<AppSettingsShape> {
    return ipcRenderer.invoke(IPC.settingsGet)
  },
  async settingsSet(patch: Partial<AppSettingsShape>): Promise<void> {
    await ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  modelsListRemote(): Promise<ModelEntry[]> {
    return ipcRenderer.invoke(IPC.modelsListRemote)
  },
  modelsDownload(dir: string): Promise<void> {
    return ipcRenderer.invoke(IPC.modelsDownload, { dir })
  },
  onModelsDownloadProgress(cb: (p: { dir: string; pct: number }) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, p: { dir: string; pct: number }): void => cb(p)
    ipcRenderer.on(IPC.modelsDownloadProgress, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.modelsDownloadProgress, listener)
    }
  },
  modelsImportZip(): Promise<{ ok: boolean; dir?: string; error?: string }> {
    return ipcRenderer.invoke(IPC.modelsImportZip)
  },
  async modelsSetCurrent(dir: string): Promise<void> {
    await ipcRenderer.invoke(IPC.modelsSetCurrent, { dir })
  },
  onModelChanged(cb: (dir: string) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, dir: string): void => cb(dir)
    ipcRenderer.on(IPC.modelChanged, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.modelChanged, listener)
    }
  },
  aiTest(): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    return ipcRenderer.invoke(IPC.aiTest)
  },
  onTodosChanged(cb: (todos: Todo[]) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, todos: Todo[]): void => cb(todos)
    ipcRenderer.on(IPC.todosChanged, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.todosChanged, listener)
    }
  },
  onPomoChanged(cb: (state: PomoState) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, state: PomoState): void => cb(state)
    ipcRenderer.on(IPC.pomoChanged, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.pomoChanged, listener)
    }
  },
  onMoodChanged(cb: (mood: Mood) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, mood: Mood): void => cb(mood)
    ipcRenderer.on(IPC.moodChanged, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.moodChanged, listener)
    }
  },
  onRemindTrigger(cb: (event: ReminderEvent) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, event: ReminderEvent): void => cb(event)
    ipcRenderer.on(IPC.remindTrigger, listener)
    return (): void => {
      ipcRenderer.removeListener(IPC.remindTrigger, listener)
    }
  }
}

export type Api = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
