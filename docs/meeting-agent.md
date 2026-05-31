# 珞樱实时会议 Agent

珞樱聊天页内置的会议陪跑 Agent。ASR 使用 DashScope Paraformer 实时识别；Agent 内核使用「事件抽取 → 状态归约 → 介入策略」的持续观察循环。

## 链路

```text
麦克风
  ↓
AudioWorklet 采集 / 重采样为 16kHz mono Int16 PCM（100ms frame）
  ↓
浏览器 WebSocket: /dashscope-asr
  ↓
Vite dev server 内置 ASR 代理（补 Authorization: bearer DASHSCOPE_API_KEY）
  ↓
DashScope Paraformer Realtime: paraformer-realtime-v2
  ↓
partial / final 转写回到聊天页卡片
  ↓
final segment 进入 MeetingAgentLoop
  ↓
DeepSeek 抽取结构化会议事件（topic / decision / action / open_loop / risk / conflict / wrap_up）
  ↓
Reducer 持续维护会议状态（议题、决策、待办、未闭环、风险、角色信号、指标）
  ↓
Policy Engine 对介入候选排序（风险 > 缺 owner/DDL > 收尾闭环 > 澄清问题 > 推动决策）
  ↓
珞樱聊天界面浮出建议话术
  ↓
点击「让珞樱发言」→ 通过 useChat.sendMessage 注入聊天流
```

## 配置

```bash
cp .env.example .env.local
```

`.env.local` 需要填：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek Key
DASHSCOPE_API_KEY=你的 DashScope Key
```

可选：

```bash
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DASHSCOPE_ASR_URL=wss://dashscope.aliyuncs.com/api-ws/v1/inference/
DASHSCOPE_ASR_MODEL=paraformer-realtime-v2
```

启动：

```bash
pnpm install
pnpm run dev
```

## 使用

1. Chrome 或 Edge 打开 `/chat`
2. 顶部「珞樱实时参会」卡片，点「开始会议」
3. 允许麦克风权限
4. 卡片实时显示 DashScope 的 partial / final 转写
5. Agent 持续追踪事件、待办、风险与未闭环问题
6. 需要介入时弹出建议话术
7. 点「让珞樱发言」或「忽略」

## 验证

```bash
pnpm run check:agent
npx eslint src/features/meeting-agent vite.config.ts scripts/check-meeting-agent.ts
pnpm run build
```

## 文件结构

```text
src/features/meeting-agent/
├── types.ts                       Agent 状态 / 事件 / 介入类型
├── asr.ts                         浏览器端麦克风采集 + /dashscope-asr WS 客户端
├── viteDashscopeAsrProxy.ts       Vite dev server DashScope WS 代理
├── llm.ts                         浏览器端 LLM 代理客户端
├── viteMeetingAgentLlmProxy.ts     Vite dev server DeepSeek 代理（key 不进浏览器）
├── meetingState.ts                初始状态
├── reducer.ts                     事件归约为持久会议状态
├── interventionPolicy.ts          介入策略与冷却/同目标去重
├── agentLoop.ts                   observe → extract → reduce → intervene 主循环
├── useMeetingAgent.ts             React hook
└── MeetingAgentCard.tsx           聊天页内嵌 UI

public/meeting-agent/
└── pcm-capture-worklet.js         AudioWorklet：重采样 + PCM frame
```

## 介入策略

- `risk_alert`：高优先级，风险/阻塞/返工可能性优先提醒。
- `assign_owner`：待办缺负责人或截止时间时提醒。
- `clarify`：未闭环问题长期存在时提醒。
- `push_decision`：多个 proposed decision 未收敛时提醒。
- `wrap_up`：会议收尾但仍有待办/开环时提醒。

默认冷却：

```ts
COOLDOWN_MS = 45_000
SAME_TARGET_COOLDOWN_MS = 120_000
MIN_INTERVAL_MS = 8_000
MIN_NEW_SEGMENTS = 3
```

## 限制

- 当前 ASR 与 LLM 代理挂在 Vite dev server 上，适合本地开发；生产部署需要把 `viteDashscopeAsrProxy.ts` / `viteMeetingAgentLlmProxy.ts` 挪到正式 Node/API 服务或边缘函数。
- DeepSeek / DashScope key 只在 Vite server 侧读取，不打包进浏览器。
- 目前没有声纹分离 / 说话人 diarization，所有转写进入同一会议流。
- 无持久化，刷新页面会清空当前会议状态。
