import { chooseIntervention, createInterventionPolicyMemory, rememberIntervention } from '../src/features/meeting-agent/interventionPolicy'
import { createInitialMeetingState } from '../src/features/meeting-agent/meetingState'
import { reduceMeetingState } from '../src/features/meeting-agent/reducer'
import type { MeetingEvent } from '../src/features/meeting-agent/types'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const now = Date.now()
const baseEvent = {
  confidence: 0.9,
  createdAt: now,
  segmentIds: ['seg-1'],
} satisfies Pick<MeetingEvent, 'confidence' | 'createdAt' | 'segmentIds'>

const events: MeetingEvent[] = [
  {
    ...baseEvent,
    id: 'event-topic',
    type: 'topic_started',
    topicTitle: '上线排期',
    text: '我们先讨论上线排期。',
  },
  {
    ...baseEvent,
    id: 'event-action',
    type: 'action_created',
    text: '会后整理灰度方案。',
  },
  {
    ...baseEvent,
    id: 'event-risk',
    type: 'risk_detected',
    text: '如果接口权限今天拿不到，灰度会延期。',
    severity: 'high',
  },
]

const state = reduceMeetingState(createInitialMeetingState(), events, 3)
assert(state.topics.length === 1, 'topic should be tracked')
assert(state.currentTopicId === 'event-topic', 'current topic should point to topic event')
assert(state.actionItems.length === 1, 'action item should be tracked')
assert(state.actionItems[0].owner === undefined, 'action owner should remain missing')
assert(state.risks.length === 1, 'risk should be tracked')
assert(state.phase === 'blocked', 'high open risk should move phase to blocked')
assert(state.metrics.transcriptSegments === 3, 'transcript metric should be updated')

const memory = createInterventionPolicyMemory()
const candidate = chooseIntervention(state, memory)
assert(candidate !== null, 'policy should produce an intervention')
assert(candidate.type === 'risk_alert', 'high risk should outrank missing-owner action')
rememberIntervention(memory, candidate)
assert(chooseIntervention(state, memory) === null, 'global cooldown should suppress immediate repeated intervention')

console.log('meeting-agent self-test passed')
