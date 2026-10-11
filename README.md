# 代办桌宠 (ArkTodoPet)

一个明日方舟风格的桌面宠物 + 待办清单应用：基建小人常驻桌面，**点击桌宠即可查看和管理待办**。

## 功能

- 🐹 **明日方舟干员桌宠** — Spine 骨骼动画，走路/坐下/戳一戳/拖拽，兼容 Ark-Pets 模型包
- ✅ **点击看待办** — 单击桌宠弹出待办面板：逾期/今天/无日期分组，增删改查
- ⏰ **截止提醒** — 系统通知 + 桌宠头顶气泡
- 🍅 **番茄钟** — 专注时干员坐下陪你，今日计数
- 💗 **情绪联动** — 待办堆积时无精打采，清空时开心活跃
- 🤖 **AI 增强（可选）** — 配置 OpenAI 兼容 API key 后可对话、口语化创建待办；不配置则全部本地功能照常

技术栈：Electron + React + TypeScript + pixi.js (pixi-spine) + electron-store。

## 安装与使用

```bash
# 方式一：安装包（推荐）
#   dist/ArkTodoPet-Setup-1.0.0.exe 双击安装（NSIS，可选目录、建桌面快捷方式）
# 方式二：免安装
#   dist/win-unpacked/ArkTodoPet.exe 直接运行
```

| 操作 | 效果 |
|------|------|
| 单击干员 | 打开待办面板（输入框支持「交报告 明天下午3点」自然语言） |
| 双击干员 | 戳一戳（头顶气泡回应） |
| 按住拖动 | 拖到哪停在哪（落点成为新的溜达高度，重启记忆） |
| 右键干员 | 「干员通讯」AI 聊天层（需先配 API key，见设置） |
| 托盘图标 | 切换干员 / 待办 / 设置 / 退出 |
| 待办面板右上角 ⚙ | 设置（模型下载/缩放 0.5–2.0×/开机自启/番茄钟时长/AI 配置） |

数据位置：`%APPDATA%/ark-todo-pet/`（todos.json 带自动轮换备份 .bak；models/ 为模型目录；settings.json 为设置）。

## 开发

```bash
npm install
npm run dev        # 开发调试
npm test           # vitest（122 项）
npm run typecheck
npm run build      # 生产构建（out/）
npx electron-builder --win   # 打 NSIS 安装包（dist/）
```

> 打包网络备注：electron-builder 的 nsis/7zip 资源包需可用的镜像或代理；本机方案是手动下载后经本地 HTTP 服务喂给 `ELECTRON_BUILDER_BINARIES_MIRROR`（详见仓库台账记录）。

## 致谢与参考 (Acknowledgements)

本项目站在以下优秀开源项目的肩膀上，特此说明各部分的参考来源：

| 参考项目 | 参考内容 | 本项目中的使用方式 |
|---------|---------|------------------|
| [Ark-Pets](https://github.com/isHarryh/Ark-Pets) (GPL-3.0) | 明日方舟桌宠的**模型格式兼容**（Spine 3.8 zip 包）、基建小人**行为状态机设计**（走路/坐下/躺下/戳一戳/随机基建动作）、拖拽与下落交互 | 参考 docs/CustomModel.md 的模型包结构做加载器；行为状态机重新实现（TypeScript，非移植代码） |
| [Ark-Models](https://github.com/isHarryh/Ark-Models) | 干员模型仓库，内置下载器的**数据来源** | 模型下载器直接拉取该仓库的模型列表与包 |
| [Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker) | 自定义模型提取工具 | 仅作为用户文档推荐，不集成代码 |
| [bongo-cat-next](https://github.com/liwenka1/bongo-cat-next) (MIT) | Electron 透明窗口 + Live2D 桌宠的**窗口工程实践**（穿透/置顶/托盘） | 参考窗口配置思路，代码独立实现 |
| [pixi-live2d-display 生态的窗口穿透方案](https://github.com/guansss/pixi-live2d-display) | `setIgnoreMouseEvents(true, {forward: true})` + 渲染层命中检测的**鼠标穿透模式** | 采用同一技术模式（社区通用做法） |

### 版权说明

- 明日方舟游戏资产（干员模型、形象）版权归属 **鹰角网络 (Hypergryph)**。本项目不分发任何游戏资产，用户通过 Ark-Models/Ark-Unpacker 自行获取，**仅供个人使用，禁止商用**。
- 本项目代码采用 MIT 协议（见 LICENSE）。

## 开发

```bash
npm install
npm run dev
```

> 注：Electron 二进制下载如遇网络问题，请配置代理（本项目开发环境使用 `http://127.0.0.1:7897`）。

## 文档

- [设计规格](docs/superpowers/specs/2026-10-10-desktop-pet-todo-design.md)
