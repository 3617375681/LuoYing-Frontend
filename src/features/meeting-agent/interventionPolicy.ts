import type { InterventionCandidate, MeetingAgentPriority, MeetingAgentState, InterventionType } from './types'

const COOLDOWN_MS = 45_000
const SAME_TARGET_COOLDOWN_MS = 120_000
const MIN_RISK_TEXT_LENGTH = 12

const VAGUE_RISK_PATTERNS = [
  /有风险的?内容/,
  /说点.*风险/,
  /风险的东西/,
  /可能有风险$/,
  /这个.*风险$/,
]

const CONCRETE_RISK_PATTERNS = [
  /延期|延迟|赶不上|来不及/,
  /阻塞|卡住|依赖|拿不到|无法|不能/,
  /返工|回滚|线上|故障|宕机|失败|报错/,
  /权限|预算|资源|人手|接口|数据|合规|安全|法务/,
  /影响|损失|成本|范围|用户|客户/,
]

export type InterventionPolicyMemory = {
  lastIntervenedAt: number
  targetHistory: Record<string, number>
}

export function createInterventionPolicyMemory(): InterventionPolicyMemory {
  return { lastIntervenedAt: 0, targetHistory: {} }
}

export function chooseIntervention(
  state: MeetingAgentState,
  memory: InterventionPolicyMemory,
): InterventionCandidate | null {
  const now = Date.now()
  if (now - memory.lastIntervenedAt < COOLDOWN_MS) return null

  const candidates = buildCandidates(state, now)
    .filter((candidate) => candidate.text.trim())
    .filter((candidate) => targetReady(candidate, memory, now))
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))

  return candidates[0] ?? null
}

export function rememberIntervention(memory: InterventionPolicyMemory, candidate: InterventionCandidate) {
  memory.lastIntervenedAt = candidate.createdAt
  for (const targetId of candidate.targetIds) memory.targetHistory[targetId] = candidate.createdAt
}

function buildCandidates(state: MeetingAgentState, now: number): InterventionCandidate[] {
  const candidates: InterventionCandidate[] = []
  for (const risk of state.risks.filter((item) => item.status === 'open' && isConcreteRisk(item.text))) {
    candidates.push({
      id: `intervention-${now}-risk-${risk.id}`,
      type: 'risk_alert',
      priority: risk.severity,
      text: risk.severity === 'high'
        ? `我打断一下，这里有个高风险点：${risk.text}。我们要不要先明确怎么兜底，避免后面返工？`
        : `这里有个需要确认的风险：${risk.text}。我们先定一下影响范围和处理人吧。`,
      reason: '检测到具体、未解决的会议风险。',
      targetIds: [risk.id],
      confidence: 0.9,
      createdAt: now,
    })
  }

  for (const item of state.actionItems.filter((action) => action.status === 'open' && isActionableText(action.text) && (!action.owner || !action.deadline))) {
    const missing = !item.owner && !item.deadline ? '负责人和截止时间' : !item.owner ? '负责人' : '截止时间'
    candidates.push({
      id: `intervention-${now}-action-${item.id}`,
      type: 'assign_owner',
      priority: 'high',
      text: `这个待办「${item.text}」还缺${missing}。我们现在顺手定一下，避免会后没人接。`,
      reason: `待办缺少${missing}。`,
      targetIds: [item.id],
      confidence: 0.95,
      createdAt: now,
    })
  }

  for (const loop of state.openLoops.filter((item) => item.status === 'open' && isActionableText(item.question))) {
    candidates.push({
      id: `intervention-${now}-loop-${loop.id}`,
      type: 'clarify',
      priority: loop.owner ? 'medium' : 'high',
      text: loop.owner
        ? `刚才这个问题还开着：「${loop.question}」。${loop.owner} 要不要先给一个判断，或者定个会后确认方式？`
        : `这个问题还没闭环：「${loop.question}」。我们要不要现在定一个 owner 来确认？`,
      reason: '存在未闭环问题。',
      targetIds: [loop.id],
      confidence: 0.85,
      createdAt: now,
    })
  }

  const proposed = state.decisions.filter((decision) => decision.status === 'proposed' && isActionableText(decision.text))
  if (proposed.length >= 2) {
    candidates.push({
      id: `intervention-${now}-decision`,
      type: 'push_decision',
      priority: 'medium',
      text: `现在已经有几个方案了。要不要先收敛一下：哪些今天拍板，哪些会后再补材料？`,
      reason: '多个方案停留在 proposed，会议可能进入拉扯。',
      targetIds: proposed.map((item) => item.id),
      confidence: 0.78,
      createdAt: now,
    })
  }

  if (state.phase === 'wrap_up' && (state.actionItems.some((item) => item.status === 'open') || state.openLoops.some((item) => item.status === 'open'))) {
    candidates.push({
      id: `intervention-${now}-wrap`,
      type: 'wrap_up',
      priority: 'high',
      text: `收尾前我帮大家对齐一下：待办和未闭环问题还需要确认 owner、截止时间和会后同步方式。`,
      reason: '会议进入收尾但仍有待办/开环未确认。',
      targetIds: [state.sessionId],
      confidence: 0.9,
      createdAt: now,
    })
  }

  return candidates
}

function targetReady(candidate: InterventionCandidate, memory: InterventionPolicyMemory, now: number) {
  return candidate.targetIds.every((targetId) => now - (memory.targetHistory[targetId] ?? 0) >= SAME_TARGET_COOLDOWN_MS)
}

function scoreCandidate(candidate: InterventionCandidate) {
  return priorityScore(candidate.priority) * 100 + typeScore(candidate.type) * 10 + candidate.confidence
}

function priorityScore(priority: MeetingAgentPriority) {
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

function typeScore(type: InterventionType) {
  if (type === 'risk_alert') return 5
  if (type === 'assign_owner') return 4
  if (type === 'wrap_up') return 3
  if (type === 'clarify') return 2
  return 1
}

function isConcreteRisk(text: string) {
  const normalized = normalizeText(text)
  if (normalized.length < MIN_RISK_TEXT_LENGTH) return false
  if (VAGUE_RISK_PATTERNS.some((pattern) => pattern.test(normalized))) return false
  return CONCRETE_RISK_PATTERNS.some((pattern) => pattern.test(normalized))
}

function isActionableText(text: string) {
  const normalized = normalizeText(text)
  if (normalized.length < 8) return false
  if (/^(这个|那个|然后|就是|可以|有点|说点|内容)+$/.test(normalized)) return false
  return true
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, '').replace(/[，。！？、,.!?]/g, '')
}
