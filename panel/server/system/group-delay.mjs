// 内核组测速接口(GET /group/:tag/delay)的 timeout 语义。
//
// 这个接口的 timeout 是**整次请求的期限**,不是每个成员的探测超时。依据(官方 1.14.0,已逐条核对):
//   · experimental/clashapi/api_meta_group.go: timeout 只用来做一个 context.WithTimeout(r.Context(), timeout),
//     整个 handler 都跑在这个 ctx 里,没有再往下当"每个成员的探测超时"传
//   · constant/timeout.go 的 TCPTimeout = 15s:成员那一层用的是这个写死的值,成员自己不可配
//   · protocol/group/urltest.go: batch.WithConcurrencyNum(10) —— 一次最多测 10 个成员
//   · protocol/group/urltest.go: 请求期限一到,还没测到的成员一律按失败处理,并 **删掉它们的历史记录**
//     (DeleteURLTestHistory)。Clash API 的 /proxies 里那一项 history 就变成空数组,
//     面板/内核都据此认为"这个节点超时"。
//
// 官方 1.14.0 实测(本地起内核 + 一个刻意慢 800ms 的 SOCKS5,12 个成员):
//   timeout=1500 → 请求在 1505ms 被切断,只回了 10/12 个成员;timeout=30000 → 2253ms 跑完 12/12。
//
// 所以 N 个成员最坏要 ceil(N/10) 波 × 15 秒。把 5 秒这种"每个成员"的量级直接传进去,成员数一超过 10
// 就必然误杀后几波——面板上表现为"同一个组的活节点忽然集体超时",而延迟三色置灰正是拿这些结果画的。
//
// 还要注意这个接口**始终是 force=true 的**(protocol/group/urltest.go 里 URLTest(ctx) → urlTest(ctx, true)),
// 调用一次内核就把整组重测一遍,不理会 interval。所以算期限要用组里的**全部成员数**,不是这一轮到点的成员数;
// 面板侧的 interval 只用来决定"这一轮要不要发起",发起之后成员全都会被测。
export const KERNEL_GROUP_CONCURRENCY = 10
export const KERNEL_MEMBER_TIMEOUT_MS = 15_000
// 内核自己在期限到了之后还要收尾(等已经跑起来的探测结束),外面等的上限要再宽一点,别抢在它前面断开
export const KERNEL_REQUEST_MARGIN_MS = 10_000

// 成员数 → 发给内核的 timeout(毫秒)。下限是调用方给的 memberTimeoutMs:一个小组成员很少时,
// 至少给每个成员留出调用方期望的那点时间,不至于比单节点测速还短。
export const groupDelayTimeoutMs = (memberCount, { memberTimeoutMs = 5000, marginMs = KERNEL_REQUEST_MARGIN_MS } = {}) => {
  const members = Math.max(1, Number(memberCount) || 0)
  const perMember = Math.max(1, Number(memberTimeoutMs) || 0)
  const waves = Math.ceil(members / KERNEL_GROUP_CONCURRENCY)
  return Math.max(perMember, waves * KERNEL_MEMBER_TIMEOUT_MS + Math.max(0, Number(marginMs) || 0))
}

// 我们自己(HTTP 客户端)等多久。内核的期限 + 一段收尾余量。
//
// 这个外部上限只是"内核挂死不回包"的兜底:正常情况内核会在自己的期限到了之后回一个 200(可能只带一部分
// 成员),请求不会无限挂着。所以正常取值必须**严格大于**内核期限,否则就变成我们自己先把请求掐断——
// 而请求一断,内核那边 r.Context() 被取消,尚未测到的成员照样会被删历史,等于把要修的问题又引回来。
//
// maxWaitMs 是硬上限,只在极端大组上才可能生效。按默认值算(每波 15 秒):
//   上限 15 分钟 → 大约在成员数超过 580(58 波)时才会开始生效。
// 调用方若传 0 / 负数 / 非数字,视为"不设上限"(只受内核期限 + 收尾余量约束),而不是误当成 1 毫秒。
export const groupDelayWaitMs = ({ memberCount = 1, memberTimeoutMs = 5000, settleMs = 15_000, maxWaitMs = 15 * 60_000 } = {}) => {
  const wait = groupDelayTimeoutMs(memberCount, { memberTimeoutMs }) + Math.max(0, Number(settleMs) || 0)
  const cap = Number(maxWaitMs)
  if (!Number.isFinite(cap) || cap <= 0) return wait
  return Math.min(cap, wait)
}
