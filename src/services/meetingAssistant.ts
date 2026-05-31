const MEETING_TOKEN_KEY = 'meeting-assistant.access-token'
const MEETING_THREAD_KEY = 'luoying.meeting.thread-id'
const MEETING_SESSION_KEY = 'luoying.meeting.session-id'
const MEETING_USER = 'luoying-web-user'
const MEETING_THREAD_TITLE = '珞樱实时会议'
const MEETING_THREAD_BACKGROUND = '从珞樱聊天界面自动接入的真实会议记录。'

const API_BASE = import.meta.env.DEV ? '/meeting-api' : ''

type ApiEnvelope<T> = {
  data: T
}

type AuthResponse = {
  accessToken: string
}

type ThreadResponse = {
  id: string
}

type SessionResponse = {
  id: string
  meetingContent?: string
  summary?: string
  transcriptSegments?: Array<{
    speakerText: string
    text: string
    startedAt?: string | null
    endedAt?: string | null
    sequence: number
  }>
}

type ReportDraftResponse = {
  summary?: string | { title?: string; content?: string }
  memorySummary?: string
  decisions?: unknown[]
  actionItems?: unknown[]
  risks?: unknown[]
  openQuestions?: unknown[]
  progressUpdates?: unknown[]
  discussionChains?: unknown[]
  warnings?: unknown[]
}

async function request<T>(path: string, options: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${API_BASE}/api/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  const payload = (await response.json()) as ApiEnvelope<T> | { error?: { message?: string; code?: string } }
  if (!response.ok || !('data' in payload)) {
    const message = 'error' in payload ? payload.error?.message || payload.error?.code || '会议接口请求失败' : '会议接口请求失败'
    throw new Error(message)
  }
  return payload.data
}

async function getToken(): Promise<string> {
  const cached = localStorage.getItem(MEETING_TOKEN_KEY)
  if (cached) return cached
  const auth = await request<AuthResponse>('/auth/enter', {
    method: 'POST',
    body: { entryName: MEETING_USER },
  })
  localStorage.setItem(MEETING_TOKEN_KEY, auth.accessToken)
  return auth.accessToken
}

async function getThread(token: string): Promise<string> {
  const cached = localStorage.getItem(MEETING_THREAD_KEY)
  if (cached) return cached
  const thread = await request<ThreadResponse>('/threads', {
    method: 'POST',
    token,
    body: { title: MEETING_THREAD_TITLE, background: MEETING_THREAD_BACKGROUND },
  })
  localStorage.setItem(MEETING_THREAD_KEY, thread.id)
  return thread.id
}

async function getSession(token: string, threadId: string): Promise<string> {
  const cached = localStorage.getItem(MEETING_SESSION_KEY)
  if (cached) return cached
  const session = await request<SessionResponse>(`/threads/${threadId}/sessions`, {
    method: 'POST',
    token,
    body: { title: `珞樱会议 ${new Date().toLocaleString('zh-CN')}` },
  })
  localStorage.setItem(MEETING_SESSION_KEY, session.id)
  return session.id
}

async function ensureMeetingSession() {
  const token = await getToken()
  const threadId = await getThread(token)
  const sessionId = await getSession(token, threadId)
  return { token, threadId, sessionId }
}

function formatReport(draft: ReportDraftResponse): string {
  const summary = typeof draft.summary === 'string' ? draft.summary : draft.summary?.content
  const sections = [
    ['会议总结', summary],
    ['关键决策', draft.decisions],
    ['待办事项', draft.actionItems],
    ['风险', draft.risks],
    ['遗留问题', draft.openQuestions],
    ['进展更新', draft.progressUpdates],
    ['议题链路', draft.discussionChains],
    ['提醒', draft.warnings],
  ] as const

  return sections
    .map(([title, value]) => {
      if (!value) return ''
      if (Array.isArray(value) && value.length === 0) return ''
      if (typeof value === 'string') return `## ${title}\n${value}`
      if (Array.isArray(value)) {
        return `## ${title}\n${value.map((item) => `- ${formatValue(item)}`).join('\n')}`
      }
      return `## ${title}\n${formatValue(value)}`
    })
    .filter(Boolean)
    .join('\n\n') || '会议后端已处理，但暂时没有生成可展示的总结。'
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return String(value ?? '')
  const record = value as Record<string, unknown>
  return String(
    record.content ??
      record.description ??
      record.topic ??
      record.decision ??
      record.title ??
      JSON.stringify(value),
  )
}

export async function appendMeetingTranscript(text: string, speakerText = '网页用户') {
  const { token, sessionId } = await ensureMeetingSession()
  await request(`/sessions/${sessionId}/transcriptions`, {
    method: 'POST',
    token,
    body: {
      provider: 'luoying-chat',
      mode: 'realtime',
      segments: [{ speakerText, text, startedAt: new Date().toISOString() }],
    },
  })
}

export async function summarizeCurrentMeeting() {
  const { token, sessionId } = await ensureMeetingSession()
  const session = await request<SessionResponse>(`/sessions/${sessionId}`, { token })
  const meetingContent = session.meetingContent || session.transcriptSegments?.map((item) => `${item.speakerText}: ${item.text}`).join('\n') || ''

  if (!meetingContent.trim()) {
    return '当前还没有真实会议转写内容。请先在聊天里输入会议发言，或接入后端实时转写后再总结。'
  }

  const draft = await request<ReportDraftResponse>(`/sessions/${sessionId}/follow-up-draft`, {
    method: 'POST',
    token,
    body: { meetingContent },
  })
  return formatReport(draft)
}
