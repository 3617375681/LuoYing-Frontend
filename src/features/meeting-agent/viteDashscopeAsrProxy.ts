import { randomUUID } from 'node:crypto'
import type { Plugin, ViteDevServer } from 'vite'
import { WebSocket, WebSocketServer } from 'ws'

const FRAME_FORMAT = 'pcm'
const FRAME_SAMPLE_RATE = 16000
const DEFAULT_DASHSCOPE_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference/'
const DEFAULT_DASHSCOPE_MODEL = 'paraformer-realtime-v2'

type DashscopeAsrProxyOptions = {
  apiKey?: string
  url?: string
  model?: string
}

type DashscopeSentence = {
  text?: string
  end_time?: number
  begin_time?: number
  sentence_id?: string
  sentence_end?: boolean
  speaker_id?: string
  speaker?: string
  speakerId?: string
}

type DashscopePayload = {
  header?: {
    event?: string
    error_message?: string
  }
  payload?: {
    output?: {
      sentence?: DashscopeSentence
    }
  }
}

function env(name: string, fallback = '') {
  return process.env[name] || fallback
}

function makeTaskId() {
  return randomUUID().replace(/-/g, '')
}

export function createDashscopeAsrProxy(options: DashscopeAsrProxyOptions = {}): Plugin {
  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (client) => {
    const apiKey = options.apiKey || env('DASHSCOPE_API_KEY')
    if (!apiKey) {
      client.send(JSON.stringify({ type: 'error', message: '缺少 DASHSCOPE_API_KEY，请在 .env.local 中配置' }))
      client.close(1011, 'missing-dashscope-api-key')
      return
    }

    const taskId = makeTaskId()
    const upstream = new WebSocket(options.url || env('DASHSCOPE_ASR_URL', DEFAULT_DASHSCOPE_URL), {
      headers: {
        Authorization: `bearer ${apiKey}`,
        'X-DashScope-DataInspection': 'enable',
      },
    })

    let taskStarted = false
    let closed = false
    const pending: Buffer[] = []

    const closeBoth = (reason: string) => {
      if (closed) return
      closed = true
      try {
        if (client.readyState === WebSocket.OPEN) client.close(1000, reason)
      } catch {
        // ignore
      }
      try {
        if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
          upstream.close(1000, reason)
        }
      } catch {
        // ignore
      }
    }

    upstream.on('open', () => {
      upstream.send(
        JSON.stringify({
          header: {
            action: 'run-task',
            task_id: taskId,
            streaming: 'duplex',
          },
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model: options.model || env('DASHSCOPE_ASR_MODEL', DEFAULT_DASHSCOPE_MODEL),
            parameters: {
              format: FRAME_FORMAT,
              sample_rate: FRAME_SAMPLE_RATE,
              disfluency_removal_enabled: false,
              punctuation_prediction_enabled: true,
              inverse_text_normalization_enabled: true,
            },
            input: {},
          },
        }),
      )
    })

    upstream.on('message', (data) => {
      const raw = data.toString()
      if (!raw || raw[0] !== '{') return

      let message: DashscopePayload
      try {
        message = JSON.parse(raw) as DashscopePayload
      } catch {
        return
      }

      const event = message.header?.event
      if (event === 'task-started') {
        taskStarted = true
        for (const frame of pending.splice(0)) upstream.send(frame)
        client.send(JSON.stringify({ type: 'ready' }))
        return
      }

      if (event === 'task-failed') {
        client.send(JSON.stringify({ type: 'error', message: message.header?.error_message || 'dashscope task-failed' }))
        closeBoth('task-failed')
        return
      }

      if (event === 'task-finished') {
        client.send(JSON.stringify({ type: 'closed', reason: 'task-finished' }))
        closeBoth('task-finished')
        return
      }

      if (event === 'result-generated') {
        const sentence = message.payload?.output?.sentence
        const text = sentence?.text?.trim()
        if (!text) return
        const speakerId = sentence?.speaker_id || sentence?.speakerId || sentence?.speaker
        client.send(
          JSON.stringify({
            type: sentence?.sentence_end ? 'final' : 'partial',
            text,
            beginMs: sentence?.begin_time,
            endMs: sentence?.end_time,
            sentenceId: sentence?.sentence_id,
            speakerId,
          }),
        )
      }
    })

    upstream.on('error', (cause) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'error', message: `DashScope ASR 连接错误：${(cause as Error).message}` }))
      }
    })

    upstream.on('close', (code, reason) => {
      if (closed) return
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'closed', reason: reason.toString() || `code=${code}` }))
      }
      closeBoth('upstream-closed')
    })

    client.on('message', (data, isBinary) => {
      if (!isBinary) {
        const text = data.toString()
        if (text === 'finish') {
          if (upstream.readyState === WebSocket.OPEN && taskStarted) {
            upstream.send(
              JSON.stringify({
                header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
                payload: { input: {} },
              }),
            )
          }
          return
        }
      }

      const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      if (upstream.readyState !== WebSocket.OPEN || !taskStarted) {
        pending.push(frame)
        return
      }
      upstream.send(frame)
    })

    client.on('close', () => closeBoth('client-closed'))
    client.on('error', () => closeBoth('client-error'))
  })

  return {
    name: 'dashscope-asr-proxy',
    configureServer(server: ViteDevServer) {
      server.httpServer?.on('upgrade', (req, socket, head) => {
        const url = new URL(req.url || '/', 'http://localhost')
        if (url.pathname !== '/dashscope-asr') return
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req)
        })
      })
    },
  }
}
