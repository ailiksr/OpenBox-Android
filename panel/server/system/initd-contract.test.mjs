import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPaths } from './paths.mjs'

// Android 版服务脚本契约测试。
// 上游的 openwrt/initd/openbox 是 procd + uci 的 OpenWrt 脚本,本项目 100% 专供 Android,
// 已用模块自带的 scripts/service-core.sh(内核)与 scripts/service-panel.sh(面板)取代。
// 这里验证脚本与 createPaths 的契约、以及 Android 真实实现(无 procd / 无 uci)。
const here = path.dirname(fileURLToPath(import.meta.url))
// panel/server/system/ → 仓库根要上溯三层
const repoRoot = path.resolve(here, '../../..')
const readScript = (name) => fs.readFileSync(path.join(repoRoot, 'scripts', name), 'utf8')

const core = readScript('service-core.sh')
const panel = readScript('service-panel.sh')
const paths = createPaths()

test('服务脚本文件名与 createPaths 的 initd 路径一致', () => {
  // createPaths 给出的是设备上的绝对路径(/data/adb/modules/...),这里只校验脚本名与仓库内文件对得上
  assert.equal(path.basename(paths.initd.core), 'service-core.sh')
  assert.equal(path.basename(paths.initd.panel), 'service-panel.sh')
  for (const name of ['service-core.sh', 'service-panel.sh']) {
    assert.ok(fs.existsSync(path.join(repoRoot, 'scripts', name)), `缺少 scripts/${name}`)
  }
})

test('内核脚本引用的二进制与配置路径与 createPaths 一致', () => {
  assert.match(core, /bin\/sing-box/, '要引用 bin/sing-box')
  assert.match(core, /etc\/config\.json/, '要引用 etc/config.json')
  assert.match(core, /\$MODDIR/, '要基于模块目录定位')
})

test('Android 契约:脚本一律 /system/bin/sh,不得出现 procd / uci / opkg', () => {
  for (const [name, src] of [['service-core.sh', core], ['service-panel.sh', panel]]) {
    assert.match(src, /^#!\/system\/bin\/sh/, `${name} 要用 Android 的 sh`)
    assert.ok(!/USE_PROCD|procd_open_service|procd_close_service/.test(src), `${name} 不得使用 procd`)
    assert.ok(!/\buci\b/.test(src), `${name} 不得使用 uci`)
    assert.ok(!/\bopkg\b/.test(src), `${name} 不得使用 opkg`)
    assert.ok(!/\/etc\/init\.d/.test(src), `${name} 不得引用 OpenWrt init.d`)
  }
})

test('内核生命周期:start / stop / restart / status / enabled / enable / disable 全部实现', () => {
  for (const action of ['start', 'stop', 'restart', 'status', 'enabled', 'enable', 'disable']) {
    assert.ok(new RegExp(`^\\s*${action}\\)`, 'm').test(core), `缺少子命令 ${action}`)
  }
})

test('status 用 pgrep 判定进程,存在返回 running/0,不存在返回 stopped/1', () => {
  assert.match(core, /pgrep\s+-f/, 'status 要用 pgrep 找进程')
  assert.match(core, /echo "running"[\s\S]*?exit 0/, 'running 时退出码 0')
  assert.match(core, /echo "stopped"[\s\S]*?exit 1/, 'stopped 时退出码 1')
})

test('enable/disable 用 autostart 标记文件(Android 无 procd 自启注册)', () => {
  assert.match(core, /autostart/, '要用 data/autostart 作自启标记')
  assert.match(core, /touch\s+"\$DATA\/autostart"/, 'enable 要创建标记')
  assert.match(core, /rm -f\s+"\$DATA\/autostart"/, 'disable 要删除标记')
})

test('start 前清理残留进程,避免端口占用导致起不来', () => {
  assert.match(core, /killall\s+-9\s+sing-box/, '要 killall 清理')
  assert.match(core, /pkill\s+-9\s+-f/, '要按路径 pkill 清理')
})

test('start 成功后拉起 iptables 规则,stop 先撤规则再杀进程(红线 1 的 TPROXY 接管)', () => {
  assert.match(core, /iptables\.sh"?\s+start/, 'start 要调 iptables.sh start')
  assert.match(core, /iptables\.sh"?\s+stop/, 'stop 要调 iptables.sh stop')
  // stop 里撤规则必须排在杀进程之前(否则规则残留、流量黑洞)
  const stopBody = core.slice(core.indexOf('stop_core()'), core.indexOf('case "$1"'))
  const iptablesAt = stopBody.indexOf('iptables.sh')
  const killAt = stopBody.indexOf('killall')
  assert.ok(iptablesAt !== -1 && killAt !== -1 && iptablesAt < killAt, 'stop 要先撤 iptables 再杀进程')
})

test('内核日志重定向到 data/singbox.log(与 deploy.mjs 读取位置一致)', () => {
  assert.match(core, /LOG="\$DATA\/singbox\.log"/, '日志路径要指向 data/singbox.log')
  assert.match(core, />\s*"\$LOG"\s*2>&1/, 'stdout/stderr 都要重定向进日志')
})

test('面板脚本以 2026 端口与 OPENBOX_ROOT 启动', () => {
  assert.match(panel, /2026/, '面板要监听 2026')
  assert.match(panel, /OPENBOX_ROOT/, '要导出 OPENBOX_ROOT')
})

test('面板运行时:node 包装脚本设置 LD_LIBRARY_PATH 指向捆绑的 node/lib', () => {
  // musl Node 需要显式指定动态库路径;该设置位于 node/bin/node 包装脚本(见 README 的目录说明)
  const wrapper = fs.readFileSync(path.join(repoRoot, 'node/bin/node'), 'utf8')
  assert.match(wrapper, /LD_LIBRARY_PATH/, '包装脚本要设置 LD_LIBRARY_PATH')
  assert.match(wrapper, /node\/lib|lib"/, '要指向捆绑的 node/lib')
  assert.match(wrapper, /ld-musl-aarch64\.so\.1/, '要用 musl 动态加载器')
})

test('两个脚本均为 POSIX sh,无 bashism', () => {
  for (const [name, src] of [['service-core.sh', core], ['service-panel.sh', panel]]) {
    assert.ok(!/\[\[/.test(src), `${name} 不得使用 [[ ]]`)
    assert.ok(!/function\s+\w+\s*\(/.test(src), `${name} 不得使用 function 关键字`)
    assert.ok(!/declare\s+-a/.test(src), `${name} 不得使用数组`)
  }
})
