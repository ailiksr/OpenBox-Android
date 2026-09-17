import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_LOW_LATENCY,
  DEFAULT_MEDIUM_LATENCY,
  formatLatencyText,
  getLatencyBgClass,
  getLatencyColorClass,
  getNodeCardVisualClass,
  isNodeTimedOut,
  TIMED_OUT_DELAY,
} from './latency-display.mjs'

test('getLatencyColorClass: 三档颜色与超时错误色划分准确', () => {
  // 1. 超时 / 0 / 负数 -> text-error
  assert.equal(getLatencyColorClass(TIMED_OUT_DELAY), 'text-error')
  assert.equal(getLatencyColorClass(0), 'text-error')
  assert.equal(getLatencyColorClass(-1), 'text-error')
  assert.equal(getLatencyColorClass(null), 'text-error')
  assert.equal(getLatencyColorClass(undefined), 'text-error')

  // 2. 绿档 (< 100ms)
  assert.equal(getLatencyColorClass(45), 'text-green-500')
  assert.equal(getLatencyColorClass(99), 'text-green-500')

  // 3. 黄档 (>= 100ms 且 < 300ms)
  assert.equal(getLatencyColorClass(100), 'text-yellow-500')
  assert.equal(getLatencyColorClass(180), 'text-yellow-500')
  assert.equal(getLatencyColorClass(299), 'text-yellow-500')

  // 4. 红档 (>= 300ms)
  assert.equal(getLatencyColorClass(300), 'text-red-500')
  assert.equal(getLatencyColorClass(850), 'text-red-500')

  // 5. 自定义阈值
  assert.equal(getLatencyColorClass(120, 150, 400), 'text-green-500')
  assert.equal(getLatencyColorClass(250, 150, 400), 'text-yellow-500')
  assert.equal(getLatencyColorClass(500, 150, 400), 'text-red-500')
})

test('getLatencyBgClass: 背景指示点颜色对应文本颜色', () => {
  assert.equal(getLatencyBgClass(50), 'bg-green-500')
  assert.equal(getLatencyBgClass(150), 'bg-yellow-500')
  assert.equal(getLatencyBgClass(450), 'bg-red-500')
  assert.equal(getLatencyBgClass(0), 'bg-error')
})

test('formatLatencyText: 毫秒与超时文本格式化规范', () => {
  assert.equal(formatLatencyText(0, false), '') // 未测试时不显示
  assert.equal(formatLatencyText(0, true), '超时')
  assert.equal(formatLatencyText(125.4, true), '125ms')
  assert.equal(formatLatencyText(88, true), '88ms')
})

test('isNodeTimedOut: 正确识别节点是否经过测速并处于超时状态', () => {
  // 未测速过 -> 不算超时
  assert.equal(isNodeTimedOut([], 0), false)
  assert.equal(isNodeTimedOut(null, 0), false)
  assert.equal(isNodeTimedOut(undefined, 0), false)

  // 测速成功 -> 不算超时
  const successHistory = [{ time: '2026-09-11T00:00:00Z', delay: 150 }]
  assert.equal(isNodeTimedOut(successHistory, 150), false)

  // 测速超时 (最新样本 delay 为 0) -> 判定为超时
  const timeoutHistory = [{ time: '2026-09-11T00:00:00Z', delay: 0 }]
  assert.equal(isNodeTimedOut(timeoutHistory, 0), true)

  // 曾经成功，但最新一次测试超时 -> 判定为超时
  const mixedHistory = [
    { time: '2026-09-11T00:00:00Z', delay: 120 },
    { time: '2026-09-11T00:01:00Z', delay: 0 },
  ]
  assert.equal(isNodeTimedOut(mixedHistory, 0), true)

  // 曾经超时，但最新一次测试成功恢复 -> 判定为可用
  const recoveredHistory = [
    { time: '2026-09-11T00:00:00Z', delay: 0 },
    { time: '2026-09-11T00:01:00Z', delay: 90 },
  ]
  assert.equal(isNodeTimedOut(recoveredHistory, 90), false)
})

test('getNodeCardVisualClass: 超时且非激活节点自动添加置灰与半透明类名', () => {
  // 超时且未激活 -> 置灰半透明
  assert.equal(
    getNodeCardVisualClass(true, false),
    'opacity-45 grayscale hover:opacity-80 transition-opacity',
  )

  // 正常节点 -> 无附加置灰类名
  assert.equal(getNodeCardVisualClass(false, false), '')

  // 激活节点即便超时也保持高亮主色，不整卡置灰以保留用户视觉焦点
  assert.equal(getNodeCardVisualClass(true, true), '')
})
