import assert from 'node:assert/strict'
import test from 'node:test'
import { COUNTRY_CATALOG, FALLBACK_REGION_DICT } from './countries.mjs'
import { matchRegion } from './rename.mjs'

// 说明:上游原本把服务端的国家目录与前端 panel/src/constant/countries.ts 逐条比对,
// 但本项目的前端只以编译产物 panel/dist/ 分发,仓库中不存在 panel/src/。
// 因此这里改为对服务端目录做自洽性断言:结构完整、无重复、关键词可用。
test('国家目录结构自洽:代码唯一、中文名非空、关键词齐全', () => {
  assert.ok(COUNTRY_CATALOG.length >= 50, `国家目录只有 ${COUNTRY_CATALOG.length} 条,疑似被截断`)
  const codes = COUNTRY_CATALOG.map((c) => c.code)
  assert.equal(new Set(codes).size, codes.length, '国家代码不得重复')
  for (const c of COUNTRY_CATALOG) {
    assert.match(c.code, /^[A-Z]{2}$/, `非法国家代码: ${c.code}`)
    assert.ok(typeof c.name === 'string' && c.name.length > 0, `${c.code} 缺少中文名`)
    assert.ok(Array.isArray(c.keywords) && c.keywords.length > 0, `${c.code} 缺少关键词`)
  }
})

test('国家目录里的关键词能被 matchRegion 正确识别(抽样)', () => {
  // 抽几个常见国家,验证目录数据与匹配逻辑是配套的
  const by = Object.fromEntries(COUNTRY_CATALOG.map((c) => [c.code, c]))
  for (const code of ['HK', 'US', 'JP', 'SG', 'TW']) {
    const entry = by[code]
    assert.ok(entry, `目录缺少 ${code}`)
    const probe = `🇭🇰 ${entry.keywords[0]} 01`
    const hit = matchRegion(probe, COUNTRY_CATALOG)
    assert.ok(hit, `${code} 的首个关键词「${entry.keywords[0]}」未被识别`)
  }
})

test('兜底词典去掉了会撞英文单词的短码和泛词,其余关键词照旧', () => {
  const by = Object.fromEntries(FALLBACK_REGION_DICT.map((c) => [c.code, c.keywords]))
  assert.ok(!by.IN.includes('in') && by.IN.includes('india'))
  assert.ok(!by.NZ.includes('new') && by.NZ.includes('new zealand'))
  assert.ok(!by.MY.includes('my') && by.MY.includes('malaysia') && by.MY.includes('马来西亚'))
  assert.ok(by.HK.includes('hk'))
  // 用它去认几个常见的
  assert.equal(matchRegion('🇲🇾 Malaysia 01', FALLBACK_REGION_DICT).code, 'MY')
  assert.equal(matchRegion('IPLC in HK', FALLBACK_REGION_DICT).code, 'HK')
  assert.equal(matchRegion('New York 01', FALLBACK_REGION_DICT), null)
})
