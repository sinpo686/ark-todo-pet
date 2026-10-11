import { describe, it, expect } from 'vitest'
import { classifyAnimation, pickAnimation, ANIM_PATTERNS } from './animMap'

// 正则与 offsetY 均照抄 Ark-Pets 事实表（brief 事实3），i 标志；
// 动画全名以 `/` 分段：首段为类别（AnimType 正则目标），其后段中命中
// modifier 正则的为 begin/loop/end，其余为 stage（C1/C2…）。

describe('classifyAnimation（Ark-Pets 权威正则）', () => {
  it('Idle/Loop/C1 → idle+loop+offsetY 5', () => {
    expect(classifyAnimation('Idle/Loop/C1')).toEqual({
      kind: 'idle',
      modifier: 'loop',
      offsetY: 5
    })
  })

  it('Sit → sit offsetY 50；Sleep → sleep offsetY 25；Interact → interact offsetY 5', () => {
    expect(classifyAnimation('Sit')).toEqual({ kind: 'sit', modifier: 'none', offsetY: 50 })
    expect(classifyAnimation('Sleep')).toEqual({ kind: 'sleep', modifier: 'none', offsetY: 25 })
    expect(classifyAnimation('Interact')).toEqual({
      kind: 'interact',
      modifier: 'none',
      offsetY: 5
    })
  })

  it('Move/Begin → move+begin；Special/Loop → special+loop', () => {
    expect(classifyAnimation('Move/Begin')).toEqual({ kind: 'move', modifier: 'begin', offsetY: 5 })
    expect(classifyAnimation('Special/Loop')).toEqual({
      kind: 'special',
      modifier: 'loop',
      offsetY: 5
    })
  })

  it('未知名 Foo/Bar → other+none offsetY 0', () => {
    expect(classifyAnimation('Foo/Bar')).toEqual({ kind: 'other', modifier: 'none', offsetY: 0 })
  })

  it('大小写不敏感（i 标志）与 Relax 别名（Id.?le / Relax）', () => {
    expect(classifyAnimation('idle/loop').kind).toBe('idle')
    expect(classifyAnimation('SLEEP').kind).toBe('sleep')
    expect(classifyAnimation('Relax').kind).toBe('idle')
    expect(classifyAnimation('Relax').offsetY).toBe(5)
    // Id.?le 容错双字母拼写（Idlle：Id + 可选字符 + le）
    expect(classifyAnimation('Idlle').kind).toBe('idle')
  })

  it('kind 段容错后缀 .{0,2}（Move1 / Idle_2）；modifier 全表（Start/Up/Appear/End/Down/Disappear）', () => {
    expect(classifyAnimation('Move1/Loop').kind).toBe('move')
    expect(classifyAnimation('Idle_2/Loop').kind).toBe('idle')
    expect(classifyAnimation('Move/Start').modifier).toBe('begin')
    expect(classifyAnimation('Move/Up').modifier).toBe('begin')
    expect(classifyAnimation('Interact/Appear').modifier).toBe('begin')
    expect(classifyAnimation('Move/End').modifier).toBe('end')
    expect(classifyAnimation('Special/Down').modifier).toBe('end')
    expect(classifyAnimation('Special/Disappear').modifier).toBe('end')
  })

  it('Sleep/Loop/C2 → sleep+loop+25（多段 stage 不影响判定）；stage 段不是 modifier', () => {
    expect(classifyAnimation('Sleep/Loop/C2')).toEqual({
      kind: 'sleep',
      modifier: 'loop',
      offsetY: 25
    })
    expect(classifyAnimation('Idle/C1').modifier).toBe('none')
  })

  it('ANIM_PATTERNS 导出六类权威正则', () => {
    expect(ANIM_PATTERNS.map((p) => p.kind)).toEqual([
      'idle',
      'move',
      'sit',
      'sleep',
      'interact',
      'special'
    ])
    expect(ANIM_PATTERNS.find((p) => p.kind === 'sit')?.offsetY).toBe(50)
    expect(ANIM_PATTERNS.find((p) => p.kind === 'sleep')?.offsetY).toBe(25)
  })
})

describe('pickAnimation', () => {
  const AMIYA_LIKE = ['Idle/Loop/C1', 'Idle/Begin', 'Move/Begin', 'Move/Loop/C1', 'Sit/Loop/C1']

  it('有 Loop 优先 Loop；没有则取本体；该类完全缺失返回 null', () => {
    expect(pickAnimation(AMIYA_LIKE, 'idle', 'normal')).toBe('Idle/Loop/C1')
    expect(pickAnimation(['Move/Begin', 'Idle/Loop/C1'], 'move', 'normal')).toBe('Move/Begin')
    expect(pickAnimation(AMIYA_LIKE, 'die', 'normal')).toBeNull()
  })

  it('gloomy 且存在 Sleep 时 pickAnimation(available,"sit","gloomy") 可返回 Sleep 类动画（非 null）', () => {
    const available = ['Sleep/Loop/C1', 'Sit/Loop/C1']
    const picked = pickAnimation(available, 'sit', 'gloomy')
    expect(picked).not.toBeNull()
    expect(classifyAnimation(picked as string).kind).toBe('sleep')
  })

  it('gloomy 但无 Sleep 时 sit 正常回落到 Sit 类', () => {
    expect(pickAnimation(['Sit/Loop/C1'], 'sit', 'gloomy')).toBe('Sit/Loop/C1')
  })

  it('happy 禁用 Sleep：仅有 Sleep 时返回 null，不返回睡眠动画', () => {
    expect(pickAnimation(['Sleep/Loop/C1'], 'sleep', 'happy')).toBeNull()
    expect(pickAnimation(['Sleep/Loop/C1', 'Idle/Loop/C1'], 'sleep', 'happy')).toBeNull()
  })

  it('normal/gloomy 下 sleep 本类可用；mood 不影响 idle', () => {
    expect(pickAnimation(['Sleep/Loop/C1'], 'sleep', 'normal')).toBe('Sleep/Loop/C1')
    expect(pickAnimation(['Sleep/Loop/C1'], 'sleep', 'gloomy')).toBe('Sleep/Loop/C1')
    expect(pickAnimation(['Idle/Begin'], 'idle', 'happy')).toBe('Idle/Begin')
  })
})
