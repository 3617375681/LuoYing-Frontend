import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-chat'

const SYSTEM_PROMPT = `你是珞樱的会议事件抽取器。你不总结整场会议，只把新增转写转成可维护状态的事件。

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
- action_created：出现待办、负责人、后续动作；负责人或截止时间缺失也要抽取。
- open_loop_created：出现问题、争议、需要确认但未有答案。
- risk_detected：出现阻塞、依赖、返工、延期、冲突、数据/权限/资源风险。
- conflict_detected：多人意见明显相反或重复拉扯。
- wrap_up_signal：出现收尾、复盘、总结、下一步确认。
- 不要把寒暄、重复口头禅、无信息含量句子抽成事件。
- confidence 小于 0.55 的事件不要输出。`

type MeetingAgentLlmProxyOptions = {
  apiKey?: string
  baseUrl?: string
  model?: string
}

type ExtractRequest = {
  context?: string
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

          const payload = await callDeepSeek({
            apiKey,
            baseUrl: options.baseUrl || env('DEEPSEEK_BASE_URL', DEFAULT_BASE_URL),
            model: options.model || env('DEEPSEEK_MODEL', DEFAULT_MODEL),
            context,
            transcript,
          })
          sendJson(res, 200, payload)
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

async function callDeepSeek({
  apiKey,
  baseUrl,
  model,
  context,
  transcript,
}: {
  apiKey: string
  baseUrl: string
  model: string
  context: string
  transcript: string
}) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `当前会议状态摘要：\n${context}\n\n新增转写：\n${transcript}` },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`DeepSeek 事件抽取失败 ${response.status}: ${errorText.slice(0, 200)}`)
  }

  const raw = (await response.json()) as DeepSeekResponse
  const content = raw.choices?.[0]?.message?.content
  if (!content) throw new Error('DeepSeek 事件抽取返回为空')
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
    throw new Error('DeepSeek 事件抽取返回的 JSON 无法解析')
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
