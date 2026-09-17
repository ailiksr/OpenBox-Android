import assert from 'node:assert/strict'
import test from 'node:test'
import { buildConfig } from './config.mjs'
import { createNode } from './node-model.mjs'
import { cidrContains } from '../system/local-subnets.mjs'

const nodes = [
  createNode({ tag: '美国-01', type: 'shadowsocks', server: 'a.com', server_port: 8388, fields: { method: 'aes-256-gcm', password: 'pw' }, source: 'clash' }),
  createNode({ tag: 'WG-01', type: 'wireguard', server: 'wg.com', server_port: 51820, fields: { private_key: 'p', peer_public_key: 'q', local_address: ['10.0.0.2/32'] }, source: 'clash' }),
]
const regionGroups = [{ name: '美国', type: 'urltest', nodeTags: ['美国-01'] }]
const profile = {
  ipv6: true,
  dns: { split: true, direct: '223.5.5.5', proxy: '1.1.1.1' },
  routing: { proxyTag: 'PROXY', categories: [], directRulesets: ['geosite-cn'], adBlock: false, fallback: 'PROXY' },
  rulesetDir: '/data/rulesets',
  clashApiSecret: 's3cr3t',
}

test('buildConfig 顶层结构:TPROXY 透明代理入站(红线 1,不建 TUN)', () => {
  const c = buildConfig({ nodes, regionGroups, profile })
  assert.equal(c.log.level, 'warn')
  // 红线 1:Android 端严禁 TUN,入站必须是 TPROXY(7895) + REDIRECT(7892) + 面板回环 + DNS
  assert.deepEqual(c.inbounds.map((i) => i.type), ['tproxy', 'redirect', 'mixed', 'direct'])
  const tproxy = c.inbounds.find((i) => i.tag === 'tproxy-in')
  assert.deepEqual(tproxy, { type: 'tproxy', tag: 'tproxy-in', listen: '0.0.0.0', listen_port: 7895 })
  const redirect = c.inbounds.find((i) => i.tag === 'redirect-in')
  assert.deepEqual(redirect, { type: 'redirect', tag: 'redirect-in', listen: '0.0.0.0', listen_port: 7892 })
  const panel = c.inbounds.find((i) => i.tag === 'panel-in')
  assert.deepEqual(panel, { type: 'mixed', tag: 'panel-in', listen: '127.0.0.1', listen_port: 7891 })
  assert.ok(!c.inbounds.some((i) => i.type === 'tun'), '不得存在 tun 入站')
  assert.equal(c.experimental.clash_api.external_controller, '127.0.0.1:9095')
  assert.equal(c.experimental.clash_api.secret, 's3cr3t')
  // 红线 2:防环路高位标记锁定 131072(0x20000),且严禁 auto_detect_interface
  assert.equal(c.route.default_mark, 131072)
  assert.equal(c.route.auto_detect_interface, undefined)
  // wireguard 进 endpoints,不进 outbounds
  assert.ok(c.endpoints.some((e) => e.tag === 'WG-01'))
  assert.ok(!c.outbounds.some((o) => o.tag === 'WG-01'))
  // 内置直连(默认叫「直连」)+ 兜底「其他」selector + ss 节点
  assert.ok(c.outbounds.some((o) => o.tag === '直连' && o.type === 'direct'))
  assert.ok(c.outbounds.some((o) => o.tag === '其他' && o.type === 'selector'))
  assert.ok(!c.outbounds.some((o) => o.tag === 'PROXY' || o.tag === '美国'))
  assert.ok(c.outbounds.some((o) => o.tag === '美国-01' && o.type === 'shadowsocks'))
})

test('ipv6 关:dns-in 只监听 0.0.0.0,DNS 策略降为 ipv4_only', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false } })
  const dnsIn = c.inbounds.find((i) => i.tag === 'dns-in')
  assert.equal(dnsIn.listen, '0.0.0.0')
  assert.equal(c.dns.strategy, 'ipv4_only')
  const on = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: true } })
  assert.equal(on.inbounds.find((i) => i.tag === 'dns-in').listen, '::')
})

test('每条策略生成一个同名 selector,成员是「出站」页签选中的那几类', () => {
  const c = buildConfig({
    nodes,
    regionGroups,
    userGroups: [{ id: 'g', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: [] }],
    profile: {
      ...profile,
      routing: {
        proxyTag: 'PROXY',
        regionMode: 'CN',
        policies: [{ id: 'p1', name: '谷歌', rulesets: ['geosite-google'], default: '香港-自动' }],
      },
    },
  })
  const sel = c.outbounds.find((o) => o.tag === '谷歌')
  assert.deepEqual(sel, {
    type: 'selector',
    tag: '谷歌',
    // 按「节点管理」的顺序:内置直连 → 用户组 → 内置拒绝
    outbounds: ['直连', '香港-自动', '拒绝'],
    default: '香港-自动',
  })
  assert.ok(c.outbounds.some((o) => o.type === 'block' && o.tag === '拒绝'), '拒绝出站要在')
  const rule = c.route.rules.find((r) => r.outbound === '谷歌')
  assert.deepEqual(rule.rule_set, ['geosite-google'])
})

test('站点集的 default 不在成员表里时落到第一个成员,而不是写一个内核找不到的名字', () => {
  const c = buildConfig({
    nodes,
    regionGroups,
    profile: {
      ...profile,
      routing: {
        regionMode: 'CN',
        policies: [{ id: 'p1', name: '谷歌', rulesets: ['geosite-google'], default: '并不存在的组' }],
      },
    },
  })
  const sel = c.outbounds.find((o) => o.tag === '谷歌')
  assert.equal(sel.default, sel.outbounds[0])
})

test('「节点管理」里停用拒绝:配置里不生成 block 出站,站点集里也选不到', () => {
  const c = buildConfig({
    nodes,
    regionGroups,
    userGroups: [{ id: 'builtin-block', name: '拒绝', enabled: false }],
    profile: {
      ...profile,
      routing: {
        regionMode: 'CN',
        policies: [{ id: 'p1', name: '谷歌', rulesets: ['geosite-google'] }],
      },
    },
  })
  assert.ok(!c.outbounds.some((o) => o.type === 'block'))
  assert.deepEqual(c.outbounds.find((o) => o.tag === '谷歌').outbounds, ['直连'])
})

test('内置直连改名后,内网直连规则和空组占位都跟着新名字', () => {
  const c = buildConfig({
    nodes,
    regionGroups,
    userGroups: [
      { id: 'builtin-direct', name: '国内直出' },
      { id: 'e', name: '空组', type: 'selector', mode: 'static', members: [] },
    ],
    profile: { ...profile, routing: { policies: [] } },
  })
  assert.ok(c.outbounds.some((o) => o.type === 'direct' && o.tag === '国内直出'))
  assert.ok(!c.outbounds.some((o) => o.tag === 'direct'))
  assert.deepEqual(c.route.rules.find((r) => r.ip_is_private), { ip_is_private: true, outbound: '国内直出' })
  assert.deepEqual(c.outbounds.find((o) => o.tag === '空组').outbounds, ['国内直出'])
})

test('TPROXY 架构回归(红线 1):入站不含 tun,排除表 / auto_redirect / dns_mode / udp_timeout 一律不出现', () => {
  // 这些字段都是上游 OpenWrt 的 TUN 专属产物。Android 版改成 TPROXY 后它们不再进入配置,
  // 一旦有人把 tunInbound 误加回 inbounds,这条会立刻失败——是防止架构回退的哨兵。
  for (const over of [{ ipv6: true }, { ipv6: false }, { tun: { autoRedirect: true } }, { tun: { autoRedirect: false } }]) {
    const c = buildConfig({ nodes, regionGroups, profile: { ...profile, ...over } })
    assert.ok(!c.inbounds.some((i) => i.type === 'tun'), '不得出现 tun 入站')
    for (const ib of c.inbounds) {
      for (const f of ['route_exclude_address', 'route_exclude_address_set', 'auto_redirect', 'auto_route', 'strict_route', 'stack', 'dns_mode', 'dns_address', 'exclude_mac_address', 'udp_timeout', 'address']) {
        assert.ok(!(f in ib), `入站 ${ib.tag} 不该带 TUN 专属字段 ${f}`)
      }
    }
  }
  // 透明代理靠 iptables 打标 + TPROXY 送进 7895,配置侧只需保证 default_mark 与 iptables 的 SELF_MARK 一致
  const c = buildConfig({ nodes, regionGroups, profile })
  assert.equal(c.route.default_mark, 131072)
})




test('dns.mode=hijack(默认)生成全局 hijack-dns 路由规则;dns-in 入站三种模式都有且监听所有地址', () => {
  const c = buildConfig({ nodes, regionGroups, profile })
  assert.ok(c.route.rules.some((r) => r.action === 'hijack-dns' && r.protocol === 'dns'))
  const dnsIn = c.inbounds.find((i) => i.tag === 'dns-in')
  assert.deepEqual(dnsIn, { type: 'direct', tag: 'dns-in', listen: '::', listen_port: 7853 })
})

test('红线 6:dns.mode=off 时仍强制双劫持(协议 + 53 端口),dns-in 入站保留,且不生成 dnsmasq 出站', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, tun: { autoRedirect: true }, dns: { ...profile.dns, mode: 'off' } } })
  const hijacks = c.route.rules.filter((r) => r.action === 'hijack-dns')
  assert.deepEqual(hijacks, [
    { protocol: 'dns', action: 'hijack-dns' },
    { port: [53], action: 'hijack-dns' },
  ])
  assert.ok(c.inbounds.some((i) => i.tag === 'dns-in' && ['0.0.0.0', '::'].includes(i.listen)))
  assert.ok(!c.outbounds.some((o) => o.tag === 'dnsmasq'))
  assert.ok(!c.route.rules.some((r) => r.override_address))
})

test('红线 6:dns.mode=dnsmasq 时仍强制双劫持,DNS 入站监听 :7853(开 v6 时双栈)', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, dns: { ...profile.dns, mode: 'dnsmasq' } } })
  const hijacks = c.route.rules.filter((r) => r.action === 'hijack-dns')
  assert.deepEqual(hijacks, [
    { protocol: 'dns', action: 'hijack-dns' },
    { port: [53], action: 'hijack-dns' },
  ])
  const dnsIn = c.inbounds.find((i) => i.type === 'direct')
  assert.ok(['0.0.0.0', '::'].includes(dnsIn.listen))
  assert.equal(dnsIn.listen_port, 7853)
})

test('directForNodes 默认开:节点服务器和订阅主机名生成直连规则与本地解析规则;关掉就没有', async () => {
  const { collectDirectHosts } = await import('./direct-hosts.mjs')
  const hosts = collectDirectHosts(
    [{ tag: 'a', type: 'shadowsocks', server: 'node.example.com' }, { tag: 'b', type: 'shadowsocks', server: '5.6.7.8' }],
    [{ url: 'https://sub.example.com/x?token=1' }, { url: '' }],
  )
  assert.deepEqual(hosts, { domains: ['node.example.com', 'sub.example.com'], cidrs: ['5.6.7.8/32'] })
})

test('订阅有多个地址时每个地址的主机名都直连;老记录只有 url 也照旧', async () => {
  const { collectDirectHosts } = await import('./direct-hosts.mjs')
  const hosts = collectDirectHosts([], [
    { url: 'https://a.example.com/x', urls: ['https://a.example.com/x', 'https://b.example.com/y'] },
    { url: 'https://old.example.com/z' },
  ])
  assert.deepEqual(hosts.domains, ['a.example.com', 'b.example.com', 'old.example.com'])
})

test('directHostCidrs:部署时解析出来的节点 IP 并进直连规则的 ip_cidr(去重),关掉直连开关就不生成', () => {
  const c = buildConfig({ nodes, regionGroups, profile, directHostCidrs: ['38.47.107.167/32', '38.47.107.167/32', '2001:db8::5/128'] })
  const rule = c.route.rules.find((r) => r.outbound === '直连' && Array.isArray(r.domain))
  assert.ok(rule, '应有节点站点直连规则')
  assert.ok(rule.ip_cidr.includes('38.47.107.167/32'))
  assert.equal(rule.ip_cidr.filter((x) => x === '38.47.107.167/32').length, 1)
  const off = buildConfig({ nodes, regionGroups, profile: { ...profile, directForNodes: false }, directHostCidrs: ['38.47.107.167/32'] })
  assert.ok(!off.route.rules.some((r) => Array.isArray(r.ip_cidr) && r.ip_cidr.includes('38.47.107.167/32')))
})

test('防回环:目标是 tun 自己网段的连接直接拒绝,且排在 ip_is_private 之前', () => {
  const c = buildConfig({ nodes, regionGroups, profile })
  const i = c.route.rules.findIndex((r) => Array.isArray(r.ip_cidr) && r.action === 'reject')
  const j = c.route.rules.findIndex((r) => r.ip_is_private)
  assert.ok(i >= 0 && j >= 0 && i < j, `reject=${i} ip_is_private=${j}`)
  assert.ok(c.route.rules[i].ip_cidr.includes('172.19.0.0/30'))
  const v6 = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: true } })
  const r6 = v6.route.rules.find((r) => Array.isArray(r.ip_cidr) && r.action === 'reject')
  assert.deepEqual(r6.ip_cidr, ['172.19.0.0/30', 'fdfe:dcba:9876::/126'])
})

test('dnsmasq 模式在 TPROXY 架构下不再生成专用出站与 DNS 回交规则(由 iptables + 内核 DNS 入站承担)', () => {
  const c = buildConfig({ nodes, regionGroups, profile: { ...profile, dns: { ...profile.dns, mode: 'dnsmasq' } } })
  // 上游那套「绑 lo 的 dnsmasq 直连出站 + override_address 回交」是 TUN + auto_redirect 的配套产物,
  // TPROXY 下局域网 DNS 由 iptables 的 53 端口 REDIRECT 直接送进内核,不需要回交规则。
  assert.ok(!c.outbounds.some((o) => o.tag === 'dnsmasq'))
  assert.ok(!c.outbounds.some((o) => o.bind_interface === 'lo'))
  assert.ok(!c.route.rules.some((r) => r.override_address))
  // DNS 入站仍然在(局域网 AdGuard / Pi-hole 可以把上游指到它)
  assert.ok(c.inbounds.some((i) => i.tag === 'dns-in'))
})

test('出站 tag 撞名 → 生成配置时直接报人话,而不是让内核 duplicate tag FATAL', () => {
  // 两个节点同名(订阅层的去重被绕过 / 手工导入),或站点集 / 节点组和节点同名,都是同一条闸
  const twin = createNode({ tag: '美国-01', type: 'shadowsocks', server: 'b.com', server_port: 8388, fields: { method: 'aes-256-gcm', password: 'pw' }, source: 'clash' })
  assert.throws(() => buildConfig({ nodes: [...nodes, twin], regionGroups, profile }), /出站名称重复:「美国-01」/)
  const policyClash = { ...profile, routing: { ...profile.routing, policies: [{ name: '美国-01', domainSuffix: ['x.com'] }] } }
  assert.throws(() => buildConfig({ nodes, regionGroups, profile: policyClash }), /出站名称重复:「美国-01」/)
})

test('dns-in 监听地址:开 IPv6 双栈 ::(AdGuard 用路由器 v6 地址当上游也到得了),关 IPv6 只监听 0.0.0.0', () => {
  const on = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: true } }).inbounds.find((i) => i.tag === 'dns-in')
  const off = buildConfig({ nodes, regionGroups, profile: { ...profile, ipv6: false } }).inbounds.find((i) => i.tag === 'dns-in')
  assert.equal(on.listen, '::')
  assert.equal(off.listen, '0.0.0.0')
})

test('回归:任何 DNS 规则都不引用含 IP 的规则集(geoip-* / 规则集链接的 -ip 那份),路由规则照旧两边都引用', () => {
  const tag = 'list-' + (() => { let h = 0x811c9dc5; for (const ch of 'https://x.test/Check.list') { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0 } return h.toString(16).padStart(8, '0') })()
  const c = buildConfig({
    nodes,
    regionGroups,
    userGroups: [{ id: 'g', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: [] }],
    ruleLists: { [tag]: { domain: true, ip: true } },
    profile: {
      ...profile,
      routing: {
        proxyTag: 'PROXY',
        regionMode: 'CN',
        policies: [
          { id: 'p1', name: 'Netflix', rulesets: ['geosite-netflix', 'geoip-netflix'], default: '香港-自动' },
          { id: 'p2', name: 'Speed', ruleUrls: ['https://x.test/Check.list'], default: '香港-自动' },
          { id: 'p3', name: '国内', rulesets: ['geosite-cn', 'geoip-cn'], default: '直连' },
        ],
      },
    },
  })
  const dnsTags = c.dns.rules.flatMap((r) => [].concat(r.rule_set || []))
  assert.ok(dnsTags.length > 0)
  assert.ok(dnsTags.every((t) => !t.startsWith('geoip-') && !t.endsWith('-ip')), `DNS 规则里混进了含 IP 的规则集:${dnsTags.join(',')}`)
  assert.deepEqual(c.route.rules.find((r) => r.outbound === 'Netflix').rule_set, ['geosite-netflix', 'geoip-netflix'])
  assert.deepEqual(c.route.rules.find((r) => r.outbound === 'Speed').rule_set, [tag, `${tag}-ip`])
  assert.deepEqual(c.dns.rules.find((r) => r.server === 'dns-direct' && r.rule_set)?.rule_set, ['geosite-cn'])
})

// ---------- 第一层整改:入口排除表与原生旁路 ----------
const subnets = ['192.168.1.0/24']
const firstLayerGroups = [{ id: 'g', name: '香港-自动', type: 'urltest', mode: 'dynamic', keywords: [] }]
const firstLayerProfile = (over = {}) => ({
  ...profile,
  ipv6: true,
  dns: { split: true, mode: 'dnsmasq', direct: '223.5.5.5', proxy: '1.1.1.1' },
  tun: { autoRedirect: true },
  routing: { fallbackDefault: 'direct', policies: [{ id: 'cn', name: '国内', default: 'direct', rulesets: ['geoip-cn', 'geosite-cn'] }] },
  ...over,
})

test('前置自定义分流:私网段送去节点时路由规则照常生成(排除表挖洞已随 TUN 一并移除)', () => {
  const c = buildConfig({
    nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets,
    profile: firstLayerProfile({ routing: { fallbackDefault: 'direct', policies: [], custom: { rules: [
      { type: 'ipCidr', value: '10.77.0.0/16', outbound: '香港-自动' },
      { type: 'ipCidr', value: 'fd77::/48', outbound: '香港-自动' },
      { type: 'ipCidr', value: '10.88.0.0/16', outbound: 'direct' },
      { type: 'ipCidr', value: '10.99.0.0/16', outbound: '不存在的出口' },
    ] } } }),
  })
  // 有效出口的两条规则都要落地;出口不存在的被丢掉
  assert.ok(c.route.rules.some((r) => r.ip_cidr && r.ip_cidr[0] === '10.77.0.0/16' && r.outbound === '香港-自动'))
  assert.ok(c.route.rules.some((r) => r.ip_cidr && r.ip_cidr[0] === 'fd77::/48' && r.outbound === '香港-自动'))
  assert.ok(c.route.rules.some((r) => r.ip_cidr && r.ip_cidr[0] === '10.88.0.0/16' && r.outbound === '直连'), 'direct 解析成内置直连出站的显示名')
  assert.ok(!c.route.rules.some((r) => r.ip_cidr && r.ip_cidr[0] === '10.99.0.0/16'), '出口不存在的不生成')
})
test('FakeIP 原型:cache_file 存占位映射,fakeip 服务器给出 v4/v6 占位段(第三轮 阶段 3)', () => {
  const on = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile({ dns: { split: true, mode: 'dnsmasq', direct: '223.5.5.5', proxy: '1.1.1.1', fakeIpForProxy: true } }) })
  assert.equal(on.experimental.cache_file.store_fakeip, true)
  const fake = on.dns.servers.find((s) => s.type === 'fakeip')
  assert.ok(fake, '要有 fakeip 服务器')
  assert.equal(fake.inet4_range, '198.18.0.0/15')
  assert.equal(fake.inet6_range, 'fc00::/18')
  const off = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile() })
  assert.equal(off.experimental.cache_file.store_fakeip, false)
  assert.ok(!off.dns.servers.some((s) => s.type === 'fakeip'))
})

test('IPv6 分层(第三轮 阶段 5):ipv6 开 + ipv6Proxy=ipv4 时按此刻的选择给代理出口插 v6 拒绝、DNS 代理规则只解析 A;站点集切到直连就不插;老开关语义不变', () => {
  const p = (over = {}) => firstLayerProfile({
    ipv6: true, ipv6Proxy: 'ipv4',
    routing: { fallbackDefault: 'direct', policies: [
      { id: 'g', name: 'Google', default: '香港-自动', rulesets: ['geosite-google', 'geoip-google'] },
      { id: 'cn', name: '国内', default: 'direct', rulesets: ['geoip-cn', 'geosite-cn'] },
    ] },
    ...over,
  })
  const split = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p() })
  const g = split.route.rules.findIndex((r) => r.outbound === 'Google')
  assert.deepEqual(split.route.rules[g - 1], { rule_set: ['geosite-google', 'geoip-google'], ip_version: 6, action: 'reject' })
  assert.ok(!split.route.rules.some((r) => r.ip_version === 6 && r.rule_set && r.rule_set.includes('geoip-cn')), '直连站点集前不插')
  assert.ok(!split.route.rules.some((r) => r.ip_version === 6 && !r.rule_set), '兜底直连:没有裸 v6 拒绝')
  const gi = split.dns.rules.findIndex((r) => r.server === 'dns-policy-0')
  // 走代理的站点集前面两条回空:先 AAAA(v6 降级),再 HTTPS / SVCB(走节点隧道不必要的服务类型记录)
  assert.deepEqual(split.dns.rules[gi - 2], { rule_set: ['geosite-google'], query_type: ['AAAA'], action: 'predefined', rcode: 'NOERROR' })
  assert.deepEqual(split.dns.rules[gi - 1], { rule_set: ['geosite-google'], query_type: ['HTTPS', 'SVCB'], action: 'predefined', rcode: 'NOERROR' })
  assert.deepEqual(split.dns.rules[gi], { rule_set: ['geosite-google'], server: 'dns-policy-0' })
  assert.equal(split.dns.strategy, 'prefer_ipv4')
  // 代理页把 Google 切到直连:不再插;把「国内」切到代理:插
  const flipped = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p(), selections: { Google: '直连', 国内: '香港-自动' } })
  assert.ok(!flipped.route.rules.some((r) => r.ip_version === 6 && r.rule_set && r.rule_set.includes('geosite-google')))
  assert.ok(flipped.route.rules.some((r) => r.ip_version === 6 && r.rule_set && r.rule_set.includes('geoip-cn')))
  // 兜底走代理:收尾裸 v6 拒绝
  const fb = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p({ routing: { ...p().routing, fallbackDefault: 'proxy' } }) })
  assert.deepEqual(fb.route.rules.at(-1), { ip_version: 6, action: 'reject' })
  // node(老"开启")/ ipv6 关(老"关闭"):一条 ip_version 都没有;关着仍是 ipv4_only + 无 v6 地址
  const node = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p({ ipv6Proxy: 'node' }) })
  assert.ok(!node.route.rules.some((r) => r.ip_version))
  const off = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p({ ipv6: false }) })
  assert.ok(!off.route.rules.some((r) => r.ip_version))
  assert.equal(off.dns.strategy, 'ipv4_only')
})


test('第四轮 T4:DNS 禁用模式与 FakeIP 组合下路由规则顺序不受影响(终端不一定经内核解析)', () => {
  const p = firstLayerProfile({
    dns: { split: true, mode: 'off', direct: '223.5.5.5', proxy: '1.1.1.1', fakeIpForProxy: true },
    routing: { fallbackDefault: 'direct', policies: [
      { id: 'a', name: '任意域名策略', domainSuffix: ['example.test'], default: '香港-自动' },
      { id: 'b', name: '后置直连', rulesets: ['geoip-cn'], default: 'direct' },
    ] },
  })
  const off = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p })
  // 域名代理站点集必须排在后面的直连集合之前,否则终端自带解析的连接会被直连规则先接走
  const names = off.route.rules.filter((r) => r.outbound).map((r) => r.outbound)
  assert.ok(names.indexOf('任意域名策略') < names.indexOf('后置直连'), '域名策略要排在直连集合前面')
  // 红线 6:禁用模式下劫持依旧在
  assert.equal(off.route.rules.filter((r) => r.action === 'hijack-dns').length, 2)
})

test('预解析本轮不进正式配置(收尾验收):即使按目标 IP 判的规则排在域名站点集前面,buildConfig 也不注入 resolve;DNS 规则和解析器不受影响', () => {
  const p = firstLayerProfile({
    routing: { fallbackDefault: 'direct', policies: [
      { id: 'g', name: 'Google', default: '香港-自动', rulesets: ['geosite-google'] },
      { id: 't', name: '电报', default: '香港-自动', rulesets: ['geoip-telegram'] },
      { id: 'cn', name: '国内', default: 'direct', rulesets: ['geosite-cn', 'geoip-cn'] },
    ] },
  })
  for (const profile of [p, { ...p, dns: { ...p.dns, fakeIpForProxy: true } }]) {
    const c = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile })
    assert.ok(!c.route.rules.some((r) => r.action === 'resolve'), '正式配置里不能有 resolve 动作')
    // 分流规则原样:域名规则在前、IP 规则在后、直连在最后
    assert.deepEqual(c.route.rules.filter((r) => r.outbound && r.rule_set).map((r) => r.outbound), ['Google', '电报', '国内'])
    assert.ok(c.dns.servers.some((s) => s.tag === 'dns-policy-0' && s.detour === 'Google'))
  }
})


test('IPv6「不进内核,直连放行」(ipv6Proxy=bypass):不插 v6 拒绝,DNS 照常双栈解析,FakeIP 不给 v6 占位段', () => {
  const p = firstLayerProfile({
    ipv6: true, ipv6Proxy: 'bypass',
    routing: { fallbackDefault: 'proxy', policies: [{ id: 'g', name: 'Google', default: '香港-自动', rulesets: ['geosite-google'] }] },
  })
  const c = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: p })
  assert.ok(!c.route.rules.some((r) => r.ip_version === 6), '不插 v6 拒绝')
  assert.equal(c.dns.strategy, 'prefer_ipv4', 'DNS 照常给 AAAA')
  // bypass 不写 AAAA 回空(v6 照常解析);HTTPS / SVCB 回空和 v6 分层无关,照常有
  assert.ok(!c.dns.rules.some((r) => (r.query_type || []).includes('AAAA')))
  assert.ok(c.dns.rules.some((r) => Array.isArray(r.query_type) && r.query_type.includes('HTTPS') && r.action === 'predefined'))
  // 防回环那条只管 v4 的 tun 网段
  assert.deepEqual(c.route.rules.find((r) => r.action === 'reject' && r.ip_cidr), { ip_cidr: ['172.19.0.0/30'], action: 'reject' })
  const fake = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile({ ipv6: true, ipv6Proxy: 'bypass', dns: { split: true, mode: 'dnsmasq', direct: '223.5.5.5', proxy: '1.1.1.1', fakeIpForProxy: true }, routing: p.routing }) })
  assert.equal(fake.dns.servers.find((s) => s.type === 'fakeip').inet6_range, undefined)
})

test('终端分流(GitHub #39):bypass 终端在 TPROXY 架构下由路由规则兜底直连', () => {
  const routes = [
    { id: 'sw', enabled: true, name: 'Switch', sources: ['10.0.0.9'], bypass: true, macs: ['AA:BB:CC:DD:EE:FF'] },
    { id: 'ps', enabled: true, name: 'PS5', sources: ['10.0.0.10'], bypass: true, macs: ['aa:bb:cc:dd:ee:ff', '00:15:5d:03:0a:28'] },
    { id: 'tv', enabled: true, name: 'TV', sources: ['10.0.0.8'], outbound: '香港-自动' },
  ]
  const on = buildConfig({ nodes, regionGroups, userGroups: firstLayerGroups, localSubnets: subnets, profile: firstLayerProfile({ tun: { autoRedirect: true }, clientRoutes: routes }) })
  const direct = on.outbounds.find((o) => o.type === 'direct').tag
  // bypass 终端走直连兜底,普通终端走它指定的出口
  assert.ok(on.route.rules.some((r) => r.source_ip_cidr && r.source_ip_cidr[0] === '10.0.0.9/32' && r.outbound === direct), 'bypass 终端兜底直连')
  assert.ok(on.route.rules.some((r) => r.source_ip_cidr && r.source_ip_cidr[0] === '10.0.0.10/32' && r.outbound === direct), 'bypass 终端兜底直连')
  assert.ok(on.route.rules.some((r) => r.source_ip_cidr && r.source_ip_cidr[0] === '10.0.0.8/32' && r.outbound === '香港-自动'), '普通终端走指定出口')
  // TUN 专属的 exclude_mac_address 不再出现
  assert.ok(!on.inbounds.some((i) => 'exclude_mac_address' in i))
})
