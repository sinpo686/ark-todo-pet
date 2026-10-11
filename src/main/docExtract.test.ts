/** docExtract 测试：txt 直读 + 最小合法 PDF 文字提取 + 截断 + 不支持格式。docx 走 mammoth（成熟库，不造二进制 fixture）。 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { extractTextFromFile, ATTACH_MAX_CHARS } from './docExtract'

const TMP = join(__dirname, '.docExtract-fixtures')

/** 手工构造的最小合法单页 PDF（Content Stream 内含两条 Tj 文本） */
function minimalPdf(): Buffer {
  const text = 'BT /F1 12 Tf 72 720 Td (Task A: submit report by 15:00 tomorrow) Tj 0 -20 Td (Task B: buy supplies) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

beforeAll(() => {
  mkdirSync(TMP, { recursive: true })
  writeFileSync(join(TMP, 'note.txt'), '明天下午3点交报告\n采购物资\n', 'utf8')
  writeFileSync(join(TMP, 'doc.pdf'), minimalPdf())
})

describe('extractTextFromFile', () => {
  it('txt 直读 utf8', async () => {
    const r = await extractTextFromFile(join(TMP, 'note.txt'))
    expect(r.ok).toBe(true)
    expect(r.text).toContain('明天下午3点交报告')
    expect(r.truncated).toBe(false)
  })

  it('最小 PDF 提取两条文本', async () => {
    const r = await extractTextFromFile(join(TMP, 'doc.pdf'))
    expect(r.ok).toBe(true)
    expect(r.text).toContain('submit report by 15:00')
    expect(r.text).toContain('buy supplies')
  })

  it('超长文本截断并标记', async () => {
    writeFileSync(join(TMP, 'big.txt'), 'a'.repeat(ATTACH_MAX_CHARS + 500), 'utf8')
    const r = await extractTextFromFile(join(TMP, 'big.txt'))
    expect(r.ok).toBe(true)
    expect(r.truncated).toBe(true)
    expect(r.text.length).toBe(ATTACH_MAX_CHARS)
  })

  it('不支持格式明确报错', async () => {
    const r = await extractTextFromFile(join(TMP, 'nope.exe'))
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不支持的格式')
  })
})

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true })
})


