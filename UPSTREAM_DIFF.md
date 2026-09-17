# 上游差异存档（Upstream Diff）

> **用途**：记录上游 [`liandu2024/Open-Box`](https://github.com/liandu2024/Open-Box)（OpenWrt 路由器 sing-box 透明代理）相对本项目基线的演进，供后续接手者判断「哪些上游变更值得跟进、哪些必须忽略」。本文档只做差异记录与决策留痕，**不改变任何技术红线**（见 `AGENT_HANDOFF.md` 第 4 节）。

## 1. 基线对齐现状

| 项目 | 本项目（OpenBox for Android） | 上游（liandu2024/Open-Box） |
|---|---|---|
| 融合版本 | **v0.1.159** | **v0.1.201** |
| 落差 | — | 版本号相差 42，实际可见 Release 为 26 个 |
| 内核 | sing-box **1.14.0**（SagerNet 官方 vanilla） | **1.14.0-openbox-tcp5**（上游定制版，tcp3→tcp4→tcp5） |
| Node 运行时 | musl aarch64 **24.18.0** | 24.18.0 |
| 上游 main HEAD | — | `1ffadc9`（2026-09-16） |

### 1.0 ⚠️ 重要更正：上游 v0.1.160–v0.1.175 **并不存在**

上游仓库**总共只有 26 个 Tag/Release，最早的是 `v0.1.176`（2026-09-12）**。也就是说：

- `v0.1.160` ~ `v0.1.175` 这 16 个版本**从未公开发布**（逐个探测均 HTTP 404）；
- `compare/v0.1.175...v0.1.176` → 404，而 `compare/v0.1.176...v0.1.177` → 200，可反证 176 是首个 Release；
- Release 索引翻到第 3 页即到底（`?after=v0.1.176` 返回空页）。

**含义**：本项目的「融合上游 v0.1.159」这一版本号**无法在公开仓库中追溯到**（可能来自私有渠道、改名或重新打标）。后续若要做源码级对齐，需先确认该基线的真实来源；目前只能依据 Release Notes 做**行为级**差异分析。

### 1.1 上游仓库结构的重要事实

**上游 main 分支不开放源码**，仅有 `README.md`、`docs/`、`scripts/` 三个条目：

```text
README.md
docs/pic/*.webp, logo*.png
scripts/install.sh
scripts/uninstall.sh
scripts/update.sh
```

真正的面板/内核源码**只存在于 Release 附件 Zip 中**（v0.1.177 起每个 Release 挂 32 个附件；v0.1.176 附件数为 0）。因此：

- 无法用 `git diff` 做源码级对齐，**只能依据 Release Notes 做差异分析**；
- 复核命令：`git ls-remote --tags --refs https://github.com/liandu2024/Open-Box.git`

### 1.2 上游内核版本演进（Release Notes 中明确写出的）

| 内核版本串 | 出现在 |
|---|---|
| `1.14.0-openbox-tcp2` | v0.1.177、v0.1.187 |
| （有改动但未写版本串） | v0.1.183（Clash API 支持 `force=false`）、v0.1.184（测速协调下沉到内核） |
| `1.14.0-openbox-tcp3` | **v0.1.189 引入**，v0.1.190、v0.1.191 沿用 |
| `1.14.0-openbox-tcp4` | v0.1.198 |
| `1.14.0-openbox-tcp5` | v0.1.199、v0.1.200、v0.1.201 |

> 注意：上游 v0.1.177~v0.1.184 有一个**测速协调集群**（v0.1.177/181/182/183/184/189），逐步把「并发探测去重、按组 interval 复用结果、共享节点取最短 interval」从面板侧**下沉到内核**。本项目是**面板侧自研调度**（`system/latency-scheduler.mjs`），用官方 vanilla 内核，不适用该下沉路线，故只跟进其中的「timeout 语义」修正（见第 2 节 ②）。

## 2. 上游 v0.1.160 → v0.1.201 值得跟进的三项修复

以下三项均已在**官方 sing-box 1.14.0 二进制上实测复现并验证**（方法见第 4 节）。

### ✅ 已跟进：① HTTPS / SVCB 查询回空（上游 v0.1.200）

- **问题**：分流模式下浏览器会与 A / AAAA 并发发出 HTTPS（type 65）/ SVCB（type 64）记录查询。走代理解析时这次查询要排进节点隧道等对端回包，实测拖到 **4~12 秒**才超时重试——抓包表现为「域名没错、首包却卡好几秒」。
- **上游修法**：内核 DNS 规则固定加一条，令这两类查询立即得到 `NOERROR` 空应答。
- **我们的处境**：`engine/dns.mjs` 原先只对 **AAAA** 做了 `predefined / NOERROR` 回空（`emptyAAAA`），**没有覆盖 HTTPS / SVCB**。而本项目恰以分流模式为主，属真实可复现的移动端卡顿隐患。
- **落地**：`engine/dns.mjs` 新增 `emptyServiceTypes()`，只对**走代理解析**的匹配（`pushProxyRule` 各分支 + 兜底走代理）插入；走直连的域名**保留真实 HTTPS 记录**（本地解析本就是毫秒级，回空等于顺手关掉 ECH）。
- **实测结论**：`query_type` 只认**大写**（`HTTPS` / `SVCB`）；小写会让内核启动直接 `FATAL: unknown DNS query type`。运行期验证：HTTPS / SVCB 查询返回 `Status:0` 且无 `Answer`，而 A 查询照常返回真实记录。

### ✅ 已跟进：② 组测速 `timeout` 语义（上游 v0.1.198 / v0.1.199）

- **问题**：Clash API `GET /group/:tag/delay` 的 `timeout` 是**整次请求的期限**，不是每个成员的探测超时。成员那一层是内核**写死的 15 秒**，一次只测 **10** 个。请求期限一到，内核会把**尚未测到的成员一律按失败处理，并删除它们在 `/proxies` 里的历史**。
- **后果**：自动优选组里多个活节点被同一轮集体判为超时，组内无成员有结果，内核无从择优、只能停在原节点。**而本项目刚落地的「延迟三色置灰」正是消费这些测速结果**，误判会直接显示成「节点全灰」。
- **上游修法**：定制内核 `tcp4` 把 `timeout` 改为「每成员超时、由内核按成员数放宽请求期限」；面板侧则改传「整轮预算（波数 × 15 秒 + 余量）」。
- **我们的处境**：本项目用**官方 vanilla 1.14.0**，没有上游的内核侧修复，只能走面板侧兜底；且改动前面板传的是 `timeout=testTimeoutMs`（默认 **5000ms**）——一旦整组真实耗时超过 5 秒（成员多于 10 个、或有成员卡满 15 秒超时），后几波就会被误杀。
- **落地**：新增 `system/group-delay.mjs` 统一语义，`latency-scheduler.mjs` 与 `failover-manager.mjs` 共用：
  - 发给内核的期限 = `ceil(N/10) × 15s + 10s`（下限不低于调用方给的每成员时间）；
  - 外部等待上限 = 内核期限 + 15 秒收尾余量（硬上限 15 分钟；传入非法上限时视为不设上限，绝不退化成 1 毫秒把请求掐断）；
  - **期限一律按全组成员数算，不按「这一轮到点的成员数」算**。
- **同时修正两处错误的代码注释**：原注释称该接口是 `force=false`、会跳过未到 interval 的成员。**实测证明该接口始终 `force=true`**：调用一次内核就把**整组**重测一遍，不理会 `interval`。面板侧的 interval 只决定「这一轮要不要发起」。

> **实测数据（官方 1.14.0，12 个成员 + 每个成员约 800ms 延迟的 SOCKS5）**
> ```text
> timeout=1500  → elapsed=1505ms  只返回 10/12 个成员   ← 整次请求期限,到点即切断
> timeout=30000 → elapsed=2253ms  返回 12/12 个成员
> 连续两次相同调用均耗时约 2253ms,且 SOCKS5 各收到 12 次连接  ← 证明 force=true,不跳过
> ```

#### ⚠️ 附带实测发现：内核「忙」时返回 `{}` + HTTP 200（已知限制，未完整处理）

在**上一轮测速尚未结束时**再调该接口，内核会**立刻**返回一个**空对象 `{}` 且 HTTP 200**（实测 elapsed≈3ms），而不是排队或报错。

```text
启动后立即调用 -> status=200 elapsed=3ms entries=0/30 body={}
```

对调用方的风险：若把「HTTP 200 + 空 body」当成「这一轮所有成员都超时」，就会在组刚启动或与内核自测撞车时把**整组活节点**刷成超时并写进延迟历史。

**本项目的现状（如实记录，非"已解决"）**：

- `latency-scheduler.mjs` 有 `inFlight` 标志，保证**同一个调度器不叠着发**（上一轮没跑完直接 `skipped: 'busy'`），所以调度器**自己**不会撞出 `{}`。
- 但内核自己的后台定时测速仍可能在跑，此时面板这一轮会拿到 `{}`。代码把「HTTP 200」当作成功，进而对**这一轮到点且此刻仍没有任何结果的成员**记一笔超时（`delay: 0`）。
  - 对**本来就测不通**的成员：这笔超时是对的；
  - 对**健康但恰好从没被测到**的成员：这是一笔**可能不准确**的超时记录。不过下一轮只要真测通了就会被新结果覆盖，影响限于时间线上多一个 0 点。
- **需要区分 `{}` 的两个含义**（这是内核行为本身带来的歧义，实测确认）：①「已经有一轮在跑，本次没测」（忙，应稍后重试）；②「这一轮跑完了，但所有成员都失败」（失败成员会被内核从结果里**省略**，所以也是 `{}`）。两者都会以 **HTTP 200 + 空 body** 返回，**状态码无法区分**；`elapsed` 也不可靠（成员快速失败时同样很快）。

**结论**：这里没有做完整处理，是**已知限制**而非已修复项。若后续要彻底解决，需要在发起前记录各成员的 `history` 指纹、请求后比对（真跑过一轮必然有成员的历史被更新或被删除），用它把「忙」和「全失败」分开；届时**必须显式处理 `{}`，不能当成功**。当前实现与既有单测（组测速返回空 body 时，只有"本来就没结果"的成员被记超时）保持一致，未擅自改动语义。

#### 实测：内核组测速并发上限确认为 10

用慢速 SOCKS5 观测同刻并发 CONNECT 数：**峰值恰为 10**，与源码 `batch.WithConcurrencyNum(10)` 一致。

### ⏳ 待决策：③ 规则页「规则路由」按 IP 推算（上游 v0.1.201）

- **上游修法**：域名目标先向内核 DNS 解析成 IP，再判 `geoip` 集合 / `ip_cidr` / 私有地址这类按目标 IP 走的规则（原先只拿域名比，`geoip` 集合永远比不中，推算与实测不一致）。
- **我们的处境**：本项目 `api/route-test.mjs` 是**探测型**（真发包测，`connectTo` 已用解析后 IP），不是纯推算，影响面小。**暂不跟进**，留待实机验证后再定。

## 3. 明确**不适用**于本项目的上游变更（不跟进）

| 上游版本 | 变更 | 为何不跟进 |
|---|---|---|
| v0.1.194 | **整体移除广告拦截（adBlock）** | 上游是「功能退役只剩残留」；但本项目 anti-AD 是**活跃特性**（`dns-filter.mjs` 完整实现 + 测试守护），且**红线 3** 要求保留 26 款规则集离线内嵌。**绝不能跟着删** |
| v0.1.194 | 清理 `rulesetDir` / `directRulesets` / `regionId` / `proxyTag` / `categories` / `fallback` 等老字段 | 这些字段本项目**仍在使用**（各处 3~40 个文件命中），属自有配置契约，不跟随上游精简 |
| v0.1.196 | 安装/升级脚本补系统依赖（`kmod-tun` / `kmod-nft-queue` / `kmod-nft-nat` / `kmod-veth` / `ip-full` / `ca-bundle`） | 全是 OpenWrt 专属（opkg/apk），Android 无此依赖；其中 `kmod-tun` 明确对应 TUN 路线，**违反红线 1** |
| v0.1.197 | 中文全角括号、按钮统一为图标、悬停提示样式 | 纯路由器面板 UI/文案层，与 Android 端无关 |
| v0.1.192/193/195 | 规则页模拟终端、订阅分享二维码实时生成、改名表列宽 | 路由器面板功能层，Android 端另有实现 |
| v0.1.191/194 | `umask 022`、LuCI 文件 `chmod 644`、`uninstall.sh` 清理防火墙规则 | OpenWrt/LuCI 专属 |
| v0.1.200 | 图标库新增「龙」「播放键」等 | 纯 UI 资源 |
| v0.1.199/198 | **内核替换为 `openbox-tcp4`/`tcp5`** | 见下方「内核路线决策」 |

### 3.1 内核路线决策（悬而未决）

上游为解决 ② 而 fork 了内核（`1.14.0-openbox-tcp3/4/5`），核心改动是：

1. 不再把客户端 `timeout` 当请求期限，改为「每成员超时 + 按成员数放宽」；
2. 组测速并发数 10 改为可配；
3. **区分「因期限到期从未被尝试」与「尝试后真失败」**——只有后者才删历史（这是与超时单位无关的**正确性 bug**）。

本项目当前使用 **SagerNet 官方 vanilla 1.14.0**（`.github/workflows/release.yml` 从 `SagerNet/sing-box` 官方 Release 下载），**已通过面板侧兜底规避了误杀**。是否进一步跟进定制内核，需权衡：

- 跟进的收益：根治「未测成员被删历史」这一内核侧正确性问题；
- 跟进的代价：脱离官方上游、需自行维护 fork 构建链，与「发布全部交由 CI 托管」的极简原则有张力。

**当前决策：暂不跟进，面板侧兜底已足够。** 若后续实机仍观察到集体误判，再评估。

## 4. 本次验证方法（可复现）

### 4.1 官方内核获取

```powershell
# 注意:本机 bin/sing-box 是 Linux aarch64,Windows 上无法执行;需另取 Windows 版做校验
$url = "https://github.com/SagerNet/sing-box/releases/download/v1.14.0/sing-box-1.14.0-windows-amd64.zip"
```

### 4.2 关键实测数据

**HTTPS / SVCB 规则合法性**（`sing-box check`，控制组证明校验是有效的）：

| 配置 | 结果 |
|---|---|
| `query_type: ["AAAA"]` + `predefined` + `NOERROR` | exit 0 |
| **`query_type: ["HTTPS","SVCB"]`** + `predefined` + `NOERROR` | **exit 0** ✅ |
| `query_type: ["https","svcb"]`（小写） | **exit 1** `unknown DNS query type: "https"` |
| `rcode: "NOTARCODE"` | exit 1 `unknown rcode` |
| `query_type: ["NOTATYPE"]` | exit 1 |

**运行期行为**（起内核 + Clash API `/dns/query`）：

```json
// type=HTTPS → 立即空应答
{"Status":0,"Question":[{"Name":"www.google.com.","Qtype":65}],"Server":"internal"}
// type=SVCB → 立即空应答
{"Status":0,"Question":[{"Name":"www.google.com.","Qtype":64}],"Server":"internal"}
// type=A → 照常真实记录(对照组)
{"Status":0,"Answer":[{"data":"142.251.150.119","type":1}],"Server":"internal"}
```

**组测速 timeout 语义**（12 个成员 + 刻意慢 800ms 的 SOCKS5）：

```text
timeout=1500  → elapsed=1505ms  只返回 10/12 个成员  ← 整次请求期限,被切断
timeout=30000 → elapsed=2253ms  返回 12/12 个成员
连续两次相同调用均耗时 ~2253ms 且 SOCKS5 各收到 12 次连接  ← 证明 force=true,不跳过
```

### 4.3 生成配置的端到端校验

把 `engine/dns.mjs` 实际生成的 DNS 规则（含**真实 `.srs` 规则集**、`rule_set` + `query_type` + `predefined` 组合）交给官方内核 `check`，6 个场景全部通过：

```text
PASS  proxy-fallback:   rules=6  https/svcb-empty=3
PASS  v6-ipv4-fakeip:   rules=12 https/svcb-empty=3
PASS  v6-node-fakeip:   rules=9  https/svcb-empty=3
PASS  hijack-mode:      rules=8  https/svcb-empty=3
PASS  direct-fallback:  rules=5  https/svcb-empty=2   ← 兜底直连不插,符合预期
PASS  adblock-custom:   rules=9  https/svcb-empty=4
6/6 scenarios passed sing-box check
```

> 说明：`route.default_mark` 是 Linux 专属字段，Windows 版内核会 `FATAL: default_mark is only supported on linux`；故上述校验的配置中不含该字段（与 DNS 规则无关）。本项目配置本身就带 `default_domain_resolver: 'dns-direct'`，不受 1.14 该项弃用影响。

## 5. 复核命令速查

```bash
# 上游最新 tag / HEAD
git ls-remote --tags --refs https://github.com/liandu2024/Open-Box.git | tail -20
git ls-remote --symref https://github.com/liandu2024/Open-Box.git HEAD

# 上游 Release Notes（HTML 页较大,建议只看 tag 页）
#   https://github.com/liandu2024/Open-Box/releases.atom   (仅最近 10 条)
#   https://github.com/liandu2024/Open-Box/releases/tag/v0.1.XXX

# 本项目基线自检
cd panel/server && node --test --experimental-vm-modules
```

---

*本文档由接手的智能体整理于上游 v0.1.201 时点。上游演进较快，建议每次对齐前先复核第 5 节命令获取最新 tag。*
