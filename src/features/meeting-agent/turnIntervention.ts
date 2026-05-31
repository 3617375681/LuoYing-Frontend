import type { InterventionCandidate, MeetingAgentState, TranscriptSegment } from './types'

const DIRECT_CALL_PATTERN = /(珞樱|洛英|落英)/
const QUESTION_PATTERN = /[？?]|要不要|怎么办|怎么弄|怎么做|谁来|能不能|可不可以|是不是|是否|行不行|怎么定/
const DECISION_PATTERN = /就这么定|确认一下|拍板|定一下|按.*来|先这样|结论|方案[ABC一二三]?/
const ACTION_HINT_PATTERN = /会后|下一步|后续|待办|负责|谁来|你来|我来|同步|确认|整理|发给|推进|跟进|排期|上线|测试|部署/
const NOISE_PATTERN = /^(嗯+|啊+|好+|对+|然后|就是|那个|这个|可以|行|test)$/i

export function chooseTurnIntervention(
  _state: MeetingAgentState,
  segments: TranscriptSegment[],
): InterventionCandidate | null {
  const text = segments.map((segment) => segment.text).join(' ').trim()
  const normalized = normalizeText(text)
  if (!normalized || normalized.length < 6 || NOISE_PATTERN.test(normalized)) return null

  const now = Date.now()
  const targetIds = segments.map((segment) => segment.id)

  if (DIRECT_CALL_PATTERN.test(text)) {
    return {
      id: `turn-intervention-${now}-direct-${targetIds.join('-')}`,
      type: 'clarify',
      priority: 'high',
      text: buildDirectCallText(text),
      reason: '会议中直接点名珞樱，需要立即回应。',
      targetIds,
      confidence: 0.9,
      createdAt: now,
    }
  }

  if (QUESTION_PATTERN.test(text)) {
    return {
      id: `turn-intervention-${now}-question-${targetIds.join('-')}`,
      type: 'clarify',
      priority: 'medium',
      text: `我插一句，刚才这里像是一个需要现场确认的问题：「${clip(text)}」。要不要先明确结论、负责人和下一步？`,
      reason: '检测到问句或待确认表达。',
      targetIds,
      confidence: 0.72,
      createdAt: now,
    }
  }

  if (DECISION_PATTERN.test(text)) {
    return {
      id: `turn-intervention-${now}-decision-${targetIds.join('-')}`,
      type: 'push_decision',
      priority: 'medium',
      text: `我听到这里可能在形成结论：「${clip(text)}」。要不要我先按这个记为决策？如果不是结论，我们就标成待讨论。`,
      reason: '检测到潜在决策表达。',
      targetIds,
      confidence: 0.7,
      createdAt: now,
    }
  }

  if (ACTION_HINT_PATTERN.test(text)) {
    return {
      id: `turn-intervention-${now}-action-${targetIds.join('-')}`,
      type: 'assign_owner',
      priority: 'medium',
      text: `我先追一下：刚才这句「${clip(text)}」听起来像后续动作。需要现在补一下 owner 和时间吗？`,
      reason: '检测到疑似后续动作，但结构化待办不完整。',
      targetIds,
      confidence: 0.68,
      createdAt: now,
    }
  }

  return null
}

function buildDirectCallText(text: string) {
  if (/总结|小结|复盘/.test(text)) return '我在。我先帮大家小结：我们需要把当前结论、未闭环问题和下一步 owner 对齐，避免会后散掉。'
  if (/怎么看|建议|怎么办|怎么做/.test(text)) return '我在。我的建议是先把问题拆成三块：目标是什么、现在卡在哪里、下一步谁负责验证。这样比较快能收束。'
  if (/回答|说一下|发言|讲/.test(text)) return '我在。我先插一句：请大家把当前要我判断的问题说完整一点，我会直接给出结论、风险和下一步建议。'
  return `我在。刚才听到有人叫我：${clip(text)}。你们是希望我总结、判断风险，还是帮忙定下一步？`
}

function clip(text: string) {
  return text.length > 48 ? `${text.slice(0, 48)}…` : text
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, '').replace(/[，。！？、,.!?]/g, '')
}
