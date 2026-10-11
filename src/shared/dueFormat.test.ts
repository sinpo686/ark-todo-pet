import { describe, expect, it } from 'vitest'
import { datetimeLocalToTs, formatDue, formatRemain, tsToDatetimeLocal } from './dueFormat'

const ts = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo - 1, d, h, mi).getTime()

describe('formatDue（本地时区友好文案）', () => {
  const now = ts(2026, 10, 10, 12, 0)

  it('同一天 → 今天 HH:mm', () => {
    expect(formatDue(ts(2026, 10, 10, 23, 5), now)).toBe('今天 23:05')
    expect(formatDue(ts(2026, 10, 10, 0, 0), now)).toBe('今天 00:00')
  })

  it('次日 / 前一日 → 明天 / 昨天', () => {
    expect(formatDue(ts(2026, 10, 11, 9, 30), now)).toBe('明天 09:30')
    expect(formatDue(ts(2026, 10, 9, 18, 0), now)).toBe('昨天 18:00')
  })

  it('跨月边界（10-31 → 11-01 相差一天）', () => {
    expect(formatDue(ts(2026, 10, 31, 23, 59), ts(2026, 10, 31, 12, 0))).toBe('今天 23:59')
    expect(formatDue(ts(2026, 11, 1, 0, 1), ts(2026, 10, 31, 23, 59))).toBe('明天 00:01')
  })

  it('同年更远日期 → M月D日 HH:mm（不补零）', () => {
    expect(formatDue(ts(2026, 12, 1, 8, 30), now)).toBe('12月1日 08:30')
    expect(formatDue(ts(2026, 3, 2, 10, 0), now)).toBe('3月2日 10:00')
  })

  it('跨年 → 带年份', () => {
    expect(formatDue(ts(2027, 1, 2, 10, 0), now)).toBe('2027年1月2日 10:00')
    expect(formatDue(ts(2025, 12, 31, 22, 0), now)).toBe('2025年12月31日 22:00')
  })
})

describe('tsToDatetimeLocal / datetimeLocalToTs 互转（本地时区）', () => {
  it('往返一致', () => {
    const t = ts(2026, 10, 10, 9, 5)
    expect(tsToDatetimeLocal(t)).toBe('2026-10-10T09:05')
    expect(datetimeLocalToTs('2026-10-10T09:05')).toBe(t)
  })

  it('带秒的值截断到分钟（datetime-local 无秒档）', () => {
    expect(datetimeLocalToTs('2026-10-10T09:05:30')).toBe(ts(2026, 10, 10, 9, 5))
  })

  it('空串 / 格式非法 → undefined', () => {
    expect(datetimeLocalToTs('')).toBeUndefined()
    expect(datetimeLocalToTs('abc')).toBeUndefined()
    expect(datetimeLocalToTs('2026/10/10 09:05')).toBeUndefined()
  })

  it('溢出日期（2 月 30 日 / 32 日 / 25 点）→ undefined', () => {
    expect(datetimeLocalToTs('2026-02-30T10:00')).toBeUndefined()
    expect(datetimeLocalToTs('2026-10-32T10:00')).toBeUndefined()
    expect(datetimeLocalToTs('2026-10-10T25:00')).toBeUndefined()
  })
})

describe('formatRemain（mm:ss 倒计时）', () => {
  it('整分与常规值', () => {
    expect(formatRemain(25 * 60_000)).toBe('25:00')
    expect(formatRemain(61_000)).toBe('01:01')
  })

  it('向上取整到秒，负数归零', () => {
    expect(formatRemain(59_999)).toBe('01:00')
    expect(formatRemain(1)).toBe('00:01')
    expect(formatRemain(0)).toBe('00:00')
    expect(formatRemain(-5_000)).toBe('00:00')
  })
})
