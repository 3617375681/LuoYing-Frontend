import { createInterventionPolicyMemory, chooseIntervention, rememberIntervention } from './interventionPolicy'
import { extractMeetingEvents, isLlmConfigured } from './llm'
import { createInitialMeetingState } from './meetingState'
import { reduceMeetingState } from './reducer'
import type { AgentLoopEvent, MeetingAgentState, TranscriptSegment } from './types'

const MIN_INTERVAL_MS = 8_000
const MIN_NEW_SEGMENTS = 3
const MAX_PENDING_SEGMENTS = 8

export type AgentLoopListener = (event: AgentLoopEvent) => void

export class MeetingAgentLoop {
  private state = createInitialMeetingState()
  private pendingSegments: TranscriptSegment[] = []
  private listeners = new Set<AgentLoopListener>()
  private timer: number | null = null
  private running = false
  private inFlight: AbortController | null = null
  private lastRunAt = 0
  private policyMemory = createInterventionPolicyMemory()
  private configured = false

  isRunning() {
    return this.running
  }

  on(listener: AgentLoopListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState(): MeetingAgentState {
    return this.state
  }

  async start() {
    if (this.running) return
    this.configured = await isLlmConfigured()
    if (!this.configured) {
      this.emit({ type: 'error', message: '缺少 DEEPSEEK_API_KEY，会议 Agent 无法分析会议事件' })
      return
    }
    this.running = true
    this.emit({ type: 'state', state: this.state })
    this.timer = window.setInterval(() => this.tick(), 1_000)
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
    this.state = createInitialMeetingState()
    this.pendingSegments = []
    this.lastRunAt = 0
    this.policyMemory = createInterventionPolicyMemory()
    this.configured = false
  }

  pushFinal(segment: TranscriptSegment) {
    this.pendingSegments.push(segment)
    if (this.pendingSegments.length > MAX_PENDING_SEGMENTS) {
      this.pendingSegments = this.pendingSegments.slice(-MAX_PENDING_SEGMENTS)
    }
  }

  private tick() {
    if (!this.running || this.inFlight) return
    if (this.pendingSegments.length < MIN_NEW_SEGMENTS) return
    if (Date.now() - this.lastRunAt < MIN_INTERVAL_MS) return
    void this.runOnce()
  }

  private async runOnce() {
    if (!this.configured) return

    const controller = new AbortController()
    this.inFlight = controller
    this.lastRunAt = Date.now()
    const batch = this.pendingSegments.splice(0)

    try {
      const result = await extractMeetingEvents(batch, buildContext(this.state), controller.signal)
      const nextState = reduceMeetingState(this.state, result.events, batch.length)
      this.state = result.phaseHint ? { ...nextState, phase: result.phaseHint } : nextState
      this.emit({ type: 'state', state: this.state })

      const candidate = chooseIntervention(this.state, this.policyMemory)
      if (candidate) {
        rememberIntervention(this.policyMemory, candidate)
        this.emit({ type: 'intervention', state: this.state, candidate })
      }
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') {
        this.pendingSegments = [...batch, ...this.pendingSegments].slice(-MAX_PENDING_SEGMENTS)
        this.emit({ type: 'error', message: (cause as Error).message })
      }
    } finally {
      this.inFlight = null
    }
  }

  private emit(event: AgentLoopEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // ignore
      }
    }
  }
}

function buildContext(state: MeetingAgentState) {
  const topic = state.topics.find((item) => item.id === state.currentTopicId)
  const openActions = state.actionItems.filter((item) => item.status === 'open').slice(-5)
  const openLoops = state.openLoops.filter((item) => item.status === 'open').slice(-5)
  const openRisks = state.risks.filter((item) => item.status === 'open').slice(-5)
  return [
    `phase=${state.phase}`,
    `currentTopic=${topic?.title ?? ''}`,
    `summary=${state.summary}`,
    `openActions=${openActions.map((item) => item.text).join(' | ')}`,
    `openLoops=${openLoops.map((item) => item.question).join(' | ')}`,
    `openRisks=${openRisks.map((item) => item.text).join(' | ')}`,
  ].join('\n')
}
