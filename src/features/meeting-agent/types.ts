export type MeetingAgentPriority = 'low' | 'medium' | 'high'

export type MeetingPhase = 'opening' | 'discovery' | 'discussion' | 'decision' | 'blocked' | 'wrap_up'

export type InterventionType =
  | 'clarify'
  | 'summarize'
  | 'push_decision'
  | 'assign_owner'
  | 'resolve_conflict'
  | 'time_check'
  | 'risk_alert'
  | 'wrap_up'

export type MeetingEventType =
  | 'topic_started'
  | 'topic_shifted'
  | 'decision_proposed'
  | 'decision_confirmed'
  | 'decision_reversed'
  | 'action_created'
  | 'action_completed'
  | 'open_loop_created'
  | 'open_loop_resolved'
  | 'risk_detected'
  | 'risk_resolved'
  | 'conflict_detected'
  | 'speaker_signal'
  | 'wrap_up_signal'

export type TranscriptSegment = {
  id: string
  text: string
  isFinal: boolean
  receivedAt: number
  speakerId?: string
}

export type MeetingEvent = {
  id: string
  type: MeetingEventType
  text: string
  topicTitle?: string
  owner?: string
  deadline?: string
  severity?: MeetingAgentPriority
  confidence: number
  createdAt: number
  segmentIds: string[]
}

export type MeetingTopic = {
  id: string
  title: string
  status: 'active' | 'closed'
  summary: string
  firstSeenAt: number
  lastSeenAt: number
  evidence: string[]
}

export type MeetingDecision = {
  id: string
  text: string
  status: 'proposed' | 'confirmed' | 'reversed'
  topicId?: string
  confidence: number
  createdAt: number
  updatedAt: number
}

export type MeetingActionItem = {
  id: string
  text: string
  owner?: string
  deadline?: string
  status: 'open' | 'done' | 'blocked'
  topicId?: string
  createdAt: number
  updatedAt: number
}

export type MeetingOpenLoop = {
  id: string
  question: string
  owner?: string
  status: 'open' | 'resolved'
  topicId?: string
  createdAt: number
  updatedAt: number
}

export type MeetingRisk = {
  id: string
  text: string
  severity: MeetingAgentPriority
  status: 'open' | 'resolved'
  topicId?: string
  createdAt: number
  updatedAt: number
}

export type SpeakerProfile = {
  id: string
  label: string
  roles: Array<'facilitator' | 'decision_maker' | 'owner' | 'contributor' | 'skeptic' | 'unknown'>
  signals: string[]
  lastSeenAt: number
}

export type InterventionCandidate = {
  id: string
  type: InterventionType
  priority: MeetingAgentPriority
  text: string
  reason: string
  targetIds: string[]
  confidence: number
  createdAt: number
}

export type MeetingAgentMetrics = {
  transcriptSegments: number
  events: number
  topics: number
  decisions: number
  actionItems: number
  openLoops: number
  risks: number
}

export type MeetingAgentState = {
  sessionId: string
  phase: MeetingPhase
  currentTopicId?: string
  summary: string
  topics: MeetingTopic[]
  decisions: MeetingDecision[]
  actionItems: MeetingActionItem[]
  openLoops: MeetingOpenLoop[]
  risks: MeetingRisk[]
  speakers: SpeakerProfile[]
  events: MeetingEvent[]
  metrics: MeetingAgentMetrics
  lastUpdatedAt: number
}

export type AgentInterventionInbox = {
  candidate: InterventionCandidate
  receivedAt: number
  acknowledged: boolean
}

export type AgentLoopEvent =
  | { type: 'state'; state: MeetingAgentState }
  | { type: 'intervention'; state: MeetingAgentState; candidate: InterventionCandidate }
  | { type: 'error'; message: string }
