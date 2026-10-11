/**
 * 模型库（主进程）：Ark-Models（isHarryh/Ark-Models，Spine 3.8 二进制）的
 * 本地扫描 / 远端列表 / 下载 / zip 导入，以及 arkmodel:// 本地文件协议。
 *
 * 网络策略（api.github.com 本机直连可达；raw.githubusercontent.com 直连被阻断、
 * 经 127.0.0.1:7897 代理可达，且 Windows 系统代理指向该端口）：
 *   fetchBuffer 依次尝试 electron net.fetch（Chromium 栈，自动走系统代理）→
 *   Node https 直连 → Node https 经 CONNECT 隧道上代理，循环 3 轮（直连/代理交替各 3 次）。
 *
 * gh CLI 仅供 spike 命令行验证，运行时不依赖（主进程无 gh 可用性保证）。
 */

import { app, ipcMain, net, protocol } from 'electron'
import { promises as fs } from 'fs'
import * as path from 'path'
import * as http from 'http'
import * as https from 'https'
import * as tls from 'tls'
import { pathToFileURL } from 'url'
import yauzl from 'yauzl'
import { IPC } from '../shared/ipc'
import type { ModelEntry } from '../shared/ipc'

const REPO = 'isHarryh/Ark-Models'
const BRANCH = 'main'
const CONTENTS_API = `https://api.github.com/repos/${REPO}/contents/models`
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`
/** 仓库索引：dir → 中文名 / 资产文件名映射（~2MB，落地缓存到 models/ 供离线查名） */
const INDEX_URL = `${RAW_BASE}/models_data.json`

const USER_AGENT = 'ark-todo-pet/1.0 (Electron; modelLibrary)'
const FETCH_TIMEOUT_MS = 20_000
const PROXY = { host: '127.0.0.1', port: 7897 }
/** 直连/代理交替重试轮数（每轮 3 种策略各一次） */
const RETRY_ROUNDS = 3

// ---------- 目录 ----------

/** 模型根目录 userData/models/（惰性创建） */
export async function modelsRoot(): Promise<string> {
  const root = path.join(app.getPath('userData'), 'models')
  await fs.mkdir(root, { recursive: true })
  return root
}

// ---------- 带兜底的 HTTP 抓取 ----------

interface BodyAttempt {
  name: string
  run: (url: string) => Promise<Buffer>
}

function collectBody(res: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    res.on('data', (c: Buffer) => chunks.push(c))
    res.on('end', () => resolve(Buffer.concat(chunks)))
    res.on('error', reject)
  })
}

/** 策略一：Electron net.fetch —— Chromium 网络栈，系统代理开启时自动走代理 */
async function fetchViaElectronNet(url: string): Promise<Buffer> {
  const res = await net.fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`net.fetch HTTP ${res.status} ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

/** 策略二：Node https 直连 */
function fetchViaNodeDirect(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': USER_AGENT }, timeout: FETCH_TIMEOUT_MS },
      (res) => {
        const { statusCode = 0 } = res
        if (statusCode < 200 || statusCode >= 300) {
          res.resume()
          reject(new Error(`direct HTTP ${statusCode} ${url}`))
          return
        }
        collectBody(res).then(resolve, reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error(`direct timeout ${url}`)))
    req.on('error', reject)
  })
}

/** 策略三：Node https 经 HTTP CONNECT 隧道上代理（系统代理关闭时的显式代理路径） */
function fetchViaProxyTunnel(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const port = u.port ? Number(u.port) : 443
    const connectReq = http.request({
      host: PROXY.host,
      port: PROXY.port,
      method: 'CONNECT',
      path: `${u.hostname}:${port}`,
      timeout: FETCH_TIMEOUT_MS
    })
    connectReq.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy()
        reject(new Error(`CONNECT ${res.statusCode} via ${PROXY.host}:${PROXY.port}`))
        return
      }
      const tlsSock = tls.connect({ socket, servername: u.hostname }, () => {
        const getter = https.get(url, {
          headers: { 'User-Agent': USER_AGENT },
          timeout: FETCH_TIMEOUT_MS,
          agent: false,
          createConnection: (): tls.TLSSocket => tlsSock
        })
        getter.on('response', (r) => {
          const { statusCode = 0 } = r
          if (statusCode < 200 || statusCode >= 300) {
            r.resume()
            reject(new Error(`tunnel HTTP ${statusCode} ${url}`))
            return
          }
          collectBody(r).then(resolve, reject)
        })
        getter.on('timeout', () => getter.destroy(new Error(`tunnel timeout ${url}`)))
        getter.on('error', reject)
      })
      tlsSock.on('error', reject)
    })
    connectReq.on('timeout', () => connectReq.destroy(new Error(`CONNECT timeout ${url}`)))
    connectReq.on('error', reject)
    connectReq.end()
  })
}

/** 多策略抓取 Buffer：electron-net / 直连 / 代理隧道 × RETRY_ROUNDS 轮 */
export async function fetchBuffer(url: string): Promise<Buffer> {
  const attempts: BodyAttempt[] = [
    { name: 'net.fetch', run: fetchViaElectronNet },
    { name: 'direct', run: fetchViaNodeDirect },
    { name: 'proxy-tunnel', run: fetchViaProxyTunnel }
  ]
  let lastErr: unknown = null
  for (let round = 0; round < RETRY_ROUNDS; round++) {
    for (const a of attempts) {
      try {
        return await a.run(url)
      } catch (err) {
        lastErr = err
        console.warn(`[modelLibrary] ${a.name} 第 ${round + 1} 次失败: ${String(err)}`)
        await new Promise((r) => setTimeout(r, 400))
      }
    }
  }
  throw new Error(`全部下载策略失败 ${url}: ${String(lastErr)}`)
}

async function fetchText(url: string): Promise<string> {
  return (await fetchBuffer(url)).toString('utf8')
}

// ---------- 仓库索引（models_data.json） ----------

interface RepoIndexEntry {
  name?: string
  type?: string
  assetList?: Record<string, string>
}
interface RepoIndex {
  storageDirectory?: Record<string, string>
  data?: Record<string, RepoIndexEntry>
}

let indexCache: RepoIndex | null = null

async function loadRepoIndex(force = false): Promise<RepoIndex> {
  if (!force && indexCache) return indexCache
  const root = await modelsRoot()
  const cacheFile = path.join(root, 'models_data.json')
  // 网络优先（保证新鲜）；失败回落磁盘缓存
  try {
    const text = await fetchText(INDEX_URL)
    indexCache = JSON.parse(text) as RepoIndex
    await fs.writeFile(cacheFile, text, 'utf8')
    return indexCache
  } catch (err) {
    console.warn(`[modelLibrary] 拉取 models_data.json 失败，回落本地缓存: ${String(err)}`)
    try {
      indexCache = JSON.parse(await fs.readFile(cacheFile, 'utf8')) as RepoIndex
      return indexCache
    } catch {
      return { data: {} }
    }
  }
}

// ---------- 对外：本地列表 / 远端列表 / 下载 / zip 导入 ----------

/** 扫描 userData/models/ 下的各模型目录：目录名 + 中文名（_meta.json → models_data.json → 目录名）+ skel 文件名 */
export async function listLocalModels(): Promise<ModelEntry[]> {
  const root = await modelsRoot()
  const dirents = await fs.readdir(root, { withFileTypes: true })
  const dirs = dirents
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  const index = await loadRepoIndex().catch((): RepoIndex => ({ data: {} }))
  const out: ModelEntry[] = []
  for (const dir of dirs) {
    const modelDir = path.join(root, dir)
    let name = dir
    try {
      const meta = JSON.parse(await fs.readFile(path.join(modelDir, '_meta.json'), 'utf8')) as {
        name?: string
      }
      if (meta.name) name = meta.name
    } catch {
      const fromIndex = index.data?.[dir]?.name
      if (fromIndex) name = fromIndex
    }
    const files = (await fs.readdir(modelDir))
      .filter((f) => f.toLowerCase().endsWith('.skel'))
      .sort()
    // mapping.json：人工指定 AnimKind → 动画全名（优先于正则启发式）
    let mapping: Partial<Record<string, string>> | undefined
    try {
      mapping = JSON.parse(await fs.readFile(path.join(modelDir, 'mapping.json'), 'utf8')) as Partial<
        Record<string, string>
      >
    } catch {
      /* 无 mapping.json 属常态 */
    }
    const entry: ModelEntry =
      files.length > 0 ? { dir, name, skel: files[0] } : { dir, name }
    if (mapping) entry.mapping = mapping
    out.push(entry)
  }
  return out
}

interface GhContentEntry {
  name: string
  type: string
  download_url?: string | null
}

/** contents API 分页列 models/ 下条目（per_page 上限 1000） */
async function listContentsApiDir(subpath: string): Promise<GhContentEntry[]> {
  const out: GhContentEntry[] = []
  for (let page = 1; page <= 10; page++) {
    const url = `${CONTENTS_API}${subpath}?per_page=1000&page=${page}&ref=${BRANCH}`
    const list = JSON.parse(await fetchText(url)) as GhContentEntry[]
    if (!Array.isArray(list)) throw new Error(`contents API 返回非数组: ${url}`)
    out.push(...list)
    if (list.length < 1000) break
  }
  return out
}

/** 远端可用模型：contents API 枚举 models/ 目录 × 索引中文名 */
export async function listRemoteModels(): Promise<ModelEntry[]> {
  const [entries, index] = await Promise.all([listContentsApiDir(''), loadRepoIndex(true)])
  return entries
    .filter((e) => e.type === 'dir')
    .map((e) => ({ dir: e.name, name: index.data?.[e.name]?.name ?? e.name }))
}

/** 下载模型到 userData/models/<dir>/（逐文件 raw URL，进度回调 0-100） */
export async function downloadModel(
  dir: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  if (!/^[\w.#-]+$/.test(dir)) throw new Error(`非法模型目录名: ${dir}`)
  const files = (await listContentsApiDir(`/${encodeURIComponent(dir)}`)).filter(
    (e) => e.type === 'file'
  )
  if (files.length === 0) throw new Error(`远端目录无文件: ${dir}`)
  const root = await modelsRoot()
  const destDir = path.join(root, dir)
  await fs.mkdir(destDir, { recursive: true })
  let done = 0
  for (const f of files) {
    const rawUrl =
      f.download_url ??
      `${RAW_BASE}/models/${encodeURIComponent(dir)}/${encodeURIComponent(f.name)}`
    const buf = await fetchBuffer(rawUrl)
    await fs.writeFile(path.join(destDir, f.name), buf)
    done++
    onProgress?.(Math.round((done / files.length) * 100))
  }
  // 落 _meta.json（中文名），失败不阻断下载结果
  try {
    const index = await loadRepoIndex()
    const name = index.data?.[dir]?.name ?? dir
    await fs.writeFile(path.join(destDir, '_meta.json'), JSON.stringify({ dir, name }), 'utf8')
  } catch {
    /* 名称缓存缺失时 listLocalModels 回落目录名 */
  }
  console.log(`[modelLibrary] 模型 ${dir} 下载完成（${files.length} 文件）`)
}

/** 导入本地 zip（Ark-Pets 社区包）：解压到 userData/models/<dir>/，带穿越防护 */
export async function importModelZip(zipPath: string): Promise<void> {
  const zipfile = await yauzl.openPromise(zipPath, { autoClose: false })
  try {
    // 第一遍：收集原始 Entry（openReadStreamPromise 需要 Entry 实例本身）
    const entries: yauzl.Entry[] = []
    for await (const entry of zipfile.eachEntry()) entries.push(entry)
    const fileNameOf = (e: yauzl.Entry): string => String(e.fileName)
    const fileEntries = entries.filter((e) => !fileNameOf(e).endsWith('/'))
    if (fileEntries.length === 0) throw new Error('zip 内无文件')
    // 目标目录：所有条目共享唯一顶层目录时沿用之，否则用 zip 文件名
    const topDirs = new Set(
      fileEntries.map((e) => fileNameOf(e).split('/')[0]).filter((s) => s.length > 0)
    )
    let dirName: string
    let stripPrefix = ''
    if (topDirs.size === 1 && fileEntries.some((e) => fileNameOf(e).includes('/'))) {
      dirName = [...topDirs][0]
      stripPrefix = `${dirName}/`
    } else {
      dirName = path.basename(zipPath, path.extname(zipPath))
    }
    dirName = dirName.replace(/[^\w.#-]+/g, '_') || 'imported'
    const root = await modelsRoot()
    const destDir = path.join(root, dirName)
    await fs.mkdir(destDir, { recursive: true })

    for (const entry of entries) {
      let rel = fileNameOf(entry).replace(/\\/g, '/')
      if (stripPrefix && rel.startsWith(stripPrefix)) rel = rel.slice(stripPrefix.length)
      rel = rel.replace(/\/+$/, '')
      if (rel.length === 0) continue
      if (rel.split('/').some((seg) => seg === '..' || seg.length === 0)) {
        throw new Error(`zip 条目路径可疑，拒绝解压: ${fileNameOf(entry)}`)
      }
      const target = path.join(destDir, ...rel.split('/'))
      const relFromDest = path.relative(destDir, target)
      if (relFromDest.startsWith('..') || path.isAbsolute(relFromDest)) {
        throw new Error(`zip 条目越界，拒绝解压: ${fileNameOf(entry)}`)
      }
      if (fileNameOf(entry).endsWith('/')) {
        await fs.mkdir(target, { recursive: true })
        continue
      }
      await fs.mkdir(path.dirname(target), { recursive: true })
      const stream = await zipfile.openReadStreamPromise(entry)
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(chunk as Buffer)
      await fs.writeFile(target, Buffer.concat(chunks))
    }
    await fs.writeFile(
      path.join(destDir, '_meta.json'),
      JSON.stringify({ dir: dirName, name: dirName }),
      'utf8'
    )
    console.log(`[modelLibrary] zip 已导入 ${zipPath} -> ${destDir}`)
  } finally {
    zipfile.close()
  }
}

// ---------- arkmodel:// 协议（renderer 访问本地模型的统一通道，dev/prod 一致） ----------

/** app ready 前调用：注册特权 scheme（standard 才能被 URL 正确解析，supportFetchAPI 才能被 fetch） */
export function registerArkModelSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'arkmodel',
      // corsEnabled: true 让 scheme 进入 Chromium 的 fetch 协议白名单——否则渲染层
      // （dev 为 http 源）fetch arkmodel:// 会被 "Cross origin requests are only
      // supported for protocol schemes..." 直接拦截，handler 的 ACAO 头无机会生效
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true
      }
    }
  ])
}

function guessMime(fp: string): string {
  const ext = path.extname(fp).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.atlas') return 'text/plain; charset=utf-8'
  if (ext === '.json') return 'application/json'
  return 'application/octet-stream'
}

async function fileExists(fp: string): Promise<boolean> {
  try {
    await fs.access(fp)
    return true
  } catch {
    return false
  }
}

/** 把 arkmodel://m/<相对路径> 映射到 userData/models/<相对路径>；越界返回 null */
async function resolveArkModelPath(rel: string): Promise<string | null> {
  const root = await modelsRoot()
  const target = path.resolve(root, rel)
  const relFromRoot = path.relative(root, target)
  if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) return null
  return target
}

async function serveArkModelFile(fp: string): Promise<Response> {
  const res = await net.fetch(pathToFileURL(fp).toString())
  // renderer（dev 为 http 源）fetch arkmodel:// 属跨域，必须显式放行
  const headers = new Headers({
    'Content-Type': res.headers.get('content-type') ?? guessMime(fp),
    'Access-Control-Allow-Origin': '*'
  })
  return new Response(res.body, { status: res.status, headers })
}

/** app ready 后调用：挂 arkmodel:// 处理器 */
export function registerArkModelProtocol(): void {
  protocol.handle('arkmodel', async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('bad url', { status: 400 })
    }
    if (url.host !== 'm') return new Response('forbidden host', { status: 403 })
    const relDecoded = decodeURIComponent(url.pathname).replace(/^\//, '')
    const target = await resolveArkModelPath(relDecoded)
    if (!target) return new Response('forbidden', { status: 403 })
    if (await fileExists(target)) return serveArkModelFile(target)
    // 部分皮肤文件名含 '#'（如 build_char_xxx#4.png）：atlas 解析器拼接页面名时
    // '#' 会被当 fragment 剥离 —— 尝试用原始 URL 里的 '#' 之后的片段回拼一次
    const hashIdx = request.url.indexOf('#')
    if (hashIdx > 0) {
      const repaired = `${relDecoded}${request.url.slice(hashIdx)}`
      const target2 = await resolveArkModelPath(repaired)
      if (target2 && (await fileExists(target2))) return serveArkModelFile(target2)
    }
    return new Response(`not found: ${relDecoded}`, { status: 404 })
  })
  console.log('[modelLibrary] arkmodel:// 协议已挂载（仅限 userData/models/）')
}

// ---------- IPC（T12 前仅暴露 spike 验证所需的最小通道） ----------

export function registerModelIpc(): void {
  ipcMain.handle(IPC.modelsListLocal, () => listLocalModels())
}
