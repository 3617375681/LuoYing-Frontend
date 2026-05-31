// DashScope Paraformer 实时 ASR 客户端。
// 浏览器不能安全直连 DashScope（需要 Authorization header），所以通过 Vite dev server 内置的
// /dashscope-asr WebSocket 代理转发：浏览器发送 16kHz mono Int16 PCM，代理补 DashScope key。

export function isAsrSupported(): boolean {
  const mediaDevices = navigator.mediaDevices as MediaDevices | undefined
  return mediaDevices !== undefined && typeof mediaDevices.getUserMedia === 'function' && 'audioWorklet' in AudioContext.prototype
}

export type AsrEvent =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
  | { type: 'end' }

export type AsrListener = (event: AsrEvent) => void

type ServerEvent =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
  | { type: 'closed'; reason?: string }

export class DashscopeParaformerAsr {
  private listeners = new Set<AsrListener>()
  private socket: WebSocket | null = null
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private shouldRun = false

  on(listener: AsrListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async start(): Promise<boolean> {
    if (this.socket) return true
    if (!isAsrSupported()) {
      this.emit({ type: 'error', message: '当前浏览器不支持麦克风 AudioWorklet 采集' })
      return false
    }

    this.shouldRun = true
    try {
      const socket = new WebSocket(buildAsrUrl())
      socket.binaryType = 'arraybuffer'
      this.socket = socket

      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve()
        socket.onerror = () => reject(new Error('无法连接 DashScope ASR 代理 /dashscope-asr'))
      })

      socket.onmessage = (event) => this.handleServerMessage(event.data)
      socket.onerror = () => this.emit({ type: 'error', message: 'DashScope ASR WebSocket 连接错误' })
      socket.onclose = () => {
        this.cleanupAudio()
        this.socket = null
        this.emit({ type: 'end' })
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      const audioContext = new AudioContext()
      await audioContext.audioWorklet.addModule('/meeting-agent/pcm-capture-worklet.js')
      const source = audioContext.createMediaStreamSource(stream)
      const worklet = new AudioWorkletNode(audioContext, 'pcm-capture-processor')

      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (!this.shouldRun || socket.readyState !== WebSocket.OPEN) return
        socket.send(event.data)
      }

      source.connect(worklet)
      // 不接 destination，避免本地回放啸叫

      this.stream = stream
      this.audioContext = audioContext
      this.source = source
      this.worklet = worklet
      return true
    } catch (cause) {
      this.stop()
      this.emit({ type: 'error', message: (cause as Error).message })
      return false
    }
  }

  stop() {
    this.shouldRun = false
    const socket = this.socket
    this.socket = null
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send('finish')
      } catch {
        // ignore
      }
      try {
        socket.close(1000, 'client-stop')
      } catch {
        // ignore
      }
    }
    this.cleanupAudio()
  }

  private handleServerMessage(data: unknown) {
    if (typeof data !== 'string') return
    let event: ServerEvent
    try {
      event = JSON.parse(data) as ServerEvent
    } catch {
      return
    }
    if (event.type === 'ready') this.emit({ type: 'ready' })
    else if (event.type === 'partial') this.emit({ type: 'partial', text: event.text })
    else if (event.type === 'final') this.emit({ type: 'final', text: event.text })
    else if (event.type === 'error') this.emit({ type: 'error', message: event.message })
    else if (event.type === 'closed') this.emit({ type: 'end' })
  }

  private cleanupAudio() {
    this.worklet?.disconnect()
    this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.audioContext?.close().catch(() => {})
    this.worklet = null
    this.source = null
    this.stream = null
    this.audioContext = null
  }

  private emit(event: AsrEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // ignore
      }
    }
  }
}

function buildAsrUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/dashscope-asr`
}
