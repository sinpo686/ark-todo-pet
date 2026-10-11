/** 待办面板时间展示与 datetime-local 互转（纯函数，全程本地时区；渲染层与测试共用，无 IO）。 */

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 当天 00:00 的时间戳（本地时区） */
function startOfDay(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * 截止时间友好文案：今天 HH:mm / 明天 HH:mm / 昨天 HH:mm / M月D日 HH:mm（跨年带年份）。
 * 「已逾期」的判定与红色样式由渲染层负责（isOverdue），此函数只管日期文案。
 */
export function formatDue(dueAt: number, now: number): string {
  const d = new Date(dueAt)
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const days = Math.round((startOfDay(dueAt) - startOfDay(now)) / 86_400_000)
  if (days === 0) return `今天 ${hm}`
  if (days === 1) return `明天 ${hm}`
  if (days === -1) return `昨天 ${hm}`
  if (d.getFullYear() !== new Date(now).getFullYear()) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  }
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

/** 时间戳 → input[type=datetime-local] 的值（YYYY-MM-DDTHH:mm，本地时区，不带秒） */
export function tsToDatetimeLocal(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const RE_DT_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/**
 * datetime-local 的值 → 时间戳（按本地时区解析，秒被丢弃）。
 * 空串 / 格式非法 / 溢出日期（如 2 月 30 日、25 点）→ undefined。
 */
export function datetimeLocalToTs(value: string): number | undefined {
  const m = RE_DT_LOCAL.exec(value)
  if (!m) return undefined
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])]
  const date = new Date(y, mo - 1, d, h, mi)
  // Date 会自动进位（2026-02-30 → 3 月 2 日）：组件回读不一致即视为非法输入
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== mo - 1 ||
    date.getDate() !== d ||
    date.getHours() !== h ||
    date.getMinutes() !== mi
  ) {
    return undefined
  }
  return date.getTime()
}

/** 剩余毫秒 → mm:ss（向上取整到秒；负数按 0 计） */
export function formatRemain(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`
}
