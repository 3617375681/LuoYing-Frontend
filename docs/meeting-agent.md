# 珞樱实时会议 Agent

珞樱聊天页内置的会议陪跑功能。ASR 使用 DashScope Paraformer 实时识别；会议理解与介入判断使用 DeepSeek。

## 链路

```text
麦克风
  │
  ▼
AudioWorklet 采集 / 重采样为 16kHz mono Int16 PCM（100ms frame）
  │
  ▼
浏览器 WebSocket: /dashscope-asr
  │
  ▼
Vite dev server 内置 ASR 代理（vite.config.ts 插件）
  │  补 Authorization: bearer DASHSCOPE_API_KEY
  ▼
DashScope Paraformer Realtime: paraformer-realtime-v2
  │
  ▼
partial / final 转写回到聊天页卡片
  │
  ▼
final 转写缓冲，满足节流条件后调用 DeepSeek
  │
  ▼
会议状态（phase / topic / decisions / actionItems / openLoops / risks）
  │
  ▼
需要介入时，在珞樱聊天界面浮出建议话术
  │
  ▼
点击「让珞樱发言」→ 通过 useChat.sendMessage 注入聊天流
```

## 配置

```bash
cp .env.example .env.local
```

`.env.local` 需要填：

```bash
VITE_DEEPSEEK_API_KEY=你的 DeepSeek Key
DASHSCOPE_API_KEY=你的 DashScope Key
```

可选：

```bash
VITE_DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
VITE_DEEPSEEK_MODEL=deepseek-chat
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
5. DeepSeek 判断需要介入时，弹出建议话术
6. 点「让珞樱发言」或「忽略」

## 文件结构

```text
src/features/meeting-agent/
├── types.ts                       类型
├── asr.ts                         浏览器端麦克风采集 + /dashscope-asr WS 客户端
├── viteDashscopeAsrProxy.ts       Vite dev server DashScope WS 代理
├── llm.ts                         DeepSeek 客户端
├── evaluator.ts                   评估调度（节流 + cooldown）
├── useMeetingAgent.ts             React hook
└── MeetingAgentCard.tsx           聊天页内嵌 UI

public/meeting-agent/
└── pcm-capture-worklet.js         AudioWorklet：重采样 + PCM frame
```

## 限制

- 当前 ASR 代理挂在 Vite dev server 上，适合本地开发；生产部署需要把 `viteDashscopeAsrProxy.ts` 挪到正式 Node/API 服务或边缘函数。
- DeepSeek key 仍是 `VITE_` 前端变量，浏览器可见；生产部署建议同样走后端代理。
- 目前没有声纹分离 / 说话人 diarization，所有转写进入同一会议流。
- 无持久化，刷新页面会清空当前会议状态。

## 调参

`evaluator.ts` 顶部三个常量：

```ts
const MIN_INTERVAL_MS = 8_000          // 两次评估之间最短间隔
const COOLDOWN_MS = 45_000             // 两次介入之间最短间隔
const MIN_NEW_FINAL_SEGMENTS = 3       // 新增多少 final 才会重评
```
