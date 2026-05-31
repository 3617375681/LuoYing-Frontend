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

const ACTION_TRIGGER_PATTERNS = [
  /待办|todo|action\s*item/i,
  /会后|下一步|后续|下次|明天|今天|本周|周[一二三四五六日天]|月底|上线前|开会前/,
  /负责|owner|谁来|你来|我来|他来|她来|我们来|麻烦|请.*一下/,
  /整理|确认|补充|提交|发送|同步|测试|部署|联系|排期|拉齐|跟进|落地|推进|发给|更新|修复|接入|配置|创建|加上/,
]

const BAD_ACTION_PATTERNS = [
  /^(决策)?[一二三四五六七八九十0-9]*代办$/,
  /^(决策|待办|代办|任务|事项)[一二三四五六七八九十0-9]*$/,
  /每一个说话人.*(方法|办法)?$/,
  /说话人啊/,
  /小白的方法/,
  /^(就是|然后|可以|那个|这个|有点|说点)+/,
  /^(珞樱|洛英|落英)[，,]?.*(发言|回答|说一下|来讲|发个号|插话)/,
]

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
      if (normalizedType === 'action_created' && !isValidActionItem(text, raw.owner)) return null
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
  if (type === 'action_created' && /^(珞樱|洛英|落英)[，,]?/.test(text.trim())) return 'speaker_signal'
  return type
}

function isValidActionItem(text: string, owner: unknown): boolean {
  const normalized = text.replace(/\s+/g, '').replace(/[，。！？、,.!?]/g, '')
  if (normalized.length < 6) return false
  if (BAD_ACTION_PATTERNS.some((pattern) => pattern.test(normalized))) return false
  if (typeof owner === 'string' && /^(珞樱|洛英|落英)$/.test(owner.trim()) && /发言|回答|发个号|说一下/.test(normalized)) return false
  return ACTION_TRIGGER_PATTERNS.some((pattern) => pattern.test(text))
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
