import type { MeetingAgentState } from './types'

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-chat'

const SYSTEM_PROMPT = `你是珞樱，一名实时陪会助手。
任务：根据会议转写片段，判断会议状态，并决定是否需要在聊天里主动开口提醒。

只输出 JSON，schema 如下：
{
  "phase": "idle | discussion | decision | blocked | wrap_up",
  "currentTopic": "本段对话的核心议题（若不明则空串）",
  "summary": "30~80 字概括目前讨论",
  "decisions": ["已经达成的决策（无则空数组）"],
  "actionItems": ["明确的待办（含负责人/时间为佳）"],
  "openLoops": ["被提及但未结论的问题"],
  "risks": ["可能阻塞或返工的风险"],
  "intervention": {
    "shouldIntervene": false,
    "priority": "low | medium | high",
    "reason": "为什么需要 / 不需要介入",
    "suggestedText": "如果介入，给珞樱要说的口语化中文短句（一两句）；不介入则空串"
  }
}

介入克制原则：
- 仅在以下情况 shouldIntervene=true：① 待办无负责人/时限；② 跑题超过 1 分钟；③ 出现明显风险或矛盾；④ 决策遗漏关键利益方；⑤ 会议陷入循环。
- 同一议题刚介入过则不要重复介入。
- 文字必须是口语化中文，像同事一样自然提醒。`

export type LlmConfig = {
  apiKey: string
  baseUrl?: string
  model?: string
}

export function readLlmConfig(): LlmConfig | null {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY as string | undefined
  if (!apiKey) return null
  return {
    apiKey,
    baseUrl: (import.meta.env.VITE_DEEPSEEK_BASE_URL as string | undefined) ?? DEFAULT_BASE_URL,
    model: (import.meta.env.VITE_DEEPSEEK_MODEL as string | undefined) ?? DEFAULT_MODEL,
  }
}

export async function evaluateWithLlm(
  config: LlmConfig,
  transcript: string,
  signal?: AbortSignal,
): Promise<MeetingAgentState> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
  const model = config.model ?? DEFAULT_MODEL

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `当前会议转写（按时间顺序）：\n${transcript}` },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`DeepSeek 调用失败 ${response.status}: ${errorText.slice(0, 200)}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('DeepSeek 返回为空')

  const parsed = JSON.parse(content) as Partial<MeetingAgentState>
  return normalizeState(parsed)
}

function normalizeState(raw: Partial<MeetingAgentState>): MeetingAgentState {
  const intervention = raw.intervention ?? {
    shouldIntervene: false,
    priority: 'low',
    reason: '',
    suggestedText: '',
  }
  return {
    phase: raw.phase ?? 'discussion',
    currentTopic: raw.currentTopic ?? '',
    summary: raw.summary ?? '',
    decisions: Array.isArray(raw.decisions) ? raw.decisions : [],
    actionItems: Array.isArray(raw.actionItems) ? raw.actionItems : [],
    openLoops: Array.isArray(raw.openLoops) ? raw.openLoops : [],
    risks: Array.isArray(raw.risks) ? raw.risks : [],
    intervention: {
      shouldIntervene: Boolean(intervention.shouldIntervene),
      priority: intervention.priority ?? 'low',
      reason: intervention.reason ?? '',
      suggestedText: intervention.suggestedText ?? '',
    },
    evaluatedAt: new Date().toISOString(),
  }
}
