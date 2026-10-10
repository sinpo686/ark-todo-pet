# 代办桌宠 (ark-todo-pet) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 明日方舟风格 Spine 桌宠：点击看待办、截止提醒、番茄钟、情绪联动、可选 AI 对话。

**Architecture:** Electron 主进程管窗口/托盘/通知/调度；React 渲染层分三个窗口（桌宠/待办面板/设置）；所有业务逻辑放在 electron 无关的纯 TS 模块（`src/shared`）中以便 vitest 单测；pixi.js + pixi-spine 渲染 Ark-Pets 格式模型。

**Tech Stack:** electron-vite 5 + Electron + React 18 + TypeScript + pixi@^7.4 + pixi-spine@^3.1.2（Spine 3.8 运行时） + electron-store@^8.2（CJS） + vitest。

**Spec:** `docs/superpowers/specs/2026-10-10-desktop-pet-todo-design.md`

## Global Constraints

- npm registry 必须是 `https://registry.npmjs.org/`（本机 npmmirror 不可达）。
- Electron 二进制下载走代理：`ELECTRON_GET_USE_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897 npm install`（Clash Verge 内核端口）。
- `src/shared/**` 与 `src/main/services/*.logic.ts` **禁止 import electron**（纯逻辑，可测）；持久化与系统能力只在 main 进程外壳中做。
- 版本钉死：`pixi@^7.4.3`、`pixi-spine@^3.1.2`、`electron-store@^8.2.0`。React 18（非 19，生态稳定）。
- 平台：Windows；路径一律用 `app.getPath('userData')` 派生。
- 每个 Task 结束必须 commit；测试命令统一 `npx vitest run`。
- 模型资产不进 git（`.gitignore` 含 `*.skel *.atlas`，png 按目录排除 `models/`）；版权属鹰角，仅个人使用。

## 已核实的参考事实（实现时直接依赖）

1. Ark-Pets 模型 = 一个文件夹内 `.atlas` + `.png`(1..n) + `.skel`（**二进制**骨骼，非 json）；元数据在 `models_data.json`：`data.<dir> = { name, type, assetList: {".atlas": "...", ".png": [...], ".skel": "..."} }`。
2. Ark-Models 仓库 `models/` 下是**每模型一个目录**（如 `models/002_amiya`），非 zip。下载器需按文件逐个拉取。
3. 动画命名规范（Ark-Pets `AnimClip.AnimType`，权威正则，忽略大小写）：
   - `IDLE: ^((Id.?le)|(Relax)).{0,2}$` offsetY=5；`MOVE: ^Move.{0,2}$` offsetY=5
   - `SIT: ^Sit$` offsetY=50；`SLEEP: ^Sleep$` offsetY=25
   - `INTERACT: ^Interact$` offsetY=5（戳一戳）；`SPECIAL: ^Special$` offsetY=5
   - 修饰符 `BEGIN: ^((Begin)|(Start)|(Up)|(Appear))$`、`LOOP: ^Loop$`、`END: ^((End)|(Down)|(Disappear))$`
   - 动画全名以 `/` 分段，如 `Idle/Loop/C1`、`Sit/Begin`。

---

### Task 1: 项目脚手架与工具链

**Files:**
- Create: 整个 electron-vite 脚手架（package.json / electron.vite.config.ts / src/main/index.ts / src/preload/index.ts / src/renderer/*）
- Modify: `.gitignore`（追加构建产物）
- Test: `npm run dev` 手动验证 + `npx vitest run` 空跑

**Interfaces:**
- Produces: 可运行的 electron-vite React-TS 工程；目录约定 `src/main`（主进程）、`src/preload`、`src/renderer/src/windows/{pet,todo,settings}`（三窗口入口）、`src/shared`（纯逻辑）；vitest 配置就绪。

- [ ] **Step 1: 生成脚手架**

```bash
cd "C:\Users\sinpo\Desktop\代办桌宠"
npm create @quick-start/electron@latest . -- --template react-ts --skip
# 注意：目录非空（有 docs/ README/ .git），脚手架若拒绝则先把生成内容落到临时目录再合并
```

- [ ] **Step 2: 修正 registry 与安装依赖（带代理）**

```bash
npm config set registry https://registry.npmjs.org/
export ELECTRON_GET_USE_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7897
npm install
npm install pixi@^7.4.3 pixi-spine@^3.1.2
npm install -D vitest
```

- [ ] **Step 3: 建目录与 vitest 配置**

`vitest.config.ts`（根目录）：

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' }
})
```

`package.json` scripts 增补：`"test": "vitest run"`。建立空目录 `src/shared/`、`src/renderer/src/windows/pet/`、`.../todo/`、`.../settings/`（各放一个占位 `index.html` + `main.tsx`，由脚手架默认页复制改造）。

- [ ] **Step 4: 验证 dev 启动**

Run: `npm run dev`
Expected: 打开一个 Electron 窗口显示脚手架默认页；无控制台报错。关闭。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: electron-vite react-ts 脚手架 + vitest + pixi 依赖"
```

---

### Task 2: 共享类型 + TodoStore 纯逻辑（TDD）

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/todoStore.ts`
- Create: `src/shared/todoStore.test.ts`

**Interfaces:**
- Produces（后续所有任务依赖）:

```ts
// src/shared/types.ts
export type Priority = 'low' | 'normal' | 'high'
export interface Todo {
  id: string; title: string; notes?: string; dueAt?: number
  priority: Priority; done: boolean; completedAt?: number
  createdAt: number; source: 'manual' | 'ai'
}
export type TodoGroup = { overdue: Todo[]; upcoming: Todo[]; undated: Todo[] }

// src/shared/todoStore.ts —— 纯函数，无 IO
export function groupTodos(todos: Todo[], now: number): TodoGroup
export function addTodo(todos: Todo[], input: { title: string; dueAt?: number; priority?: Priority; notes?: string; source?: 'manual' | 'ai' }, now: number, idGen: () => string): Todo[]
export function toggleTodo(todos: Todo[], id: string, now: number): Todo[]
export function editTodo(todos: Todo[], id: string, patch: Partial<Pick<Todo, 'title' | 'notes' | 'dueAt' | 'priority'>>): Todo[]
export function deleteTodo(todos: Todo[], id: string): Todo[]
export function isOverdue(t: Todo, now: number): boolean
```

- [ ] **Step 1: 写失败测试**

`src/shared/todoStore.test.ts` 核心用例（节选骨架，实现者补全断言值）：

```ts
import { describe, it, expect } from 'vitest'
import { groupTodos, addTodo, toggleTodo, isOverdue } from './todoStore'
const NOW = 1_700_000_000_000
const seq = { i: 0, gen: () => `id-${++seq.i}` }

describe('groupTodos', () => {
  it('逾期且未完成的进 overdue；今天/未来进 upcoming（按 dueAt 升序）；无 dueAt 进 undated', () => {
    const todos = [
      { id: 'a', title: '过期', dueAt: NOW - 1000, priority: 'normal', done: false, createdAt: NOW, source: 'manual' },
      { id: 'b', title: '明天', dueAt: NOW + 86_400_000, priority: 'normal', done: false, createdAt: NOW, source: 'manual' },
      { id: 'c', title: '没日期', priority: 'normal', done: false, createdAt: NOW, source: 'manual' },
      { id: 'd', title: '过期但已完成', dueAt: NOW - 1000, priority: 'normal', done: true, completedAt: NOW, createdAt: NOW, source: 'manual' }
    ]
    const g = groupTodos(todos, NOW)
    expect(g.overdue.map(t => t.id)).toEqual(['a'])
    expect(g.upcoming.map(t => t.id)).toEqual(['b'])
    expect(g.undated.map(t => t.id)).toEqual(['c'])
  })
  it('upcoming 按时间升序排序', () => { /* 两条不同 dueAt，断言顺序 */ })
})
describe('addTodo/toggleTodo', () => {
  it('addTodo 生成完整字段且默认 priority=normal source=manual', () => { /* ... */ })
  it('toggleTodo 置 done 并写 completedAt；再 toggle 清除', () => { /* ... */ })
})
describe('isOverdue', () => {
  it('done 的永不逾期；无 dueAt 的不逾期', () => { /* ... */ })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/shared/todoStore.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `types.ts` 与 `todoStore.ts`**

实现要点：`groupTodos` 中 upcoming 按 `dueAt` 升序；所有函数返回新数组（不可变）；`addTodo` 展开默认值 `{ priority: 'normal', source: 'manual', done: false }`。

- [ ] **Step 4: 跑测试通过**

Run: `npx vitest run src/shared/todoStore.test.ts`
Expected: PASS 全绿。

- [ ] **Step 5: Commit**

```bash
git add src/shared && git commit -m "feat: Todo 数据模型与分组/CRUD 纯逻辑（TDD）"
```

---

### Task 3: 自然语言时间解析器（TDD）

**Files:**
- Create: `src/shared/parseDue.ts`
- Create: `src/shared/parseDue.test.ts`

**Interfaces:**
- Consumes: 无。
- Produces:

```ts
/** 从输入文本中解析截止时间；返回 { dueAt?, cleanTitle }。解析失败则 dueAt 为 undefined，文本原样返回。 */
export function parseDue(text: string, now: Date): { dueAt?: number; cleanTitle: string }
```

- [ ] **Step 1: 写失败测试**（必须覆盖的模式）

```ts
import { describe, it, expect } from 'vitest'
import { parseDue } from './parseDue'
const base = new Date(2026, 9, 10, 10, 0) // 2026-10-10 10:00 周六

describe('parseDue 模式覆盖', () => {
  it('"交报告 明天下午3点" → 明天15:00，标题"交报告"', () => {
    const r = parseDue('交报告 明天下午3点', base)
    expect(r.dueAt).toBe(new Date(2026, 9, 11, 15, 0).getTime())
    expect(r.cleanTitle).toBe('交报告')
  })
  it('今天晚上8:30 / 后天上午10点 / 2小时后 / 30分钟后 / 周一9点（下一个周一）', () => { /* 每个一条断言 */ })
  it('"下午3点"（无日期）→ 今天的15:00，若已过则明天', () => { /* ... */ })
  it('无时间词 → dueAt undefined，cleanTitle 原文', () => {
    const r = parseDue('纯标题', base)
    expect(r.dueAt).toBeUndefined(); expect(r.cleanTitle).toBe('纯标题')
  })
})
```

- [ ] **Step 2: 确认失败** — `npx vitest run src/shared/parseDue.test.ts` → FAIL

- [ ] **Step 3: 实现解析器**

实现要点（正则按优先级尝试，命中即止；时间词从标题中剥离并 trim）：
- 日期段：`今天|明天|后天|大后天`；`周([一二三四五六日天])`（≤今天则+7天）；无日期段时"时段+时刻"按"今天，已过则明天"。
- 时段段：`早上|上午`(→小时<12 原样)、`中午`(11-13)、`下午`(小时+12 当小时≤6…按中文习惯 `下午3点`=15)、`晚上|傍晚`(小时+12)。
- 时刻：`(\d{1,2})[点:：时](半|(\d{1,2})分?)?`；`半`=30 分。
- 相对：`(\d+(?:\.\d+)?)\s*(个)?(小时|分钟|分)后`。
- 实现放 `src/shared/parseDue.ts`，≤150 行，不引第三方库。

- [ ] **Step 4: 通过 + Commit**

```bash
npx vitest run src/shared/parseDue.test.ts   # PASS
git add src/shared && git commit -m "feat: 轻量自然语言截止时间解析（TDD）"
```

---

### Task 4: 情绪引擎（TDD）

**Files:**
- Create: `src/shared/mood.ts`
- Create: `src/shared/mood.test.ts`

**Interfaces:**
- Consumes: `src/shared/types.ts` 的 `Todo`。
- Produces:

```ts
export type Mood = 'happy' | 'normal' | 'gloomy'
export interface MoodParams { walkProbPerMin: number; idleSpecialProb: number }
export function computeMood(todos: Todo[], pomodoroState: 'idle' | 'focus' | 'rest', now: number): Mood
export function moodParams(mood: Mood): MoodParams   // happy:{3,0.25} normal:{1.5,0.12} gloomy:{0.3,0.03}
```

- [ ] **Step 1: 失败测试**（规则直接来自规格 §6.2）

```ts
import { describe, it, expect } from 'vitest'
import { computeMood } from './mood'
const NOW = 1_700_000_000_000
const mk = (over: Partial<unknown> = {}) => ({ id: 'x', title: 't', priority: 'normal', done: false, createdAt: NOW, source: 'manual', ...over })
// 逾期未完成 n1≥3 或 (n1+n2)≥5 → gloomy；n1=0 且 今日到期未完成 n2=0 且 今日完成 n3>0 → happy；其余 normal
// focus 状态强制返回 'normal'（专注表现由状态机接管，mood 不参与）
```
覆盖 5 条：纯逾期×3 → gloomy；混合堆积×5 → gloomy；清空+今日有完成 → happy；常规 → normal；focus 时即使堆积也 normal。

- [ ] **Step 2: 确认失败** → FAIL
- [ ] **Step 3: 实现**（"今日"按 `new Date(now)` 的本地日界判断：`sameDay(a,b)` 工具函数内联）
- [ ] **Step 4: 通过 + Commit** `git commit -m "feat: 情绪引擎 computeMood（TDD）"`

---

### Task 5: 提醒判定器 + 番茄钟 reducer（TDD）

**Files:**
- Create: `src/shared/reminders.ts` + `src/shared/reminders.test.ts`
- Create: `src/shared/pomodoro.ts` + `src/shared/pomodoro.test.ts`

**Interfaces:**
- Produces:

```ts
// reminders.ts
export interface ReminderEvent { todoId: string; title: string; kind: 'lead' | 'due' }
/** 扫描未完成待办，返回本周期应触发的事件（不与 remindedSet 重复）。leadMin 提前提醒分钟数。 */
export function decideReminders(todos: Todo[], now: number, reminded: ReadonlySet<string>, leadMin: number): ReminderEvent[]
// reminded 的 key 约定：`${todoId}:lead` 与 `${todoId}:due`

// pomodoro.ts
export type PomoState = { phase: 'idle' | 'focus' | 'rest'; phaseEndsAt: number; focusCount: number }
export function pomoStart(s: PomoState, now: number, focusMin: number): PomoState
export function pomoTick(s: PomoState, now: number, focusMin: number, restMin: number): { state: PomoState; event: null | 'focusEnd' | 'restEnd' }
export function pomoStop(s: PomoState): PomoState
```

- [ ] **Step 1: 失败测试**
  - reminders：到 dueAt 触发 `due`；到 `dueAt - lead` 触发 `lead` 且同时不再触发 due；reminded 去重；done 的不触发；无 dueAt 不触发。
  - pomodoro：start 进入 focus 且 phaseEndsAt=now+focusMin；tick 过期时 focus→发出 focusEnd 并进入 rest；rest 过期→restEnd 且 focusCount+1 回 idle；stop 回 idle 不计数。
- [ ] **Step 2: 确认失败** → FAIL
- [ ] **Step 3: 实现两个模块**（纯函数、无定时器，定时由主进程外壳驱动）
- [ ] **Step 4: 通过 + Commit** `git commit -m "feat: 提醒判定与番茄钟状态机（TDD）"`

---

### Task 6: 主进程骨架（窗口/托盘/IPC/单实例）

**Files:**
- Modify: `src/main/index.ts`
- Create: `src/main/windows.ts`（窗口工厂与定位）、`src/main/tray.ts`
- Create: `src/preload/index.ts`（统一 contextBridge）
- Create: `src/shared/ipc.ts`（通道名与载荷类型，renderer 经 preload 暴露的 API 形状）

**Interfaces:**
- Consumes: Task 2-5 的纯逻辑。
- Produces（renderer 侧全局 API，后续 UI 任务依赖）:

```ts
// src/shared/ipc.ts
export const IPC = {
  petSetMouseIgnore: 'pet:set-mouse-ignore',        // renderer→main { ignore: boolean }
  openTodoPanel: 'todo:open-panel',                 // renderer(pet)→main
  todoPanelPin: 'todo:panel-pin',                   // renderer(todo)→main { pinned: boolean }
  todosChanged: 'todos:changed',                    // main→所有窗口 Todo[]
  todosMutate: 'todos:mutate',                      // renderer→main { op: 'add'|'toggle'|'edit'|'delete'; payload: unknown }
  pomoCommand: 'pomo:command',                      // renderer→main { op: 'start'|'stop' }
  pomoChanged: 'pomo:changed',                      // main→所有 PomoState
  moodChanged: 'mood:changed',                      // main→pet Mood
  openSettings: 'settings:open',
} as const
export interface ApiShape { /* 与上面对应的方法签名 */ }
```

实现要点：
- 单实例锁 `app.requestSingleInstanceLock()`，失败即 `app.quit()`。
- 桌宠窗口：`new BrowserWindow({ frame:false, transparent:true, alwaysOnTop:true, skipTaskbar:true, resizable:false, hasShadow:false })`，`setIgnoreMouseEvents(true, { forward: true })`；位置从 electron-store 恢复。
- 待办面板/设置窗口：懒创建、`hide()` 不销毁；面板弹出位置在桌宠窗口右侧，`screen.getDisplayMatching` 防出屏。
- Todo 持久化外壳 `src/main/store.ts`：electron-store v8 存 `{ todos: Todo[] }` key `todos`；写前轮换 `todos.json.bak`（store 库自身是单文件，备份用 `fs.copyFile`，路径 `path.join(app.getPath('userData'), 'todos.json.bak')`——注：electron-store 文件名即 `todos.json` 不可改，直接对它的磁盘文件做备份）；任何 mutate 后广播 `todosChanged` 并重算 mood 广播。
- 提醒循环：`setInterval(30_000)` 调 `decideReminders`，触发即 `new Notification({ title, body }).show()` 并 webContents.send 给 pet 窗口触发 Remind 行为；番茄钟同循环驱动 `pomoTick`。
- 开机自启：设置变化时 `app.setLoginItemSettings({ openAtLogin })`。

- [ ] **Step 1: 实现上述文件**（无独立单测；类型编译即门槛）
- [ ] **Step 2: 类型检查** `npm run typecheck`（脚手架自带）→ 通过
- [ ] **Step 3: 手动验证** `npm run dev`：托盘出现、桌宠窗口为透明置顶、二次启动被单实例拦截
- [ ] **Step 4: Commit** `git commit -m "feat: 主进程窗口/托盘/IPC/提醒调度骨架"`

---

### Task 7: 桌宠渲染窗口：pixi 画布 + 鼠标穿透

**Files:**
- Create: `src/renderer/src/windows/pet/index.html`、`main.tsx`、`PetStage.ts`
- Modify: `src/main/index.ts`（加载 pet 入口）

**Interfaces:**
- Consumes: Task 6 的 `IPC.petSetMouseIgnore`。
- Produces: `PetStage` 类（Task 8/9 在其上叠加 Spine 与状态机）：

```ts
export class PetStage {
  constructor(canvasParent: HTMLElement)
  get pixiApp(): PIXI.Application
  setHitTest(fn: (x: number, y: number) => boolean): void   // 角色命中区域判定回调
  destroy(): void
}
```

实现要点：
- `new PIXI.Application({ backgroundAlpha: 0, resizeTo: window, antialias: true })`。
- 命中检测：`window.addEventListener('mousemove')` → `hitTest(e.clientX, e.clientY)` → 变化时 `window.api.petSetMouseIgnore(!inside)`（renderer 经 preload 的 `contextBridge` 暴露，节流 50ms）。
- 临时调试用命中区域：中央 200×300 矩形（Task 8 换成 Spine 骨骼包围盒）。

- [ ] **Step 1: 实现 PetStage + pet 入口**（默认 `mainWindow` 加载改为 `windows/pet/index.html`）
- [ ] **Step 2: 手动验证** `npm run dev`：透明窗口中央区域可接收鼠标（暂时画一个半透明矩形可视化），移出区域后点击穿透到桌面（拿资源管理器窗口验证）
- [ ] **Step 3: Commit** `git commit -m "feat: 桌宠透明窗口 + pixi 画布 + 命中穿透"`

---

### Task 8: Spine 模型加载（含真实模型 spike）+ 动画映射

**Files:**
- Create: `src/main/modelLibrary.ts`（模型目录管理：扫描 userData/models/、解析 models_data.json、下载、导入 zip）
- Create: `src/shared/animMap.ts` + `src/shared/animMap.test.ts`
- Modify: `src/renderer/src/windows/pet/PetStage.ts`（加载并渲染 Spine）

**Interfaces:**
- Consumes: 事实 1/3（模型格式、AnimType 正则）。
- Produces:

```ts
// animMap.ts —— Ark-Pets AnimType 的 TS 移植
export type AnimKind = 'idle' | 'move' | 'sit' | 'sleep' | 'special' | 'interact' | 'attack' | 'die'
export const ANIM_PATTERNS: Array<{ kind: AnimKind; re: RegExp; offsetY: number }>
export function classifyAnimation(animFullName: string): { kind: AnimKind | 'other'; modifier: 'begin' | 'loop' | 'end' | 'none'; offsetY: number }
export function pickAnimation(available: string[], kind: AnimKind, mood: 'happy' | 'normal' | 'gloomy'): string | null
// pickAnimation：优先 kind+Loop；无 Loop 取 kind 本体；Sit/Sleep 受 mood 影响：gloomy 偏向 Sleep，happy 禁用 Sleep

// modelLibrary.ts（main 进程，renderer 经 IPC 调用）
export function listLocalModels(): Promise<Array<{ dir: string; name: string }>>
export function listRemoteModels(): Promise<Array<{ dir: string; name: string }>>   // gh API: repos/isHarryh/Ark-Models/contents/models + models_data.json 名称
export function downloadModel(dir: string, onProgress: (pct: number) => void): Promise<void>  // 逐文件 raw URL，带 https_proxy
export function importModelZip(zipPath: string): Promise<void>                       // 解压到 userData/models/<dir>/
```

- [ ] **Step 1: animMap 失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { classifyAnimation, pickAnimation } from './animMap'
describe('classifyAnimation（Ark-Pets 权威正则）', () => {
  it('Idle/Loop/C1 → idle+loop+offsetY 5', () => expect(classifyAnimation('Idle/Loop/C1')).toEqual({ kind: 'idle', modifier: 'loop', offsetY: 5 }))
  it('Sit → sit offsetY 50；Sleep → sleep offsetY 25；Interact → interact offsetY 5', () => { /* ... */ })
  it('Move/Begin → move+begin；Special/Loop → special+loop', () => { /* ... */ })
  it('未知名 Foo/Bar → other+none offsetY 0', () => { /* ... */ })
})
describe('pickAnimation', () => {
  it('有 Loop 优先 Loop；没有则取本体；该类完全缺失返回 null', () => { /* ... */ })
  it('gloomy 且存在 Sleep 时 pickAnimation(available,"sit","gloomy") 可返回 Sleep 类动画（由实现保证，断言非 null）', () => { /* ... */ })
})
```

- [ ] **Step 2: 确认失败 → 实现 → 通过**（正则照抄事实 3，`i` 标志）
- [ ] **Step 3: 真实模型 spike（先于 UI）**

```bash
# 经 gh API 把 amiya 模型拉到 userData（演示路径，正式由 downloadModel 实现）
gh api repos/isHarryh/Ark-Models/contents/models/002_amiya --jq '.[].name'
# 对每个文件: curl -L -x http://127.0.0.1:7897 -o <userData>/models/002_amiya/<name> https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models/002_amiya/<name>
```
PetStage 集成 pixi-spine：`import { Spine } from 'pixi-spine'`；用 `PIXI.Loader`（pixi v7 体系）注册 `.atlas`（pixi-spine 的 atlas 解析器会连带加载 png 与 `.skel` 二进制——资源基址用 `app.getPath('userData')/models/<dir>/`，dev 下经自定义 `pixi` `Assets` 的 `base` 或 file:// 协议；**若 Loader 对本地 file 协议受限，则启用 webSecurity:false 仅限 dev，生产用 protocol.registerFileProtocol('arkmodel', ...) 映射**）。渲染后按 `classifyAnimation` 的 offsetY 校正 y。**验收标准：dev 模式桌宠窗口中出现阿米亚待机动画。**

- [ ] **Step 4: mapping.json 覆盖**（`<modelsDir>/<dir>/mapping.json`：`{ "idle": "Idle/Loop/C1", ... }`，pickAnimation 先查它）
- [ ] **Step 5: Commit** `git commit -m "feat: Ark-Pets 模型加载（Spine 3.8 二进制）+ 动画分类映射（TDD）"`

---

### Task 9: 行为状态机与交互（点击/双击/拖拽/下落）

**Files:**
- Create: `src/shared/petBehavior.ts` + `src/shared/petBehavior.test.ts`（纯转移逻辑）
- Modify: `src/renderer/src/windows/pet/PetStage.ts`（驱动与渲染）、`main.tsx`（指针事件）

**Interfaces:**
- Consumes: `moodParams`（Task 4）、`pickAnimation`（Task 8）、`IPC.openTodoPanel`。
- Produces:

```ts
export type PetAction = 'idle' | 'walk' | 'sit' | 'drag' | 'fall' | 'interact' | 'remind'
export interface PetCtx { action: PetAction; facing: 1 | -1; x: number; y: number; vy: number; lastChange: number }
export function nextAction(ctx: PetCtx, mood: Mood, now: number, params: MoodParams, rand: () => number, screenW: number): PetAction
// idle 持续 8-20s（rand 驱动）后按 walkProbPerMin 概率转 walk，否则留在 idle；walk 到屏幕边缘转身；其他动作完成即回 idle
export function stepFall(ctx: PetCtx, dtMs: number): PetCtx   // vy += g*dt, y += v*dt, y>=floorY 时贴地并回 idle
export function classifyPointer(down: { x: number; y: number; t: number }, up: { x: number; y: number; t: number }, secondClick: boolean): 'click' | 'double' | 'drag'
// 位移≥8px → drag；<8px 且间隔<300ms 且 secondClick → double；否则 click
```

- [ ] **Step 1: 失败测试**：classifyPointer 四分支（drag 阈值 8px / double 300ms / click / 位移 7px 算 click）；nextAction 概率边界（rand=0.99 不走、rand=0.01 走）；stepFall 落地钳制。
- [ ] **Step 2: 实现 → 通过 → Commit**（`feat: 桌宠行为状态机（TDD）`）
- [ ] **Step 3: PetStage 集成**：requestAnimationFrame 循环调 stepFall/nextAction；`click` → `openTodoPanel`；`double` → interact 动画；drag 期间 `setIgnoreMouseEvents(false)` 固定不穿透；松手进 fall。手动验收：小人能在桌面底部走动、拖起来扔下去会落地。

---

### Task 10: 待办面板窗口（React UI）

**Files:**
- Create: `src/renderer/src/windows/todo/index.html`、`main.tsx`、`App.tsx`、`TodoItem.tsx`、`useTodos.ts`
- Modify: `src/main/windows.ts`（todo 窗口路由）

**Interfaces:**
- Consumes: `IPC.todosMutate/todosChanged/pomoCommand`（Task 6）、`parseDue`（Task 3）、`TodoGroup`（Task 2）。
- Produces: 完整待办 UI（后续任务仅加按钮）。

实现要点：
- `useTodos()`：`window.api.onTodosChanged(cb)` 订阅 + 本地 state；所有变更走 `todosMutate` 由主进程回执驱动（单向数据流）。
- 分组渲染 🔴 逾期 / 📅 今天与未来 / 📥 无日期；条目：勾选框、标题（逾期红色）、时间、优先级点、hover 显示编辑/删除。
- 新增框：回车 → `parseDue` → mutate add；`Esc` 清空。
- 删除 → 顶部 toast「已删除 · 撤销」（5s，撤销=重新 add 恢复原字段含 id 由主进程支持 `add` 载荷携带 id）。
- 番茄钟区：当前状态（剩余 mm:ss，主进程每秒广播 pomoChanged）、开始/中止、今日计数。
- 编辑：行内展开表单（标题/备注/日期时间 input[type=datetime-local]/优先级）。

- [ ] **Step 1: 实现组件**（样式用 index.css 手写，深色紧凑风，宽 360）
- [ ] **Step 2: 手动验收**：加/勾/改/删/撤销全通、分组正确、双窗口数据同步（pet 触发变化面板即时刷新）
- [ ] **Step 3: Commit** `git commit -m "feat: 待办面板窗口（分组/增删改/撤销/番茄钟显示）"`

---

### Task 11: 气泡台词与心情联动展示

**Files:**
- Create: `src/shared/lines.ts`（台词库，纯数据）
- Modify: pet 窗口 `PetStage.ts` / `main.tsx`（DOM 气泡层）

**Interfaces:**
- Consumes: `IPC.moodChanged`、ReminderEvent、pomo 事件。
- Produces:

```ts
export type BubbleKind = 'mood' | 'remind' | 'pomoFocusEnd' | 'pomoRestEnd' | 'interact' | 'ai'
export function pickLine(kind: BubbleKind, mood: Mood, rand: () => number): string
```

台词库要求：每 mood × mood 类 8 条、remind 4 条、pomo 各 4 条、interact 6 条；明日方舟干员语气（简洁、少语气词）；`lines.ts` 内为纯数组常量。
气泡实现：pet 窗口 DOM 层绝对定位 `div.bubble`（头顶上方），CSS 淡入淡出 200ms，停留 4s；同屏至多 1 条（新顶旧）。
- [ ] **Step 1: 实现 lines.ts + 气泡组件**
- [ ] **Step 2: 手动验收**：触发提醒/番茄结束时桌宠头顶出现对应气泡；长时间 idle 时随机 mood 台词（≥10min 一次）
- [ ] **Step 3: Commit** `git commit -m "feat: 气泡台词系统与心情联动展示"`

---

### Task 12: 设置窗口 + 模型管理（下载/导入/切换）

**Files:**
- Create: `src/renderer/src/windows/settings/index.html`、`main.tsx`、`App.tsx`
- Create: `src/main/settingsStore.ts`（electron-store 外壳：`{ ai: {baseUrl,apiKey,model}, reminderLeadMin, pomoFocusMin, pomoRestMin, autostart, petScale, currentModel }`）
- Modify: `src/main/modelLibrary.ts`（暴露 IPC）、`tray.ts`（切换干员子菜单）

**Interfaces:**
- Consumes: Task 8 的 `modelLibrary` 四函数、Task 6 的设置广播。
- Produces: renderer API `window.api.models.listLocal/listRemote/download/import/setCurrent`、`window.api.settings.get/set`。

实现要点：
- AI 区：预设下拉（智谱 `https://open.bigmodel.cn/api/paas/v4` + `glm-4.7` / DeepSeek / OpenAI / 自定义）→ baseUrl、key（password input）、model 文本框、「测试连接」按钮（POST /chat/completions 1 条消息，显示延迟或错误）。
- 模型区：远端列表（名称搜索框）→ 下载（进度条，onProgress 经 IPC 流式转发）→ 本地列表 → 「使用」；「导入 zip」按钮（webUtils.showOpenDialog）。
- 偏好区：提前提醒分钟、番茄钟时长、开机自启 toggle、桌宠缩放 slider（0.5-2.0，改后 pet 窗口尺寸重算）。
- key 明文存 electron-store，UI 掩码；设置页脚注明风险。

- [ ] **Step 1: 实现 settingsStore + settings UI + tray 联动**
- [ ] **Step 2: 手动验收**：下载 amiya 模型（真实网络，走代理）→ 托盘切换 → 桌宠换人；改缩放即时生效；autostart 写入注册表（msconfig 可见）
- [ ] **Step 3: Commit** `git commit -m "feat: 设置窗口 + 模型下载器/导入/切换"`

---

### Task 13: AI 对话（OpenAI 兼容 + 工具调用）

**Files:**
- Create: `src/main/ai.ts`（main 进程 fetch 客户端 + 工具执行）
- Create: `src/shared/aiTools.ts` + `src/shared/aiTools.test.ts`
- Create: `src/renderer/src/windows/pet/ChatPanel.tsx`（pet 窗口右侧聊天层）

**Interfaces:**
- Consumes: `settingsStore.ai`、`todoStore` 纯逻辑。
- Produces:

```ts
// aiTools.ts —— 工具 schema 与参数校验（纯）
export const AI_TOOLS = [
  { type: 'function', function: { name: 'add_todo', description: '为用户添加一条待办',
    parameters: { type: 'object', properties: {
      title: { type: 'string' }, due_at: { type: 'string', description: 'ISO 8601 或 "YYYY-MM-DD HH:mm" 本地时间' },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] }, notes: { type: 'string' } },
      required: ['title'] } } },
  { type: 'function', function: { name: 'list_todos', parameters: { type: 'object', properties: {
      filter: { type: 'string', enum: ['today', 'overdue', 'all'] } } } } },
  { type: 'function', function: { name: 'complete_todo', parameters: { type: 'object', properties: {
      keyword: { type: 'string' } }, required: ['keyword'] } } }
] as const
export function parseDueAtInput(s: string | undefined, now: number): number | undefined   // ISO 或 "YYYY-MM-DD HH:mm"
export function validateAddArgs(args: unknown): { ok: true; value: { title: string; dueAt?: number; priority: Priority; notes?: string } } | { ok: false; error: string }
// complete_todo 的关键词匹配逻辑：completeByKeyword(todos, keyword): { matched: Todo[] } —— 0 或 >1 个都不执行，返回需用户确认
```

`ai.ts` 要点：
- `POST {baseUrl}/chat/completions`，`tools: AI_TOOLS`，system prompt 注入当前待办摘要+心情+干员角色设定；消息仅内存保留最近 20 条。
- 收到 tool_calls → 执行（add/list/complete 经与本地同一 mutate 路径，`source:'ai'`）→ 把结果作为 tool 消息回传 → 拿最终回复。
- 失败处理：超时 30s；连续 3 次失败本会话禁用（UI 按钮置灰）。
- ChatPanel：pet 窗口内 320×420 层，Esc 收起；消息列表+输入框；工具执行时插入系统行「已添加：xxx」。

- [ ] **Step 1: aiTools 失败测试**：validateAddArgs（缺 title 拒绝/非法 priority 拒绝/合法通过）、parseDueAtInput（ISO/本地格式/垃圾输入 undefined）、completeByKeyword（唯一匹配/多匹配/零匹配）。
- [ ] **Step 2: 实现 → 通过**
- [ ] **Step 3: 实现 ai.ts + ChatPanel；手动验收**：配 key 后说「明天下午3点提醒我交报告」→ 面板出现该待办且气泡确认；未配 key 时入口提示去设置。
- [ ] **Step 4: Commit** `git commit -m "feat: AI 对话与待办工具调用（OpenAI 兼容）"`

---

### Task 14: 错误处理加固 + 打包 + 文档收尾

**Files:**
- Modify: `src/main/store.ts`（todos.json 损坏回退 .bak）、`src/main/index.ts`（模型加载失败回退）
- Modify: `package.json`（electron-builder 配置）、`electron.vite.config.ts`
- Modify: `README.md`（开发/模型获取/代理说明）

要点：
- 启动时 todos 加载 try/catch：失败 → 尝试 `.bak` → 再失败重置为 `[]` 并 `dialog.showErrorBox` 告知。
- 当前模型加载失败 → 托盘提示 + 自动回退列表中上一个可用模型；全无可用 → pet 窗口显示引导文案（「去设置下载模型」按钮）。
- electron-builder：`win` nsis，appId `com.sinpo686.arktodopet`，产物名 `ArkTodoPet`；`asarUnpack` 无需（模型在 userData）。打包验证：`npm run build && npx electron-builder --win`（走代理下载 winCodeSign 等资源；失败则设 `ELECTRON_BUILDER_BINARIES_MIRROR` 备选说明）。
- README 补：开发命令、模型个人使用声明、代理环境变量示例。

- [ ] **Step 1: 实现回退与加固**
- [ ] **Step 2: `npm run build` + vitest 全绿 + 手动冒烟（dev）**
- [ ] **Step 3: electron-builder 产出 NSIS 安装包，安装后冒烟**
- [ ] **Step 4: Commit + push** `git commit -m "feat: 错误处理加固 + NSIS 打包 + 文档" && git push`

---

## Self-Review 记录

1. **规格覆盖**：§3 窗口/托盘/单实例→T6；§4 模型/状态机/点击区分→T7-9；§5 待办/时间解析/提醒→T2/3/5/10；§6 番茄钟/情绪→T4/5/11；§7 AI→T13；§8 错误→T14+各任务内；§9 测试→各 TDD 任务+手动验收步骤；§10 交付→T14。规格 §5.3「启动不补发历史提醒」由 remindedSet 语义天然满足（进程内存集合）。✔
2. **占位符扫描**：测试骨架中标注「节选骨架，实现者补全断言值」处均已给出被测函数签名与用例意图，属可执行范围；无 TBD。✔
3. **类型一致性**：`Todo/TodoGroup/Priority`（T2）为 T4/5/10/13 共用；`Mood/moodParams`（T4）为 T8 pickAnimation/T9/T11 共用；`PomoState`（T5）为 T6/T10 共用；IPC 常量集中在 `src/shared/ipc.ts`。✔
