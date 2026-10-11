/**
 * 文档文本提取（纯 Node，无 electron 依赖，可单测）：
 * .txt/.md 直读；.pdf 走 pdfjs-dist legacy（Node 环境，无 worker）；
 * .docx 走 mammoth（提取正文纯文本）。扫描版 PDF 无文字层会得到空文本。
 */

import { promises as fs } from 'fs'
import * as path from 'path'

/** 附件注入上下文的字数上限（防超模型上下文；超出截断并注明） */
export const ATTACH_MAX_CHARS = 30_000

export interface ExtractResult {
  ok: boolean
  /** 源文件名（展示用） */
  name: string
  /** 提取的文本（成功时）；ok=false 时为空 */
  text: string
  /** 是否被截断 */
  truncated: boolean
  error?: string
}

async function extractPdf(buf: Buffer): Promise<string> {
  // 动态 import：legacy 构建面向 Node（无 DOM/worker 依赖）
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf) })
  try {
    const doc = await loadingTask.promise
    const parts: string[] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if ('str' in item && item.str) parts.push(item.str)
      }
      parts.push('\n')
    }
    return parts.join(' ').replace(/[ \t]+/g, ' ').trim()
  } finally {
    await loadingTask.destroy()
  }
}

async function extractDocx(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const result = await mammoth.extractRawText({ buffer: buf })
  return result.value.trim()
}

export async function extractTextFromFile(fp: string): Promise<ExtractResult> {
  const name = path.basename(fp)
  const ext = path.extname(fp).toLowerCase()
  if (ext !== '.txt' && ext !== '.md' && ext !== '.pdf' && ext !== '.docx') {
    return { ok: false, name, text: '', truncated: false, error: `不支持的格式：${ext || '(无扩展名)'}（支持 pdf / docx / txt / md）` }
  }
  try {
    const buf = await fs.readFile(fp)
    let raw = ''
    if (ext === '.txt' || ext === '.md') {
      raw = buf.toString('utf8')
    } else if (ext === '.pdf') {
      raw = await extractPdf(buf)
      if (!raw) {
        return { ok: false, name, text: '', truncated: false, error: 'PDF 没有可提取的文字（可能是扫描件/图片型 PDF）' }
      }
    } else if (ext === '.docx') {
      raw = await extractDocx(buf)
    }
    const truncated = raw.length > ATTACH_MAX_CHARS
    return {
      ok: true,
      name,
      text: truncated ? raw.slice(0, ATTACH_MAX_CHARS) : raw,
      truncated
    }
  } catch (err) {
    return { ok: false, name, text: '', truncated: false, error: String(err) }
  }
}
