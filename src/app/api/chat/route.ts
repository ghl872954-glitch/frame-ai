/**
 * 对话代理。
 *
 * 浏览器不直接打服务商，一律走这里，原因：
 *   1. 绕开 CORS —— 不是每家都开了跨域
 *   2. 统一错误处理，把 401/404/429 翻译成人话
 *
 * 本地运行时这个进程就在你自己电脑上，key 不出本机。
 * 部署到公网时要注意：这个路由会把请求转发到客户端指定的地址，
 * 所以下面做了地址校验，免得被人当成开放代理用。
 */

import { NextResponse } from 'next/server';
import { checkUrl } from '@/lib/tools/net';
import { endpointOf, extractUpstreamError, isLocalRequest } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatRequestBody {
  provider?: { baseUrl?: string; apiKey?: string; model?: string };
  messages?: unknown[];
  tools?: unknown[];
}

export async function POST(request: Request) {
  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const baseUrl = body.provider?.baseUrl?.trim();
  const model = body.provider?.model?.trim();
  const apiKey = body.provider?.apiKey?.trim() ?? '';

  if (!baseUrl) return NextResponse.json({ error: '缺少接口地址' }, { status: 400 });
  if (!model) return NextResponse.json({ error: '缺少模型名' }, { status: 400 });
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: '缺少对话内容' }, { status: 400 });
  }

  // 本地访问时允许把模型也指向 localhost（Ollama 就在本机）
  const allowPrivate = isLocalRequest(request);
  const urlCheck = checkUrl(baseUrl, { allowPrivate });
  if (!urlCheck.ok) {
    return NextResponse.json(
      { error: `接口地址被拒绝：${urlCheck.reason}` },
      { status: 400 },
    );
  }

  const endpoint = endpointOf(baseUrl, '/chat/completions');

  const payload: Record<string, unknown> = {
    model,
    messages: body.messages,
    stream: true,
    temperature: 0.7,
  };
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    payload.tools = body.tools;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      // 流式响应不能设太短的超时
      signal: AbortSignal.any?.([request.signal, AbortSignal.timeout(300_000)]) ?? request.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `连不上模型服务：${message}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return NextResponse.json(
      { error: extractUpstreamError(detail) || `上游返回 ${upstream.status}` },
      { status: upstream.status },
    );
  }

  if (!upstream.body) {
    return NextResponse.json({ error: '上游没有返回流' }, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
