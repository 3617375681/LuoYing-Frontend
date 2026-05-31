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

const decisionState = reduceMeetingState(createInitialMeetingState(), [
  {
    ...baseEvent,
    id: 'event-proposed-decision',
    type: 'decision_proposed',
    text: '先按灰度方案 A 推进。',
  },
], 1)
const decisionCandidate = chooseIntervention(decisionState, createInterventionPolicyMemory())
assert(decisionCandidate?.type === 'push_decision', 'aggressive mode should push even one proposed decision')

const vagueRiskState = reduceMeetingState(createInitialMeetingState(), [
  {
    ...baseEvent,
    id: 'event-vague-risk',
    type: 'risk_detected',
    text: '说点有风险的内容。',
    severity: 'medium',
  },
], 1)
assert(chooseIntervention(vagueRiskState, createInterventionPolicyMemory()) === null, 'vague ASR-like risk should not trigger intervention')

const noisyActionState = reduceMeetingState(createInitialMeetingState(), [
  {
    ...baseEvent,
    id: 'event-noisy-action-1',
    type: 'action_created',
    text: '决策一代办',
  },
  {
    ...baseEvent,
    id: 'event-noisy-action-2',
    type: 'action_created',
    text: '洛英，你来发个号吧',
    owner: '洛英',
  },
  {
    ...baseEvent,
    id: 'event-noisy-action-3',
    type: 'action_created',
    text: '每一个说话人啊开会前加一个小白的方法',
  },
], 3)
assert(noisyActionState.actionItems.length === 0, 'noisy ASR fragments should not become action items')

const balancedActionState = reduceMeetingState(createInitialMeetingState(), [
  {
    ...baseEvent,
    id: 'event-real-action-1',
    type: 'action_created',
    text: '张三会后同步接口权限。',
    owner: '张三',
  },
  {
    ...baseEvent,
    id: 'event-real-action-2',
    type: 'action_created',
    text: '明天把灰度方案发给大家。',
    deadline: '明天',
  },
  {
    ...baseEvent,
    id: 'event-real-action-3',
    type: 'action_created',
    text: '你来确认一下排期。',
  },
], 3)
assert(balancedActionState.actionItems.length === 3, 'short but actionable tasks should be kept')

console.log('meeting-agent self-test passed')
