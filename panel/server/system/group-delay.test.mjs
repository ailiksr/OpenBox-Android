import assert from 'node:assert/strict'
import test from 'node:test'
import { KERNEL_GROUP_CONCURRENCY, KERNEL_MEMBER_TIMEOUT_MS, groupDelayTimeoutMs, groupDelayWaitMs } from './group-delay.mjs'

// 内核组测速接口 GET /group/:tag/delay 的 timeout 是**整次请求的期限**,不是每个成员的探测超时;
// 成员那一层是内核写死的 15 秒、一次 10 个。这里的算术就是照这个来的。
// 官方 1.14.0 实测:12 个成员、timeout=1500 → 请求在 1505ms 被切断,只回了 10/12 个成员。
test('内核常量:一次 10 个成员、每个成员 15 秒上限', () => {
  assert.equal(KERNEL_GROUP_CONCURRENCY, 10)
  assert.equal(KERNEL_MEMBER_TIMEOUT_MS, 15_000)
})

test('groupDelayTimeoutMs:按波数 × 15 秒给期限,不再把"每个成员几秒"直接当期限传进去', () => {
  const t = (n) => groupDelayTimeoutMs(n, { memberTimeoutMs: 5000 })
  // 1 波:15 秒 + 10 秒余量
  assert.equal(t(1), 25_000)
  assert.equal(t(10), 25_000)
  // 11 个成员就已经是 2 波 —— 这正是"5 秒"那种写法会误杀的地方
  assert.equal(t(11), 40_000)
  assert.equal(t(20), 40_000)
  assert.equal(t(21), 55_000)
  assert.equal(t(212), Math.ceil(212 / 10) * 15_000 + 10_000)
})

test('groupDelayTimeoutMs:成员数超过 10 时,期限必须覆盖"每一波都跑满 15 秒"', () => {
  for (const n of [11, 20, 50, 100, 212]) {
    const deadline = groupDelayTimeoutMs(n, { memberTimeoutMs: 5000 })
    assert.ok(deadline >= Math.ceil(n / 10) * 15_000, `n=${n} 期限 ${deadline}ms 不足 ${Math.ceil(n / 10)} 波 × 15 秒`)
  }
  // 老写法把"每个成员 5 秒"当期限:n=212 时只给 22 波 × 5 秒 = 110 秒,而真实需要 22 波 × 15 秒 = 330 秒
  assert.equal(groupDelayTimeoutMs(212, { memberTimeoutMs: 5000 }), 22 * 15_000 + 10_000)
  assert.ok(groupDelayTimeoutMs(212, { memberTimeoutMs: 5000 }) > 22 * 5_000)
})

test('groupDelayTimeoutMs:下限不低于调用方给的每成员时间;非法输入不炸', () => {
  // 成员很少时至少给到调用方期望的那点时间
  assert.equal(groupDelayTimeoutMs(1, { memberTimeoutMs: 60_000 }), 60_000)
  assert.equal(groupDelayTimeoutMs(0, { memberTimeoutMs: 5000 }), 25_000)
  assert.equal(groupDelayTimeoutMs(undefined, { memberTimeoutMs: 5000 }), 25_000)
  assert.equal(groupDelayTimeoutMs(NaN, { memberTimeoutMs: 5000 }), 25_000)
  assert.ok(Number.isFinite(groupDelayTimeoutMs(3, { memberTimeoutMs: 0 })))
})

test('groupDelayWaitMs:外面等得比内核期限更久(内核到期后还要收尾),但有硬上限', () => {
  // 期限 25 秒 + 收尾 15 秒
  assert.equal(groupDelayWaitMs({ memberCount: 3, memberTimeoutMs: 5000 }), 40_000)
  // 上限生效:大组不会被无上限地等下去
  const capped = groupDelayWaitMs({ memberCount: 5000, memberTimeoutMs: 5000, maxWaitMs: 60_000 })
  assert.equal(capped, 60_000)
  // 任何情况下都比内核期限宽,否则请求会被我们自己先掐断(一断,未测成员照样被删历史)
  for (const n of [1, 10, 11, 212]) {
    const deadline = groupDelayTimeoutMs(n, { memberTimeoutMs: 5000 })
    assert.ok(groupDelayWaitMs({ memberCount: n, memberTimeoutMs: 5000, maxWaitMs: 10 * 60_000 }) > deadline, `n=${n} 外部等待没有留出收尾余量`)
  }
  // 默认 15 分钟上限:成员数到 580(58 波)以内都还宽于内核期限,不会误伤正常大组
  const n212 = groupDelayTimeoutMs(212, { memberTimeoutMs: 5000 })
  assert.ok(groupDelayWaitMs({ memberCount: 212, memberTimeoutMs: 5000 }) > n212)
})

test('groupDelayWaitMs:非法上限视为不设上限,不能退化成 1 毫秒把请求掐断', () => {
  for (const bad of [0, -1, NaN, undefined, null, 'abc']) {
    const wait = groupDelayWaitMs({ memberCount: 3, memberTimeoutMs: 5000, maxWaitMs: bad })
    assert.ok(wait > groupDelayTimeoutMs(3, { memberTimeoutMs: 5000 }), `maxWaitMs=${String(bad)} 时等待被压得过短:${wait}`)
  }
})
