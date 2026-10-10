/**
 * 轻量自然语言截止时间解析（纯函数，零依赖，全程使用传入 now 的本地时区）。
 * 支持两类模式（按优先级尝试，命中即止，命中片段整段从标题剥掉）：
 *   1) 相对时间：2.5小时后 / 30分钟后 / 45分后（"个"可选）
 *   2) 绝对时间：[日期段]? [时段段]? 时刻（N点 / N点半 / N点M分 / N:M，全半角冒号）
 * 解析失败：dueAt 为 undefined，文本 trim 后原样返回。
 */

/** 周X 中文数字 → JS 星期值（0 = 周日） */
const WEEKDAY: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 0,
  天: 0
}
/** 相对日期词 → 天数偏移（注意"大后天"须排在"后天"之前由正则保证） */
const DAY_OFFSET: Record<string, number> = { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }

// 日期段(可选) + 时段段(可选) + 时刻(必选)；全半角冒号，"分"可选
const RE_ABS =
  /(?<day>今天|明天|后天|大后天|(?:周|星期|礼拜)(?<wd>[一二三四五六日天]))?\s*(?<period>凌晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里)?\s*(?<h>\d{1,2})\s*[点时：:]\s*(?<m>半|\d{1,2})?\s*分?/
// 相对时间：数字(可带小数) + 可选"个" + 单位 + "后"
const RE_REL = /(?<num>\d+(?:\.\d+)?)\s*个?\s*(?<unit>小时|分钟|分)后/

const at = (base: Date, addDays: number, h: number, m: number): number =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate() + addDays, h, m).getTime()

/** 从标题剥掉 [index, index+length) 片段，压缩残留连续空白并 trim */
function strip(text: string, index: number, length: number): string {
  return (text.slice(0, index) + text.slice(index + length)).replace(/\s{2,}/g, ' ').trim()
}

/** 从输入文本中解析截止时间；返回 { dueAt?, cleanTitle }。解析失败则 dueAt 为 undefined，文本原样返回。 */
export function parseDue(text: string, now: Date): { dueAt?: number; cleanTitle: string } {
  // 1) 相对时间优先：语义最无歧义
  const rel = RE_REL.exec(text)
  if (rel) {
    const n = parseFloat(rel.groups!.num)
    const minutes = rel.groups!.unit === '小时' ? n * 60 : n
    return {
      dueAt: now.getTime() + Math.round(minutes * 60_000),
      cleanTitle: strip(text, rel.index, rel[0].length)
    }
  }

  // 2) 绝对时间
  const m = RE_ABS.exec(text)
  if (!m || !m.groups) return { cleanTitle: text.trim() }
  const g = m.groups
  const h0 = parseInt(g.h, 10)
  const min = g.m === '半' ? 30 : g.m ? parseInt(g.m, 10) : 0
  if (h0 > 23 || min > 59) return { cleanTitle: text.trim() } // 非法时刻视为无时间词

  let addDays = 0
  let explicitDay = false
  if (g.day) {
    explicitDay = true
    if (g.wd) {
      let diff = (WEEKDAY[g.wd] - now.getDay() + 7) % 7
      if (diff === 0) diff = 7 // 周X ≤ 今天（即等于今天）→ 取下一个，+7 天
      addDays = diff
    } else {
      addDays = DAY_OFFSET[g.day]
    }
  }

  // 时段段 → 小时修正（中文习惯；加 12 后 ≥24 则回退不进位）
  let h = h0
  let extraDay = 0
  if (g.period === '中午') {
    if (h <= 2) h += 12 // 中午1点=13点；中午12点=12点
  } else if (g.period === '下午' || g.period === '傍晚') {
    if (h + 12 < 24) h += 12 // 下午3点=15、下午8点=20；下午12点=12点（回退）
  } else if (g.period === '晚上' || g.period === '夜里') {
    if (h === 12) {
      h = 0
      extraDay = 1 // 晚上12点 = 午夜 → 次日 00:00（而非正午 12 点）
    } else if (h + 12 < 24) {
      h += 12 // 晚上8点=20、晚上11点半=23:30
    }
  } // 凌晨/早上/早晨/上午：小时原样

  let dueAt = at(now, addDays + extraDay, h, min)
  // 无日期词且该时刻今天已过 → 顺延到明天（显式"今天"不顺延）
  if (!explicitDay && extraDay === 0 && dueAt < now.getTime()) {
    dueAt = at(now, addDays + 1, h, min)
  }
  return { dueAt, cleanTitle: strip(text, m.index, m[0].length) }
}
