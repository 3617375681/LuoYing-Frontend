import { useCallback, useEffect, useRef, useState } from 'react'
import { isAsrSupported, DashscopeParaformerAsr } from './asr'
import { MeetingAgentLoop } from './agentLoop'
import { generateInterventionSpeech, isLlmConfigured } from './llm'
import type { AgentInterventionInbox, MeetingAgentState, TranscriptSegment } from './types'

const PARTIAL_ID = 'partial'

export type UseMeetingAgentResult = {
  supported: boolean
  configured: boolean
  recording: boolean
  error: string
  segments: TranscriptSegment[]
  partialText: string
  latestState: MeetingAgentState | null
  intervention: AgentInterventionInbox | null
  start: () => Promise<void>
  stop: () => void
  reset: () => void
  acknowledgeIntervention: () => void
  forceSpeak: () => Promise<string>
}

export function useMeetingAgent(): UseMeetingAgentResult {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [partialText, setPartialText] = useState('')
  const [latestState, setLatestState] = useState<MeetingAgentState | null>(null)
  const [intervention, setIntervention] = useState<AgentInterventionInbox | null>(null)
  const [configured, setConfigured] = useState(false)

  const asrRef = useRef<DashscopeParaformerAsr | null>(null)
  const loopRef = useRef<MeetingAgentLoop | null>(null)

  const start = useCallback(async () => {
    if (asrRef.current) return
    if (!isAsrSupported()) {
      setError('当前浏览器不支持麦克风 AudioWorklet 采集')
      return
    }
    setError('')

    const loop = new MeetingAgentLoop()
    loop.on((event) => {
      if (event.type === 'state') setLatestState(event.state)
      else if (event.type === 'intervention')
        setIntervention({ candidate: event.candidate, receivedAt: Date.now(), acknowledged: false })
      else if (event.type === 'error') setError(event.message)
    })
    await loop.start()
    if (!loop.isRunning()) {
      loopRef.current = null
      return
    }
    loopRef.current = loop

    const asr = new DashscopeParaformerAsr()
    asr.on((event) => {
      if (event.type === 'ready') {
        setError('')
      } else if (event.type === 'partial') {
        setPartialText(event.text)
      } else if (event.type === 'final') {
        setPartialText('')
        const segment: TranscriptSegment = {
          id: `${PARTIAL_ID}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          text: event.text,
          isFinal: true,
          receivedAt: Date.now(),
          speakerId: event.speakerId,
        }
        setSegments((items) => {
          const next = [...items, segment]
          return next.length > 200 ? next.slice(next.length - 200) : next
        })
        loopRef.current?.pushFinal(segment)
      } else if (event.type === 'error') {
        setError(event.message)
      } else if (event.type === 'end') {
        setRecording(false)
      }
    })

    const ok = await asr.start()
    if (!ok) {
      loop.stop()
      loopRef.current = null
      return
    }
    asrRef.current = asr
    setRecording(true)
  }, [])

  const stop = useCallback(() => {
    asrRef.current?.stop()
    asrRef.current = null
    loopRef.current?.stop()
    loopRef.current = null
    setRecording(false)
    setPartialText('')
  }, [])

  const reset = useCallback(() => {
    asrRef.current?.stop()
    asrRef.current = null
    loopRef.current?.reset()
    loopRef.current = null
    setRecording(false)
    setSegments([])
    setPartialText('')
    setLatestState(null)
    setIntervention(null)
    setError('')
  }, [])

  const acknowledgeIntervention = useCallback(() => {
    setIntervention((current) => (current ? { ...current, acknowledged: true } : current))
  }, [])

  const forceSpeak = useCallback(async () => {
    const state = latestState ?? loopRef.current?.getState()
    if (!state) throw new Error('会议状态还没有准备好，请先开始会议并产生几段转写')
    const recentSegments = segments.slice(-20)
    if (recentSegments.length === 0 && !partialText.trim()) throw new Error('还没有可参考的会议内容')

    const text = await generateInterventionSpeech(
      state,
      {
        id: `manual-${Date.now()}`,
        type: 'summarize',
        priority: 'high',
        reason: '用户手动要求珞樱基于当前会议上下文直接发言。',
        text: '请基于当前会议上下文，直接说一句最有帮助的话。',
        targetIds: recentSegments.map((segment) => segment.id),
        confidence: 1,
        createdAt: Date.now(),
      },
      recentSegments,
    )
    return text.trim()
  }, [latestState, partialText, segments])

  useEffect(() => {
    void isLlmConfigured().then(setConfigured)
  }, [])

  useEffect(() => {
    return () => {
      asrRef.current?.stop()
      loopRef.current?.stop()
    }
  }, [])

  return {
    supported: isAsrSupported(),
    configured,
    recording,
    error,
    segments,
    partialText,
    latestState,
    intervention,
    start,
    stop,
    reset,
    acknowledgeIntervention,
    forceSpeak,
  }
}
