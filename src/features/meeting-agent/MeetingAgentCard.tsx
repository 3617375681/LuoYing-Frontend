import { AlertTriangle, CheckCircle2, Clock3, Mic, MicOff, Radio, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import type { UseMeetingAgentResult } from './useMeetingAgent'

type MeetingAgentCardProps = {
  agent: UseMeetingAgentResult
  onAdoptIntervention: (text: string) => void
}

export default function MeetingAgentCard({ agent, onAdoptIntervention }: MeetingAgentCardProps) {
  const {
    supported,
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
  } = agent

  const phase = latestState?.phase ?? (recording ? 'discussion' : 'idle')
  const topic = latestState?.currentTopic || (recording ? '识别中…' : '尚未开始')
  const recentSegments = segments.slice(-8)

  return (
    <div className="mx-auto mb-4 max-w-3xl rounded-2xl border border-[#dbeafe] bg-[#f8fbff] p-4 text-sm text-[#1e293b] shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2 font-display font-semibold text-[#0067B1]">
          <Radio size={16} className={recording ? 'animate-pulse text-rose-500' : ''} />
          珞樱实时参会
        </div>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-[#64748b] ring-1 ring-[#dbeafe]">
          {labelPhase(phase)} · {topic}
        </span>
      </div>

      {latestState?.summary && <p className="mt-3 leading-6 text-[#475569]">{latestState.summary}</p>}

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Metric icon={<CheckCircle2 size={14} />} label="决策" value={latestState?.decisions.length ?? 0} />
        <Metric icon={<Clock3 size={14} />} label="待办" value={latestState?.actionItems.length ?? 0} />
        <Metric
          icon={<AlertTriangle size={14} />}
          label="未闭环"
          value={(latestState?.openLoops.length ?? 0) + (latestState?.risks.length ?? 0)}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-[#64748b]">
          {recording
            ? `正在收音 · 已识别 ${segments.length} 段`
            : '点击右侧按钮开始一场会议，珞樱会全程旁听'}
        </div>
        <div className="flex gap-2">
          {recording ? (
            <button
              type="button"
              onClick={stop}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
            >
              <MicOff size={14} />
              结束
            </button>
          ) : (
            <button
              type="button"
              disabled={!supported || !configured}
              onClick={start}
              className="inline-flex items-center gap-1 rounded-lg bg-[#0067B1] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#005a96] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Mic size={14} />
              开始会议
            </button>
          )}
          {(segments.length > 0 || latestState) && !recording && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 rounded-lg border border-[#e2e8f0] bg-white px-3 py-1.5 text-xs text-[#64748b] hover:bg-[#f8fafc]"
            >
              <RotateCcw size={14} />
              清空
            </button>
          )}
        </div>
      </div>

      {!supported && (
        <Notice tone="warn">当前浏览器不支持麦克风 AudioWorklet 采集。建议使用 Chrome 或 Edge。</Notice>
      )}
      {supported && !configured && (
        <Notice tone="warn">未检测到 VITE_DEEPSEEK_API_KEY。请在 .env.local 中配置后重启 dev。</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {(recentSegments.length > 0 || partialText) && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded-xl border border-[#e2e8f0] bg-white p-3 text-xs leading-6 text-[#334155]">
          {recentSegments.map((line) => (
            <div key={line.id}>{line.text}</div>
          ))}
          {partialText && <div className="opacity-60">{partialText}</div>}
        </div>
      )}

      {intervention && !intervention.acknowledged && intervention.state.intervention.suggestedText && (
        <div className="mt-4 rounded-xl border border-[#bfdbfe] bg-white p-3">
          <div className="text-xs font-semibold text-[#0067B1]">
            建议介入 · {intervention.state.intervention.priority}
          </div>
          <p className="mt-1 leading-6 text-[#334155]">{intervention.state.intervention.suggestedText}</p>
          {intervention.state.intervention.reason && (
            <p className="mt-1 text-xs text-[#64748b]">原因：{intervention.state.intervention.reason}</p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onAdoptIntervention(intervention.state.intervention.suggestedText)
                acknowledgeIntervention()
              }}
              className="rounded-lg bg-[#0067B1] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#005a96]"
            >
              让珞樱发言
            </button>
            <button
              type="button"
              onClick={acknowledgeIntervention}
              className="rounded-lg border border-[#e2e8f0] px-3 py-1.5 text-xs text-[#64748b] hover:bg-[#f8fafc]"
            >
              忽略
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-[#e2e8f0]">
      <span className="flex items-center gap-1.5 text-xs text-[#64748b]">
        {icon}
        {label}
      </span>
      <strong className="text-[#1e293b]">{value}</strong>
    </div>
  )
}

function Notice({ tone, children }: { tone: 'warn' | 'error'; children: ReactNode }) {
  const styles =
    tone === 'error'
      ? 'border-rose-200 bg-rose-50 text-rose-600'
      : 'border-amber-200 bg-amber-50 text-amber-700'
  return <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${styles}`}>{children}</div>
}

function labelPhase(phase: string) {
  switch (phase) {
    case 'discussion':
      return '讨论中'
    case 'decision':
      return '推进决策'
    case 'blocked':
      return '出现阻塞'
    case 'wrap_up':
      return '收尾阶段'
    case 'idle':
    default:
      return '待开始'
  }
}
