import { useCallback, useEffect, useRef, useState } from 'react'
import { isAsrSupported, DashscopeParaformerAsr } from './asr'
import { MeetingAgentEvaluator } from './evaluator'
import { readLlmConfig } from './llm'
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
  start: () => void
  stop: () => void
  reset: () => void
  acknowledgeIntervention: () => void
}

export function useMeetingAgent(): UseMeetingAgentResult {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const [segments, setSegments] = useState<TranscriptSegment[]>([])
  const [partialText, setPartialText] = useState('')
  const [latestState, setLatestState] = useState<MeetingAgentState | null>(null)
  const [intervention, setIntervention] = useState<AgentInterventionInbox | null>(null)

  const asrRef = useRef<DashscopeParaformerAsr | null>(null)
  const evaluatorRef = useRef<MeetingAgentEvaluator | null>(null)

  const start = useCallback(() => {
    if (asrRef.current) return
    if (!isAsrSupported()) {
      setError('当前浏览器不支持麦克风 AudioWorklet 采集')
      return
    }
    setError('')

    const evaluator = new MeetingAgentEvaluator()
    evaluator.on((event) => {
      if (event.type === 'state') setLatestState(event.state)
      else if (event.type === 'intervention')
        setIntervention({ state: event.state, receivedAt: Date.now(), acknowledged: false })
      else if (event.type === 'error') setError(event.message)
    })
    evaluator.start()
    evaluatorRef.current = evaluator

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
        }
        setSegments((items) => {
          const next = [...items, segment]
          return next.length > 200 ? next.slice(next.length - 200) : next
        })
        evaluatorRef.current?.pushFinal(segment)
      } else if (event.type === 'error') {
        setError(event.message)
      } else if (event.type === 'end') {
        setRecording(false)
      }
    })
    asr.start()
    asrRef.current = asr
    setRecording(true)
  }, [])

  const stop = useCallback(() => {
    asrRef.current?.stop()
    asrRef.current = null
    evaluatorRef.current?.stop()
    evaluatorRef.current = null
    setRecording(false)
    setPartialText('')
  }, [])

  const reset = useCallback(() => {
    asrRef.current?.stop()
    asrRef.current = null
    evaluatorRef.current?.reset()
    evaluatorRef.current = null
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

  useEffect(() => {
    return () => {
      asrRef.current?.stop()
      evaluatorRef.current?.stop()
    }
  }, [])

  return {
    supported: isAsrSupported(),
    configured: readLlmConfig() !== null,
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
  }
}
