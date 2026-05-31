import type { MeetingAgentState } from './types'

export function createInitialMeetingState(): MeetingAgentState {
  const now = Date.now()
  return {
    sessionId: `meeting-${now}-${Math.random().toString(36).slice(2, 8)}`,
    phase: 'opening',
    summary: '会议尚未形成稳定议题。',
    topics: [],
    decisions: [],
    actionItems: [],
    openLoops: [],
    risks: [],
    speakers: [],
    events: [],
    metrics: {
      transcriptSegments: 0,
      events: 0,
      topics: 0,
      decisions: 0,
      actionItems: 0,
      openLoops: 0,
      risks: 0,
    },
    lastUpdatedAt: now,
  }
}
