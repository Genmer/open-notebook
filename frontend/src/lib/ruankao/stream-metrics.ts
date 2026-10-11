// 流式生成指标（题库工作台生成态面板的数据口径，纯函数便于测试钉死）。
// 「token」按 SSE delta 事件计数：主流供应商 astream 的每个分片≈1 token，
// 是无需 tokenizer 的诚实近似（文档化口径，不假装精确）。

export interface StreamMetricsSample {
  /** 累计 delta 事件数（≈tokens） */
  tokens: number
  /** 累计字符数 */
  chars: number
  /** 最近 60 字符的输出尾部（数据流可见性） */
  tail: string
  /** 滑窗速度（tok/s，保留 1 位小数由展示层格式化） */
  speedTps: number
  /** 采样以来的滑窗峰值（tok/s） */
  peakTps: number
  /** 距 startedAt 的已生成毫秒数 */
  elapsedMs: number
}

/** 当前速度滑窗宽度：太窄抖动、太宽迟钝，3s 是打字测速的常用口径 */
export const SPEED_WINDOW_MS = 3000
/** 峰值/速度的最小时长分母：前 1s 内的瞬时脉冲不算峰值（防开局假峰） */
export const MIN_SPEED_SPAN_MS = 1000

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

/**
 * 由调用方维护的增量记录（时间戳数组/字符数/尾部串）计算一份展示快照。
 * previousPeakTps 传入上次快照的峰值，返回值取两者较大——峰值只增不减。
 */
export function computeStreamMetrics(
  deltaTimes: readonly number[],
  chars: number,
  tail: string,
  startedAt: number,
  now: number,
  previousPeakTps = 0,
): StreamMetricsSample {
  const elapsedMs = Math.max(0, now - startedAt)
  const windowStart = now - SPEED_WINDOW_MS
  let windowCount = 0
  for (let i = deltaTimes.length - 1; i >= 0; i -= 1) {
    if (deltaTimes[i] < windowStart) break
    windowCount += 1
  }
  // 分母 = min(滑窗, 实际时长)，且不小于 1s：开局不因分母过小虚高
  const spanMs = Math.min(SPEED_WINDOW_MS, Math.max(MIN_SPEED_SPAN_MS, elapsedMs))
  const speedTps =
    elapsedMs < MIN_SPEED_SPAN_MS
      ? 0
      : round1((windowCount / spanMs) * 1000)
  const peakTps = Math.max(previousPeakTps, speedTps)
  return {
    tokens: deltaTimes.length,
    chars,
    tail: tail.slice(-60),
    speedTps,
    peakTps,
    elapsedMs,
  }
}

/** 秒表格式化：<1h → m:ss；≥1h → h:mm:ss（600s 超时上限内几乎不会触达） */
export function formatStreamElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`
}
