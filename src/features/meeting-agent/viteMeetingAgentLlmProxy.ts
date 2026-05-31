import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-chat'

const EXTRACT_SYSTEM_PROMPT = `你是珞樱的会议事件抽取器。你不总结整场会议，只把新增转写转成可维护状态的事件。

只输出 JSON：
{
  "events": [
    {
      "type": "topic_started | topic_shifted | decision_proposed | decision_confirmed | decision_reversed | action_created | action_completed | open_loop_created | open_loop_resolved | risk_detected | risk_resolved | conflict_detected | speaker_signal | wrap_up_signal",
      "text": "事件内容，短句，必须来自新增转写，不要脑补",
      "topicTitle": "如果是议题事件，给 4~12 字议题名，否则可空",
      "owner": "负责人/角色/说话人，无法确定则空",
      "deadline": "截止时间，无法确定则空",
      "severity": "low | medium | high，仅 risk/conflict 需要",
      "confidence": 0.0
    }
  ],
  "phaseHint": "opening | discovery | discussion | decision | blocked | wrap_up"
}

抽取标准：
- topic_started/topic_shifted：出现新议题或明显转场。
- decision_proposed：有人提出可能方案但未确认。
- decision_confirmed：出现“就这么定/确认/决定/按这个来”等明确确认。
- action_created：只有在“明确后续动作/待办”时输出。必须满足：有可执行交付物，且最好有负责人、截止时间、或明显触发词（待办/会后/下一步/谁来/负责/同步/整理/确认/补充/提交/发送/测试/部署/联系/排期）。
  - 不要把“叫珞樱说话/发言/发个号/回答一下”抽成 action_created；这类最多是 speaker_signal，通常可忽略。
  - 不要把“决策一代办”“每一个说话人啊……”“就是/然后/可以/有点……”这类 ASR 碎片、方法半句话、无明确交付物的口语片段抽成 action_created。
  - owner 只能来自原文明确出现的负责人；不要把“珞樱/洛英”当 owner，除非原文明确是在给珞樱分配会后任务。
- open_loop_created：出现问题、争议、需要确认但未有答案。
- risk_detected：出现阻塞、依赖、返工、延期、冲突、数据/权限/资源风险。
- conflict_detected：多人意见明显相反或重复拉扯。
- wrap_up_signal：出现收尾、复盘、总结、下一步确认。
- 不要把寒暄、重复口头禅、无信息含量句子抽成事件。
- confidence 小于 0.55 的事件不要输出。`

const SPEAK_SYSTEM_PROMPT = `你是珞樱（Luoying），武汉大学人工智能学院的数字伙伴，现在正在实时参加一场会议。
你要基于最近会议原文、当前会议状态和介入理由，生成“珞樱此刻应该说的一句话”。

输出要求：
- 只输出 JSON：{"text":"..."}
- text 是珞樱要直接说出口的话，不要解释 JSON，不要列分析过程。
- 必须紧贴最近转写内容，不能泛泛而谈，不能复读固定自我介绍。
- 如果上下文不够明确，就用一句短话追问澄清。
- 口吻像会议里的聪明同事：短、准、能推进，不要长篇大论。
- 可以轻微保留珞樱的温柔感，但不要诗化到影响会议效率。
- 1~2 句，最多 80 个中文字符。
- 不编造没有出现在状态或转写里的事实。`

type MeetingAgentLlmProxyOptions = {
  apiKey?: string
  baseUrl?: string
  model?: string
}

type ExtractRequest = {
  context?: string
  transcript?: string
}

type SpeakRequest = {
  state?: unknown
  candidate?: unknown
  transcript?: string
}

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

export function createMeetingAgentLlmProxy(options: MeetingAgentLlmProxyOptions = {}): Plugin {
  return {
    name: 'meeting-agent-llm-proxy',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/meeting-agent/llm/config', (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method-not-allowed' })
        sendJson(res, 200, { configured: Boolean(resolveApiKey(options)) })
      })

      server.middlewares.use('/meeting-agent/llm/extract', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
        const apiKey = resolveApiKey(options)
        if (!apiKey) return sendJson(res, 500, { error: 'missing-deepseek-api-key' })

        try {
          const body = (await readJson(req)) as ExtractRequest
          const context = typeof body.context === 'string' ? body.context : ''
          const transcript = typeof body.transcript === 'string' ? body.transcript : ''
          if (!transcript.trim()) return sendJson(res, 400, { error: 'missing-transcript' })

          const payload = await callDeepSeekJson({
            apiKey,
            baseUrl: options.baseUrl || env('DEEPSEEK_BASE_URL', DEFAULT_BASE_URL),
            model: options.model || env('DEEPSEEK_MODEL', DEFAULT_MODEL),
            systemPrompt: EXTRACT_SYSTEM_PROMPT,
            userPrompt: `当前会议状态摘要：\n${context}\n\n新增转写：\n${transcript}`,
            temperature: 0.2,
          })
          sendJson(res, 200, payload)
        } catch (cause) {
          sendJson(res, 500, { error: (cause as Error).message })
        }
      })

      server.middlewares.use('/meeting-agent/llm/speak', async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method-not-allowed' })
        const apiKey = resolveApiKey(options)
        if (!apiKey) return sendJson(res, 500, { error: 'missing-deepseek-api-key' })

        try {
          const body = (await readJson(req)) as SpeakRequest
          const payload = await callDeepSeekJson({
            apiKey,
            baseUrl: options.baseUrl || env('DEEPSEEK_BASE_URL', DEFAULT_BASE_URL),
            model: options.model || env('DEEPSEEK_MODEL', DEFAULT_MODEL),
            systemPrompt: SPEAK_SYSTEM_PROMPT,
            userPrompt: `当前会议状态：\n${JSON.stringify(body.state ?? {}, null, 2)}\n\n介入候选：\n${JSON.stringify(body.candidate ?? {}, null, 2)}\n\n最近会议原文：\n${typeof body.transcript === 'string' ? body.transcript : ''}`,
            temperature: 0.45,
          })
          const text = typeof (payload as { text?: unknown }).text === 'string' ? (payload as { text: string }).text.trim() : ''
          sendJson(res, 200, { text })
        } catch (cause) {
          sendJson(res, 500, { error: (cause as Error).message })
        }
      })
    },
  }
}

function resolveApiKey(options: MeetingAgentLlmProxyOptions) {
  return options.apiKey || env('DEEPSEEK_API_KEY')
}

async function callDeepSeekJson({
  apiKey,
  baseUrl,
  model,
  systemPrompt,
  userPrompt,
  temperature,
}: {
  apiKey: string
  baseUrl: string
  model: string
  systemPrompt: string
  userPrompt: string
  temperature: number
}) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`DeepSeek 调用失败 ${response.status}: ${errorText.slice(0, 200)}`)
  }

  const raw = (await response.json()) as DeepSeekResponse
  const content = raw.choices?.[0]?.message?.content
  if (!content) throw new Error('DeepSeek 返回为空')
  return parseJsonObject(content)
}

function parseJsonObject(content: string): unknown {
  const trimmed = content.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
    if (fenced) return JSON.parse(fenced)

    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('DeepSeek 返回的 JSON 无法解析')
  }
}

function readJson(req: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
      if (body.length > 128_000) reject(new Error('request-too-large'))
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(payload))
}

function env(name: string, fallback = '') {
  return process.env[name] || fallback
}
