/**
 * API 路由之间共用的小工具。
 *
 * 抽出来是因为 chat 和 tts 两个代理都要用同一套地址校验和错误提取 ——
 * 两边各写一份的话，改一处忘一处，迟早对不上。
 */

/** 判断请求是不是来自本机，用来决定要不要放行 localhost 的模型地址 */
export function isLocalRequest(request: Request): boolean {
  const host = request.headers.get('host') ?? '';
  const hostname = host.split(':')[0].toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost')
  );
}

/** 各家错误格式不统一，尽量从里面挖出人看得懂的那句 */
export function extractUpstreamError(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    const message =
      parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? parsed?.detail;
    if (typeof message === 'string') return message.slice(0, 300);
  } catch {
    // 不是 JSON，直接截一段
  }
  return raw.slice(0, 300);
}

/** 把 baseUrl 拼成具体端点，已经带上了就不重复拼 */
export function endpointOf(baseUrl: string, path: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith(path) ? trimmed : `${trimmed}${path}`;
}
