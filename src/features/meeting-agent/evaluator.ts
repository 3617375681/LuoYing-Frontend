import { evaluateWithLlm, readLlmConfig } from './llm'
import type { MeetingAgentState, TranscriptSegment } from './types'

const MIN_INTERVAL_MS = 8_000
const COOLDOWN_MS = 45_000
const MIN_NEW_FINAL_SEGMENTS = 3
const MAX_TRANSCRIPT_CHARS = 4_000

export type EvaluatorEvent =
  | { type: 'state'; state: MeetingAgentState }
  | { type: 'intervention'; state: MeetingAgentState }
  | { type: 'error'; message: string }

export type EvaluatorListener = (event: EvaluatorEvent) => void

export class MeetingAgentEvaluator {
  private finalSegments: TranscriptSegment[] = []
  private finalsSinceLastEval = 0
  private lastEvaluatedAt = 0
  private lastInterventionAt = 0
  private lastInterventionTopic = ''
  private listeners = new Set<EvaluatorListener>()
  private inFlight: AbortController | null = null
  private timer: number | null = null
  private running = false

  on(listener: EvaluatorListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start() {
    if (this.running) return
    if (!readLlmConfig()) {
      this.emit({
        type: 'error',
        message: '缺少 VITE_DEEPSEEK_API_KEY，珞樱无法评估会议（请在 .env.local 中配置）',
      })
      return
    }
    this.running = true
    this.timer = window.setInterval(() => this.tick(), 2_000)
  }

  stop() {
    this.running = false
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    this.inFlight?.abort()
    this.inFlight = null
  }

  reset() {
    this.stop()
    this.finalSegments = []
    this.finalsSinceLastEval = 0
    this.lastEvaluatedAt = 0
    this.lastInterventionAt = 0
    this.lastInterventionTopic = ''
  }

  pushFinal(segment: TranscriptSegment) {
    this.finalSegments.push(segment)
    this.finalsSinceLastEval += 1
    // 控制内存：仅保留最近 200 条 final
    if (this.finalSegments.length > 200) {
      this.finalSegments = this.finalSegments.slice(this.finalSegments.length - 200)
    }
  }

  private tick() {
    if (!this.running || this.inFlight) return
    if (this.finalsSinceLastEval < MIN_NEW_FINAL_SEGMENTS) return
    const now = Date.now()
    if (now - this.lastEvaluatedAt < MIN_INTERVAL_MS) return
    void this.evaluate()
  }

  private async evaluate() {
    const config = readLlmConfig()
    if (!config) return
    const transcript = this.composeTranscript()
    if (!transcript.trim()) return

    const controller = new AbortController()
    this.inFlight = controller
    this.lastEvaluatedAt = Date.now()
    this.finalsSinceLastEval = 0

    try {
      const state = await evaluateWithLlm(config, transcript, controller.signal)
      this.emit({ type: 'state', state })

      const intervention = state.intervention
      const sameTopic = state.currentTopic && state.currentTopic === this.lastInterventionTopic
      const inCooldown = Date.now() - this.lastInterventionAt < COOLDOWN_MS
      if (
        intervention.shouldIntervene &&
        intervention.suggestedText.trim() &&
        !inCooldown &&
        !sameTopic
      ) {
        this.lastInterventionAt = Date.now()
        this.lastInterventionTopic = state.currentTopic
        this.emit({ type: 'intervention', state })
      }
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return
      this.emit({ type: 'error', message: (cause as Error).message })
    } finally {
      this.inFlight = null
    }
  }

  private composeTranscript() {
    // 尾部优先，截断到 MAX_TRANSCRIPT_CHARS
    const parts: string[] = []
    let total = 0
    for (let i = this.finalSegments.length - 1; i >= 0; i -= 1) {
      const line = this.finalSegments[i].text
      total += line.length + 1
      parts.unshift(line)
      if (total >= MAX_TRANSCRIPT_CHARS) break
    }
    return parts.join('\n')
  }

  private emit(event: EvaluatorEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // ignore
      }
    }
  }
}
