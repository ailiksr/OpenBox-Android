import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 发版契约测试。
//
// 背景(真实事故,2026-09): 上一次发版把 update.json 指到了 v2.0.9,但那个 Release 的
// zip 资产并不存在(本仓库 Actions 被平台禁用,推 tag 不触发构建,Release 只是 tag
// 自动生成的空壳)。而 module.prop 的 updateJson 指向 main/update.json ——
// 等于给**全部存量用户**挂了一个 404,模块管理器点更新必然失败。
//
// 这类错误改一行 json 就能造成线上事故,且事后只能靠用户报「更新失败」才发现。
// 所以这里把几条**不依赖网络**的硬规则固化下来。
//
// ⚠️ 边界(务必知道,别误以为这里能兜住一切):
//   本文件**拦不住**本次事故的核心形态 —— 即"版本号编排全都对,只是资产不存在"。
//   那种状态下 module.prop=2090、changelog 有 v2.0.9、资产名也合规,静态看与正常发版
//   完全一致。已实测:把 update.json 指回事故状态,这十条规则**全部通过**,一条都没拦住。
//   "资产到底在不在"只能靠**真发 HTTP 请求**判定,见 scripts/check-release.mjs。
//   二者分工:本文件管命名 / 编排 / 同源;那个脚本管资产是否真的可下载。
const here = path.dirname(fileURLToPath(import.meta.url))
// panel/server/system/ → 仓库根要上溯三层
const repoRoot = path.resolve(here, '../../..')
const read = (name) => fs.readFileSync(path.join(repoRoot, name), 'utf8')

const update = JSON.parse(read('update.json'))
const moduleProp = read('module.prop')
const workflow = read(path.join('.github', 'workflows', 'release.yml'))

// module.prop 的 k=v 行,只取第一个 '='
const prop = (key) => {
  const line = moduleProp.split(/\r?\n/).find((l) => l.startsWith(`${key}=`))
  return line ? line.slice(key.length + 1).trim() : undefined
}

// update.json 的 zipUrl 里的文件名。就是用户点「更新」时真正去下的那个名字。
const zipAssetName = path.posix.basename(new URL(update.zipUrl).pathname)

test('发版契约:update.json 必填字段齐全且类型正确', () => {
  for (const key of ['version', 'versionCode', 'zipUrl', 'changelog']) {
    assert.ok(update[key] !== undefined, `update.json 缺少 ${key}`)
  }
  // versionCode 必须是数字:KernelSU 系拿它比大小,写成字符串会导致「永远提示有更新」
  assert.equal(typeof update.versionCode, 'number', 'versionCode 必须是数字,不能是字符串')
  assert.ok(Number.isInteger(update.versionCode) && update.versionCode > 0, 'versionCode 要是正整数')
})

test('发版契约:update.json 不得宣称比 module.prop 更新的版本(允许滞后,不允许超前)', () => {
  // 正常发版时两者应当一致。但存在一种**合法的持有状态**:
  // 代码已经升到 v2.0.9(module.prop / changelog 都是 2.0.9),但 v2.0.9 的 zip 资产
  // 还没造出来,于是 update.json 故意停在 v2.0.8 —— 先把 OTA 广告位按住,
  // 免得存量用户去下一个不存在的包(这正是本次事故的止血手段)。
  //
  // 所以这里只拦"超前":update.json 宣称的版本号高于代码实际版本时,
  // 用户会被引导去下载一个代码里根本不存在的版本。
  const declared = update.versionCode
  const code = Number(prop('versionCode'))
  assert.ok(
    declared <= code,
    `update.json 宣称 versionCode=${declared},但 module.prop 只有 ${code}: ` +
      '不允许宣称比代码更新的版本(滞后可以,超前不行)',
  )
})

test('发版契约:update.json 的 versionCode 与 version 必须同源(不能一个 2.0.9 一个 2.0.8)', () => {
  // 二者错位时:管理器按 versionCode 判断有没有更新,却把 version 显示给用户看,
  // 会出现「提示更新到 v2.0.9,刷下来却是 v2.0.8」这种自相矛盾。
  //
  // 本项目的版本号编排是 major*1000 + minor*100 + patch*10:
  //   v2.0.7 → 2070、v2.0.8 → 2080、v2.0.9 → 2090
  // (按真实既有数据反推,不是 2.0.8→208 那种直接拼数字。)
  const m = update.version.replace(/^v/, '').split('-')[0].match(/^(\d+)\.(\d+)\.(\d+)$/)
  assert.ok(m, `version 形如 vX.Y.Z,实际是 ${update.version}`)
  const expected = Number(m[1]) * 1000 + Number(m[2]) * 100 + Number(m[3]) * 10
  assert.equal(
    update.versionCode,
    expected,
    `version=${update.version} 按本项目编排应得 versionCode=${expected},实际 ${update.versionCode}`,
  )
})

test('发版契约:资产名必须是短版本号,不能带 -coloros-ready 后缀', () => {
  // tag 名带 -coloros-ready,但 v2.0.7 / v2.0.8 两个既有 Release 的资产名与
  // update.json 的 zipUrl 用的都是短版本号。工作流原先直接取 GITHUB_REF_NAME,
  // 会产出长名资产,和 update.json 对不上 —— 这正是硬校验要拦的情况。
  const shortVersion = update.version.split('-')[0]
  assert.equal(
    zipAssetName,
    `OpenBox-Android-SukiSU-${shortVersion}.zip`,
    'zipUrl 的资产名要用短版本号,否则与工作流产出名对不上',
  )
  assert.ok(!zipAssetName.includes('-coloros-ready'), '资产名不得带 -coloros-ready 后缀')
})

test('发版契约:zipUrl 的 tag 段与 update.json 的 version 一致', () => {
  // URL 形如 .../releases/download/<tag>/<asset>
  const segs = new URL(update.zipUrl).pathname.split('/').filter(Boolean)
  const tag = segs[segs.indexOf('download') + 1]
  assert.equal(tag, update.version, 'zipUrl 里的 tag 段要与 update.json 的 version 一致')
})

test('发版契约:update.json 的 changelog 指向 main 分支的 changelog.md', () => {
  assert.equal(
    update.changelog,
    'https://raw.githubusercontent.com/ailiksr/OpenBox-Android/main/changelog.md',
  )
})

test('发版契约:module.prop 的 updateJson 指向本仓库 main 的 update.json', () => {
  // 这条最关键:它决定了「改 update.json 就是改所有存量用户看到的更新信息」。
  assert.equal(prop('updateJson'), 'https://raw.githubusercontent.com/ailiksr/OpenBox-Android/main/update.json')
})

test('发版契约:工作流的产出名去掉了 tag 后缀,且与 update.json 做硬校验', () => {
  // 命名:必须用 ${TAG%%-*} 剥后缀。若改回直接用 GITHUB_REF_NAME,资产会变成长名。
  assert.match(workflow, /VERSION="\$\{TAG%%-\*\}"|VERSION="\$\{GITHUB_REF_NAME%%-\*\}"|VERSION="\$\{[A-Z_]+%%-\*\}",/, '要用 ${X%%-*} 剥掉 -coloros-ready 后缀')
  assert.match(workflow, /ZIP_NAME="OpenBox-Android-SukiSU-\$\{VERSION\}\.zip"/, '产出名要拼成 OpenBox-Android-SukiSU-<短版本>.zip')
  // 校验:产出名必须与 update.json 声明的文件名逐字比对,不一致就 exit 1
  assert.match(workflow, /DECLARED=/, '要读出 update.json 里声明的资产名')
  assert.match(workflow, /\[ "\$\{DECLARED\}" != "\$\{ZIP_NAME\}" \]/, '要与产出名做不等比较')
  assert.match(workflow, /::error::/, '不一致要报 ::error::')
})

test('发版契约:工作流在 tag 推送时上传 zip 并创建 Release', () => {
  assert.match(workflow, /tags:\s*\n\s*-\s*'v\*'/, '要监听 v* tag 推送')
  assert.match(workflow, /OpenBox-Android-SukiSU-\*\.zip/, '要上传 zip 资产')
  // 没有它,资产传不上去,Release 会是空壳 —— 本次事故的直接原因之一
  assert.match(workflow, /action-gh-release/, '要创建/更新 GitHub Release')
  assert.match(workflow, /contents:\s*write/, '创建 Release 需要 contents: write 权限')
})

test('发版契约:changelog.md 的条目版本不低于 update.json 宣称的版本', () => {
  // changelog 记录的是**代码**里已完成的改动,可能领先于 OTA 广告位(见上面的持有状态),
  // 但绝不能落后 —— 否则用户更新到的版本在 changelog 里查不到任何说明。
  const changelog = read('changelog.md')
  const versions = [...changelog.matchAll(/^###\s+(v[0-9][^\s(]*)/gm)].map((m) => m[1])
  assert.ok(versions.length > 0, 'changelog.md 里要能找到 ### vX.Y.Z 形式的版本条目')
  assert.ok(
    versions.includes(update.version),
    `changelog.md 里找不到 update.json 宣称的 ${update.version}(现有条目:${versions.join(', ')})`,
  )
})
