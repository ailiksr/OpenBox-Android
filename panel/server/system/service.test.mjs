import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from './context.mjs'
import { createPaths } from './paths.mjs'
import { startService, stopService, restartService, enableService, disableService, serviceStatus } from './service.mjs'

// Android 版:服务脚本不再是 OpenWrt 的 /etc/init.d/*,而是模块自带的
// scripts/service-core.sh(内核)与 scripts/service-panel.sh(面板),
// 且 service.mjs 一律用 `sh <脚本> <动作>` 调用(见 service.mjs 的 runAction)。
const MODROOT = '/data/adb/modules/openbox_android'
const CORE = `${MODROOT}/scripts/service-core.sh`
const PANEL = `${MODROOT}/scripts/service-panel.sh`

test('createPaths 默认根与派生路径(Android 模块目录)', () => {
  const p = createPaths()
  assert.equal(p.root, MODROOT)
  assert.equal(p.singbox, `${MODROOT}/bin/sing-box`)
  assert.equal(p.configPath, `${MODROOT}/etc/config.json`)
  assert.equal(p.rulesetDir, `${MODROOT}/data/rulesets`)
  // 服务脚本走模块自带 shell 脚本,不再依赖 OpenWrt 的 /etc/init.d
  assert.equal(p.initd.core, CORE)
  assert.equal(p.initd.panel, PANEL)
  assert.ok(!p.initd.core.includes('/etc/init.d'), '不得再指向 OpenWrt init.d')
})

test('createPaths 可注入根(测试用)', () => {
  const p = createPaths('/tmp/ob')
  assert.equal(p.configPath, '/tmp/ob/etc/config.json')
  assert.equal(p.initd.core, '/tmp/ob/scripts/service-core.sh')
})

test('服务动作发出 `sh <脚本> <动作>`(Android 无 procd/init.d)', async () => {
  const ctx = createMockContext()
  const p = createPaths()
  await startService(ctx, p.initd.core)
  await stopService(ctx, p.initd.core)
  await restartService(ctx, p.initd.core)
  await enableService(ctx, p.initd.panel)
  await disableService(ctx, p.initd.panel)
  assert.deepEqual(ctx.calls, [
    { cmd: 'sh', args: [CORE, 'start'] },
    { cmd: 'sh', args: [CORE, 'stop'] },
    { cmd: 'sh', args: [CORE, 'restart'] },
    { cmd: 'sh', args: [PANEL, 'enable'] },
    { cmd: 'sh', args: [PANEL, 'disable'] },
  ])
})

test('失败返回 ok:false 与 stderr', async () => {
  const ctx = createMockContext({ defaultExec: { code: 1, stderr: 'no such service' } })
  const r = await startService(ctx, CORE)
  assert.equal(r.ok, false)
  assert.equal(r.stderr, 'no such service')
})

test('serviceStatus 判定 running', async () => {
  const yes = createMockContext({ execResults: { [`sh ${CORE} status`]: { code: 0, stdout: 'running' } } })
  assert.equal((await serviceStatus(yes, CORE)).running, true)
  const no = createMockContext({ execResults: { [`sh ${CORE} status`]: { code: 1, stdout: 'inactive' } } })
  assert.equal((await serviceStatus(no, CORE)).running, false)
})

test('"active with no instances"(已注册但零进程)不算 running', async () => {
  const ctx = createMockContext({ execResults: { [`sh ${CORE} status`]: { code: 0, stdout: 'active with no instances' } } })
  const r = await serviceStatus(ctx, CORE)
  assert.equal(r.running, false)
})
