import { describe, it, expect } from 'vitest'
import { parseDue } from './parseDue'
const base = new Date(2026, 9, 10, 10, 0) // 2026-10-10 10:00 周六

/** 2026 年 10 月某日某时刻的时间戳（本地时区） */
const ts = (day: number, h: number, mi = 0): number => new Date(2026, 9, day, h, mi).getTime()

describe('parseDue 模式覆盖', () => {
  it('"交报告 明天下午3点" → 明天15:00，标题"交报告"', () => {
    const r = parseDue('交报告 明天下午3点', base)
    expect(r.dueAt).toBe(new Date(2026, 9, 11, 15, 0).getTime())
    expect(r.cleanTitle).toBe('交报告')
  })

  it('今天晚上8:30 / 后天上午10点 / 2小时后 / 30分钟后 / 周一9点（下一个周一）', () => {
    expect(parseDue('今天晚上8:30', base).dueAt).toBe(ts(10, 20, 30)) // 今晚 20:30
    expect(parseDue('后天上午10点', base).dueAt).toBe(ts(12, 10)) // 10-12 10:00
    expect(parseDue('2小时后', base).dueAt).toBe(base.getTime() + 2 * 3600_000) // 12:00
    expect(parseDue('30分钟后', base).dueAt).toBe(base.getTime() + 30 * 60_000) // 10:30
    expect(parseDue('周一9点', base).dueAt).toBe(ts(12, 9)) // 下一个周一 = 10-12 09:00
  })

  it('"下午3点"（无日期）→ 今天的15:00，若已过则明天', () => {
    expect(parseDue('下午3点', base).dueAt).toBe(ts(10, 15)) // 10:00 时未过 → 今天 15:00
    const evening = new Date(2026, 9, 10, 16, 0)
    expect(parseDue('下午3点', evening).dueAt).toBe(ts(11, 15)) // 已过 → 明天 15:00
  })

  it('无时间词 → dueAt undefined，cleanTitle 原文', () => {
    const r = parseDue('纯标题', base)
    expect(r.dueAt).toBeUndefined()
    expect(r.cleanTitle).toBe('纯标题')
  })
})

describe('parseDue 易错点与边界', () => {
  it('下午/晚上统一 +12，结果 ≥24 时回退：下午8点=20点、下午12点=12点', () => {
    expect(parseDue('下午8点', base).dueAt).toBe(ts(10, 20))
    expect(parseDue('下午12点', base).dueAt).toBe(ts(10, 12))
  })

  it('中午：中午12点=12点、中午1点=13点', () => {
    expect(parseDue('中午12点', base).dueAt).toBe(ts(10, 12))
    expect(parseDue('中午1点', base).dueAt).toBe(ts(10, 13))
  })

  it('晚上11点半=23:30；晚上12点=次日00:00（午夜而非正午）', () => {
    expect(parseDue('晚上11点半', base).dueAt).toBe(ts(10, 23, 30))
    expect(parseDue('晚上12点', base).dueAt).toBe(ts(11, 0, 0))
  })

  it('时刻格式：3点25 / 3:25 / 3：25（全角冒号）/ 3点25分 / 3点半', () => {
    expect(parseDue('明天3点25', base).dueAt).toBe(ts(11, 3, 25))
    expect(parseDue('明天3:25', base).dueAt).toBe(ts(11, 3, 25))
    expect(parseDue('明天3：25', base).dueAt).toBe(ts(11, 3, 25))
    expect(parseDue('明天3点25分', base).dueAt).toBe(ts(11, 3, 25))
    expect(parseDue('后天下午3点半', base).dueAt).toBe(ts(12, 15, 30))
  })

  it('周X：等于今天 → +7 天；未来周X → 本周内该天；周五晚上6点半', () => {
    expect(parseDue('周六9点', base).dueAt).toBe(ts(17, 9)) // 今天周六 → 下周六 10-17
    expect(parseDue('周日8点', base).dueAt).toBe(ts(11, 8)) // 明天周日 10-11
    expect(parseDue('周五晚上6点半', base).dueAt).toBe(ts(16, 18, 30)) // 10-16 周五
  })

  it('大后天：大后天晚上8点 = 10-13 20:00', () => {
    expect(parseDue('大后天晚上8点', base).dueAt).toBe(ts(13, 20))
  })

  it('相对时间精确到分：2.5小时后 = +150 分钟；45分后', () => {
    expect(parseDue('2.5小时后', base).dueAt).toBe(base.getTime() + 150 * 60_000)
    expect(parseDue('45分后', base).dueAt).toBe(base.getTime() + 45 * 60_000)
  })

  it('cleanTitle：时间词在句首/句中、多余空格清理', () => {
    expect(parseDue('明天下午3点 交报告', base).cleanTitle).toBe('交报告')
    expect(parseDue('交报告  明天下午3点', base).cleanTitle).toBe('交报告')
    expect(parseDue('交报告 明天 下午3点', base).cleanTitle).toBe('交报告')
  })

  it('显式"今天"即使时刻已过也不顺延（与无日期分支区分）', () => {
    const evening = new Date(2026, 9, 10, 16, 0)
    expect(parseDue('今天下午3点', evening).dueAt).toBe(ts(10, 15))
  })

  it('只有日期词无时刻 → 解析失败，原文返回', () => {
    const r = parseDue('明天交', base)
    expect(r.dueAt).toBeUndefined()
    expect(r.cleanTitle).toBe('明天交')
  })

  it('非法时刻（小时 > 23）→ 解析失败', () => {
    const r = parseDue('冲到99点', base)
    expect(r.dueAt).toBeUndefined()
    expect(r.cleanTitle).toBe('冲到99点')
  })

  it('失败分支同样 trim 首尾空白', () => {
    const r = parseDue('  纯标题  ', base)
    expect(r.dueAt).toBeUndefined()
    expect(r.cleanTitle).toBe('纯标题')
  })
})
