#!/usr/bin/env node
// 发布前探活:确认 update.json 指向的 zip 资产**真的能下载**。
//
// 为什么必须单独有这个脚本:
//   本次真实事故(2026-09)里,update.json 被指到一个并不存在的 v2.0.9 资产上,
//   而当时 module.prop 已经是 2090、changelog 也已经写了 v2.0.9 —— 也就是说
//   那份"错误状态"在**纯静态检查下与正常发版完全一样**,release-contract.test.mjs
//   的十条规则全部通过,一条都拦不住。
//   唯一能区分"资产存在"与"资产不存在"的,就是真的去发一个 HTTP 请求。
//   所以这里做网络探活,静态规则只负责拦命名/编排这类错误,二者互补。
//
// 用法:
//   node scripts/check-release.mjs                  # 探活 update.json 里声明的 zipUrl
//   node scripts/check-release.mjs --expect v2.0.9   # 探活"即将发布"的那个版本,而不是当前声明的
//   node scripts/check-release.mjs --json           # 机器可读输出
//
// 为什么需要 --expect:
//   发版顺序是「先让资产可下载 → 最后才改 update.json」。也就是说在真正改 update.json
//   **之前**,仓库里声明的一直是**上一个**版本。此时直接跑本脚本,它探的是旧版本,
//   旧版本当然存在 —— 一路绿灯,却根本没验证新版本能不能下(这是个假阳性陷阱)。
//   所以构建完成后、改 update.json 之前,要用 --expect v2.0.9 指定"即将发布"的版本。
//
// 退出码:0 = 资产可下载;1 = 不可下载(发版前必须先解决,否则存量用户 OTA 必 404)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')
const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const expectIdx = argv.indexOf('--expect')
const expectedVersion = expectIdx >= 0 ? argv[expectIdx + 1] : undefined

if (expectIdx >= 0 && !expectedVersion) {
  console.error('--expect 后面要跟版本号,例如 --expect v2.0.9')
  process.exit(2)
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const update = readJson(path.join(repoRoot, 'update.json'))

// module.prop 里 updateJson 指向哪,存量用户就会去拉哪 —— 必须和本地这份一致
const propLine = fs.readFileSync(path.join(repoRoot, 'module.prop'), 'utf8')
  .split(/\r?\n/).find((l) => l.startsWith('updateJson='))
const declaredUpdateJson = propLine ? propLine.slice('updateJson='.length).trim() : undefined

// --expect 模式:按"即将发布"的版本现算 zipUrl,不去看 update.json 里那份(它还没改)
const targetVersion = expectedVersion ?? update.version
const targetZipUrl = expectedVersion
  ? update.zipUrl.replace(/\/download\/[^/]+\//, `/download/${expectedVersion}/`)
      .replace(/OpenBox-Android-SukiSU-[^/]+\.zip$/, `OpenBox-Android-SukiSU-${expectedVersion.split('-')[0]}.zip`)
  : update.zipUrl

const report = {
  mode: expectedVersion ? `--expect ${expectedVersion}` : 'update.json 当前声明',
  version: targetVersion,
  versionCode: update.versionCode,
  zipUrl: targetZipUrl,
  changelogUrl: update.changelog,
  updateJsonDeclared: declaredUpdateJson,
  checks: [],
}
let failed = false

const record = (name, ok, detail) => {
  report.checks.push({ name, ok, detail })
  if (!ok) failed = true
  if (!asJson) console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

// 跟随重定向(Release 资产会 302 到 objects.githubusercontent.com)
const probe = async (url, method = 'HEAD') => {
  try {
    const res = await fetch(url, { method, redirect: 'follow' })
    return { status: res.status, len: res.headers.get('content-length'), ok: res.ok }
  } catch (e) {
    return { status: 0, error: e.message, ok: false }
  }
}

if (!asJson) {
  console.log(`发布探活:${targetVersion} (versionCode ${update.versionCode})  [${report.mode}]`)
  console.log(`  zipUrl = ${targetZipUrl}`)
  if (expectedVersion) {
    console.log(`  注:update.json 目前声明的仍是 ${update.version} —— 这是"先造资产、后改声明"的正常中间态`)
  }
  console.log('')
}

// 1) 存量用户看到的 update.json 就是仓库 main 上那份 —— 若 module.prop 指别处,探活就没意义
record(
  'module.prop 的 updateJson 指向本仓库 main/update.json',
  declaredUpdateJson === 'https://raw.githubusercontent.com/ailiksr/OpenBox-Android/main/update.json',
  declaredUpdateJson ?? '(缺失)',
)

// 2) 关键项:zip 资产真的能下载。这是唯一能证明"用户点更新不会 404"的检查。
const zip = await probe(targetZipUrl)
record(
  'zip 资产可下载(HTTP 2xx)',
  zip.ok,
  zip.ok ? `HTTP ${zip.status},${zip.len ?? '?'} 字节` : `HTTP ${zip.status}${zip.error ? ` ${zip.error}` : ''}`,
)

// 3) 资产名与命名约定一致(短版本号)。工作流也有一道同样的硬校验,这里提前拦。
const assetName = path.posix.basename(new URL(targetZipUrl).pathname)
record(
  '资产名是短版本号(不带 -coloros-ready)',
  assetName === `OpenBox-Android-SukiSU-${targetVersion.split('-')[0]}.zip`,
  assetName,
)

// 4) changelog 可访问:管理器会去拉它展示更新说明
const log = await probe(update.changelog)
record('changelog 可访问(HTTP 2xx)', log.ok, `HTTP ${log.status}`)

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log('')
  if (failed) {
    console.log(`❌ 探活未通过:${targetVersion} 的资产还不可用。`)
    console.log('   发版顺序必须是「先让资产真的能下载,最后才改 update.json」——')
    console.log('   否则 main 上的 update.json 会给全部存量用户挂一个 404。')
  } else {
    console.log(`✅ 探活通过:${targetVersion} 资产可下载,存量用户 OTA 不会 404。`)
  }
}
process.exit(failed ? 1 : 0)
