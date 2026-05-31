import { shouldKeepActionItem } from './actionHeuristics'
import type { MeetingAgentPriority, MeetingEvent, MeetingEventType, MeetingPhase, TranscriptSegment } from './types'

type ExtractedPayload = {
  events?: Array<Partial<MeetingEvent> & { type?: string }>
  phaseHint?: MeetingPhase
}

export async function isLlmConfigured(): Promise<boolean> {
  try {
    const response = await fetch('/meeting-agent/llm/config')
    if (!response.ok) return false
    const payload = (await response.json()) as { configured?: boolean }
    return Boolean(payload.configured)
  } catch {
    return false
  }
}

export async function extractMeetingEvents(
  segments: TranscriptSegment[],
  context: string,
  signal?: AbortSignal,
): Promise<{ events: MeetingEvent[]; phaseHint?: MeetingPhase }> {
  const transcript = segments.map((segment, index) => `${index + 1}. ${segment.text}`).join('\n')
  const response = await fetch('/meeting-agent/llm/extract', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context, transcript }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`会议事件抽取失败 ${response.status}: ${errorText.slice(0, 200)}`)
  }

  const parsed = (await response.json()) as ExtractedPayload
  return {
    events: normalizeEvents(parsed.events, segments),
    phaseHint: parsed.phaseHint,
  }
}

function normalizeEvents(rawEvents: ExtractedPayload['events'], segments: TranscriptSegment[]): MeetingEvent[] {
  if (!Array.isArray(rawEvents)) return []
  const now = Date.now()
  return rawEvents
    .map((raw, index): MeetingEvent | null => {
      if (!raw.type || !isEventType(raw.type)) return null
      const text = typeof raw.text === 'string' ? raw.text.trim() : ''
      const confidence = clampConfidence(raw.confidence)
      if (!text || confidence < 0.55) return null
      const normalizedType = normalizeEventType(raw.type, text)
      if (!normalizedType) return null
      if (normalizedType === 'action_created' && !shouldKeepActionItem(text, cleanOptional(raw.owner), cleanOptional(raw.deadline), confidence)) return null
      return {
        id: `event-${now}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        type: normalizedType,
        text,
        topicTitle: cleanOptional(raw.topicTitle),
        owner: cleanOptional(raw.owner),
        deadline: cleanOptional(raw.deadline),
        severity: normalizePriority(raw.severity),
        confidence,
        createdAt: now,
        segmentIds: segments.map((segment) => segment.id),
      }
    })
    .filter((event): event is MeetingEvent => event !== null)
}

function normalizeEventType(type: MeetingEventType, text: string): MeetingEventType | null {
  if (type === 'action_created' && /^(珞樱|洛英|落英)[，,]?.*(发言|回答|说一下|来讲|发个号|插话)/.test(text.trim())) return 'speaker_signal'
  return type
}

function isEventType(value: string): value is MeetingEventType {
  return [
    'topic_started',
    'topic_shifted',
    'decision_proposed',
    'decision_confirmed',
    'decision_reversed',
    'action_created',
    'action_completed',
    'open_loop_created',
    'open_loop_resolved',
    'risk_detected',
    'risk_resolved',
    'conflict_detected',
    'speaker_signal',
    'wrap_up_signal',
  ].includes(value)
}

function normalizePriority(value: unknown): MeetingAgentPriority | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

function clampConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0.7
  return Math.max(0, Math.min(1, value))
}

function cleanOptional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
