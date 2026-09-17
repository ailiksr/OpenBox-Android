/**
 * 节点延迟分档、着色与状态判定模块
 * 提供对前端展示与后端历史记录一致的判定标准
 */

export const TIMED_OUT_DELAY = 0
export const DEFAULT_LOW_LATENCY = 100
export const DEFAULT_MEDIUM_LATENCY = 300

/**
 * 判定延迟颜色类名 (3档着色 + 超时错误色)
 * @param {number} delay 延迟毫秒数
 * @param {number} low 绿色低延迟阈值 (默认 100ms)
 * @param {number} medium 黄色中延迟阈值 (默认 300ms)
 * @returns {string} Tailwind 文本颜色类名
 */
export const getLatencyColorClass = (delay, low = DEFAULT_LOW_LATENCY, medium = DEFAULT_MEDIUM_LATENCY) => {
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0) {
    return 'text-error'
  }
  if (delay < low) {
    return 'text-green-500'
  }
  if (delay < medium) {
    return 'text-yellow-500'
  }
  return 'text-red-500'
}

/**
 * 判定延迟徽章背景类名 (用于指示圆点或图表)
 * @param {number} delay 延迟毫秒数
 * @param {number} low 绿色低延迟阈值
 * @param {number} medium 黄色中延迟阈值
 * @returns {string} Tailwind 背景颜色类名
 */
export const getLatencyBgClass = (delay, low = DEFAULT_LOW_LATENCY, medium = DEFAULT_MEDIUM_LATENCY) => {
  const textColor = getLatencyColorClass(delay, low, medium)
  switch (textColor) {
    case 'text-green-500':
      return 'bg-green-500'
    case 'text-yellow-500':
      return 'bg-yellow-500'
    case 'text-red-500':
      return 'bg-red-500'
    case 'text-error':
      return 'bg-error'
    default:
      return 'bg-gray-400'
  }
}

/**
 * 格式化延迟展示文案
 * @param {number} delay 延迟毫秒数
 * @param {boolean} hasHistory 是否已有测速记录
 * @returns {string} 展示字符串
 */
export const formatLatencyText = (delay, hasHistory = true) => {
  if (!hasHistory) {
    return ''
  }
  if (typeof delay !== 'number' || !Number.isFinite(delay) || delay <= 0) {
    return '超时'
  }
  return `${Math.round(delay)}ms`
}

/**
 * 判定节点是否处于不可用/超时状态
 * @param {Array<{time: string, delay: number}>|null|undefined} history 节点测速历史数组
 * @param {number|null|undefined} currentDelay 当前测速延迟
 * @returns {boolean} 是否超时不可用
 */
export const isNodeTimedOut = (history, currentDelay) => {
  if (!Array.isArray(history) || history.length === 0) {
    return false
  }
  if (typeof currentDelay === 'number' && currentDelay <= 0) {
    return true
  }
  const latest = history[history.length - 1]
  return !!latest && typeof latest.delay === 'number' && latest.delay <= 0
}

/**
 * 获取节点卡片的视觉样式修饰类 (含置灰与半透明)
 * @param {boolean} isTimedOut 是否超时不可用
 * @param {boolean} isActive 是否为当前激活节点
 * @returns {string} 附加样式类名
 */
export const getNodeCardVisualClass = (isTimedOut, isActive = false) => {
  if (isTimedOut && !isActive) {
    return 'opacity-45 grayscale hover:opacity-80 transition-opacity'
  }
  return ''
}
