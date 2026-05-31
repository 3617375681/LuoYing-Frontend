const STRONG_REJECT_ACTION_PATTERNS = [
  /^(决策)?[一二三四五六七八九十0-9]*代办$/,
  /^(决策|待办|代办|任务|事项)[一二三四五六七八九十0-9]*$/,
  /^(就是|然后|可以|那个|这个|有点|说点)+$/,
  /^(珞樱|洛英|落英)[，,]?.*(发言|回答|说一下|来讲|发个号|插话)$/,
]

const DELIVERY_PATTERNS = [
  /整理|确认|补充|提交|发送|同步|测试|部署|联系|排期|拉齐|跟进|落地|推进|发给|更新|修复|接入|配置|创建|加上|记录|通知|梳理|看一下|查一下|问一下|约一下|写|改|发|做|定/,
]

const TIME_PATTERNS = [/会后|下一步|后续|下次|明天|今天|本周|周[一二三四五六日天]|月底|上线前|开会前|之前|之后|稍后|回头/]
const OWNER_PATTERNS = [/负责|owner|谁来|你来|我来|他来|她来|我们来|麻烦|请|让|交给|安排/]
const ACTION_LABEL_PATTERNS = [/待办|todo|action\s*item|任务|事项/i]
const LOW_INFORMATION_PATTERNS = [/每一个说话人.*(方法|办法)?$/, /说话人啊/, /小白的方法/]

export function shouldKeepActionItem(text: string, owner?: string, deadline?: string, confidence = 0.7): boolean {
  const normalized = normalizeActionText(text)
  if (normalized.length < 4) return false
  if (STRONG_REJECT_ACTION_PATTERNS.some((pattern) => pattern.test(normalized))) return false
  if (/^(珞樱|洛英|落英)$/.test(owner?.trim() ?? '') && /发言|回答|发个号|说一下|来讲|插话/.test(normalized)) return false

  let score = 0
  if (ACTION_LABEL_PATTERNS.some((pattern) => pattern.test(text))) score += 1
  if (DELIVERY_PATTERNS.some((pattern) => pattern.test(text))) score += 2
  if (TIME_PATTERNS.some((pattern) => pattern.test(text)) || deadline) score += 2
  if (OWNER_PATTERNS.some((pattern) => pattern.test(text)) || owner) score += 2
  if (normalized.length >= 10) score += 1
  if (normalized.length >= 18) score += 1
  if (confidence >= 0.75) score += 1
  if (confidence < 0.6) score -= 1
  if (LOW_INFORMATION_PATTERNS.some((pattern) => pattern.test(normalized))) score -= 2
  if (/方法|方案|办法/.test(normalized) && !DELIVERY_PATTERNS.some((pattern) => pattern.test(text))) score -= 1

  return score >= 3
}

export function normalizeActionText(text: string) {
  return text.replace(/\s+/g, '').replace(/[，。！？、,.!?]/g, '')
}
