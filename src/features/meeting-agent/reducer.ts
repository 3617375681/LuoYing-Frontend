import type {
  MeetingActionItem,
  MeetingAgentState,
  MeetingDecision,
  MeetingEvent,
  MeetingOpenLoop,
  MeetingPhase,
  MeetingRisk,
  MeetingTopic,
  SpeakerProfile,
} from './types'

const MAX_EVENTS = 120
const MAX_EVIDENCE = 6

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

export function reduceMeetingState(
  previous: MeetingAgentState,
  events: MeetingEvent[],
  transcriptSegmentsAdded: number,
): MeetingAgentState {
  let state = { ...previous, events: [...previous.events, ...events].slice(-MAX_EVENTS) }

  for (const event of events) {
    state = applyEvent(state, event)
  }

  return {
    ...state,
    phase: inferPhase(state),
    summary: summarizeState(state),
    metrics: {
      transcriptSegments: previous.metrics.transcriptSegments + transcriptSegmentsAdded,
      events: state.events.length,
      topics: state.topics.length,
      decisions: state.decisions.filter((item) => item.status !== 'reversed').length,
      actionItems: state.actionItems.filter((item) => item.status !== 'done').length,
      openLoops: state.openLoops.filter((item) => item.status === 'open').length,
      risks: state.risks.filter((item) => item.status === 'open').length,
    },
    lastUpdatedAt: Date.now(),
  }
}

function applyEvent(state: MeetingAgentState, event: MeetingEvent): MeetingAgentState {
  if (event.type === 'topic_started' || event.type === 'topic_shifted') return upsertTopic(state, event)
  if (event.type === 'decision_proposed' || event.type === 'decision_confirmed' || event.type === 'decision_reversed') {
    return upsertDecision(state, event)
  }
  if (event.type === 'action_created' || event.type === 'action_completed') return upsertActionItem(state, event)
  if (event.type === 'open_loop_created' || event.type === 'open_loop_resolved') return upsertOpenLoop(state, event)
  if (event.type === 'risk_detected' || event.type === 'risk_resolved') return upsertRisk(state, event)
  if (event.type === 'speaker_signal') return upsertSpeaker(state, event)
  return state
}

function upsertTopic(state: MeetingAgentState, event: MeetingEvent): MeetingAgentState {
  const title = event.topicTitle || event.text
  const existing = findSimilar(state.topics, title, (item) => item.title)
  const now = event.createdAt

  if (existing) {
    const topics = state.topics.map((topic) =>
      topic.id === existing.id
        ? {
            ...topic,
            status: 'active' as const,
            summary: event.text,
            lastSeenAt: now,
            evidence: uniqueTail([...topic.evidence, event.text], MAX_EVIDENCE),
          }
        : { ...topic, status: 'closed' as const },
    )
    return { ...state, topics, currentTopicId: existing.id }
  }

  const topic: MeetingTopic = {
    id: event.id,
    title,
    status: 'active',
    summary: event.text,
    firstSeenAt: now,
    lastSeenAt: now,
    evidence: [event.text],
  }
  return {
    ...state,
    topics: [...state.topics.map((item) => ({ ...item, status: 'closed' as const })), topic],
    currentTopicId: topic.id,
  }
}

function upsertDecision(state: MeetingAgentState, event: MeetingEvent): MeetingAgentState {
  const existing = findSimilar(state.decisions, event.text, (item) => item.text)
  const status: MeetingDecision['status'] =
    event.type === 'decision_confirmed' ? 'confirmed' : event.type === 'decision_reversed' ? 'reversed' : 'proposed'

  if (existing) {
    return {
      ...state,
      decisions: state.decisions.map((item) =>
        item.id === existing.id
          ? { ...item, text: event.text, status, confidence: Math.max(item.confidence, event.confidence), updatedAt: event.createdAt }
          : item,
      ),
    }
  }

  return {
    ...state,
    decisions: [
      ...state.decisions,
      {
        id: event.id,
        text: event.text,
        status,
        topicId: state.currentTopicId,
        confidence: event.confidence,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      },
    ],
  }
}

function upsertActionItem(state: MeetingAgentState, event: MeetingEvent): MeetingAgentState {
  if (!isValidActionItem(event.text, event.owner)) return state

  const existing = findSimilar(state.actionItems, event.text, (item) => item.text)
  const status: MeetingActionItem['status'] = event.type === 'action_completed' ? 'done' : 'open'

  if (existing) {
    return {
      ...state,
      actionItems: state.actionItems.map((item) =>
        item.id === existing.id
          ? {
              ...item,
              text: event.text,
              owner: event.owner || item.owner,
              deadline: event.deadline || item.deadline,
              status,
              updatedAt: event.createdAt,
            }
          : item,
      ),
    }
  }

  return {
    ...state,
    actionItems: [
      ...state.actionItems,
      {
        id: event.id,
        text: event.text,
        owner: event.owner,
        deadline: event.deadline,
        status,
        topicId: state.currentTopicId,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      },
    ],
  }
}

function upsertOpenLoop(state: MeetingAgentState, event: MeetingEvent): MeetingAgentState {
  const existing = findSimilar(state.openLoops, event.text, (item) => item.question)
  const status: MeetingOpenLoop['status'] = event.type === 'open_loop_resolved' ? 'resolved' : 'open'

  if (existing) {
    return {
      ...state,
      openLoops: state.openLoops.map((item) =>
        item.id === existing.id
          ? { ...item, question: event.text, owner: event.owner || item.owner, status, updatedAt: event.createdAt }
          : item,
      ),
    }
  }

  return {
    ...state,
    openLoops: [
      ...state.openLoops,
      {
        id: event.id,
        question: event.text,
        owner: event.owner,
        status,
        topicId: state.currentTopicId,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      },
    ],
  }
}

function upsertRisk(state: MeetingAgentState, event: MeetingEvent): MeetingAgentState {
  const existing = findSimilar(state.risks, event.text, (item) => item.text)
  const status: MeetingRisk['status'] = event.type === 'risk_resolved' ? 'resolved' : 'open'

  if (existing) {
    return {
      ...state,
      risks: state.risks.map((item) =>
        item.id === existing.id
          ? { ...item, text: event.text, severity: event.severity || item.severity, status, updatedAt: event.createdAt }
          : item,
      ),
    }
  }

  return {
    ...state,
    risks: [
      ...state.risks,
      {
        id: event.id,
        text: event.text,
        severity: event.severity || 'medium',
        status,
        topicId: state.currentTopicId,
        createdAt: event.createdAt,
        updatedAt: event.createdAt,
      },
    ],
  }
}

function upsertSpeaker(state: MeetingAgentState, event: MeetingEvent): MeetingAgentState {
  const label = event.owner || '发言人'
  const existing = state.speakers.find((speaker) => speaker.label === label)
  if (existing) {
    return {
      ...state,
      speakers: state.speakers.map((speaker) =>
        speaker.id === existing.id
          ? { ...speaker, signals: uniqueTail([...speaker.signals, event.text], MAX_EVIDENCE), lastSeenAt: event.createdAt }
          : speaker,
      ),
    }
  }
  const speaker: SpeakerProfile = {
    id: event.id,
    label,
    roles: ['unknown'],
    signals: [event.text],
    lastSeenAt: event.createdAt,
  }
  return { ...state, speakers: [...state.speakers, speaker] }
}

function inferPhase(state: MeetingAgentState): MeetingPhase {
  const activeRisks = state.risks.filter((risk) => risk.status === 'open' && risk.severity === 'high')
  if (activeRisks.length > 0) return 'blocked'
  const recentWrap = state.events.slice(-8).some((event) => event.type === 'wrap_up_signal')
  if (recentWrap) return 'wrap_up'
  const confirmedDecision = state.decisions.some((item) => item.status === 'confirmed')
  if (confirmedDecision) return 'decision'
  if (state.topics.length === 0) return 'opening'
  return state.openLoops.some((item) => item.status === 'open') ? 'discovery' : 'discussion'
}

function summarizeState(state: MeetingAgentState): string {
  const topic = state.topics.find((item) => item.id === state.currentTopicId)
  const activeActions = state.actionItems.filter((item) => item.status === 'open').length
  const activeLoops = state.openLoops.filter((item) => item.status === 'open').length
  const activeRisks = state.risks.filter((item) => item.status === 'open').length
  if (!topic) return '会议正在开场，尚未形成稳定议题。'
  return `当前围绕「${topic.title}」推进；有 ${activeActions} 个待办、${activeLoops} 个未闭环问题、${activeRisks} 个风险需要跟踪。`
}

function findSimilar<T>(items: T[], text: string, pick: (item: T) => string): T | undefined {
  const key = normalize(text)
  if (!key) return undefined
  return items.find((item) => {
    const other = normalize(pick(item))
    return other === key || other.includes(key) || key.includes(other)
  })
}

function isValidActionItem(text: string, owner?: string): boolean {
  const normalized = normalize(text)
  if (normalized.length < 6) return false
  if (BAD_ACTION_PATTERNS.some((pattern) => pattern.test(normalized))) return false
  if (owner && /^(珞樱|洛英|落英)$/.test(owner.trim()) && /发言|回答|发个号|说一下/.test(normalized)) return false
  return ACTION_TRIGGER_PATTERNS.some((pattern) => pattern.test(text))
}

function normalize(text: string) {
  return text.replace(/[\s，。！？、,.!?]/g, '').slice(0, 32)
}

function uniqueTail(items: string[], size: number) {
  return Array.from(new Set(items.filter(Boolean))).slice(-size)
}
