export type MeetingAgentPriority = 'low' | 'medium' | 'high'

export type MeetingAgentIntervention = {
  shouldIntervene: boolean
  priority: MeetingAgentPriority
  reason: string
  suggestedText: string
}

export type MeetingAgentState = {
  phase: string
  currentTopic: string
  summary: string
  decisions: string[]
  actionItems: string[]
  openLoops: string[]
  risks: string[]
  intervention: MeetingAgentIntervention
  evaluatedAt: string
}

export type TranscriptSegment = {
  id: string
  text: string
  isFinal: boolean
  receivedAt: number
}

export type AgentInterventionInbox = {
  state: MeetingAgentState
  receivedAt: number
  acknowledged: boolean
}
