/**
 * 语音合成代理。
 *
 * 和对话代理同一个道理：浏览器不直接打服务商，一律走这里。
 * 区别是它返回的是音频二进制，不是流式文本。
 *
 * 本地运行时这个进程就在你自己电脑上，key 不出本机。
 */

import { NextResponse } from 'next/server';
import { checkUrl } from '@/lib/tools/net';
import { endpointOf, extractUpstreamError, isLocalRequest } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface TtsRequestBody {
  provider?: { baseUrl?: string; apiKey?: string };
  model?: string;
  input?: string;
  voice?: string;
  speed?: number;
}

export async function POST(request: Request) {
  let body: TtsRequestBody;
  try {
    body = (await request.json()) as TtsRequestBody;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const baseUrl = body.provider?.baseUrl?.trim();
  const apiKey = body.provider?.apiKey?.trim() ?? '';
  const model = body.model?.trim();
  const input = body.input?.trim();

  if (!baseUrl) return NextResponse.json({ error: '缺少接口地址' }, { status: 400 });
  if (!model) return NextResponse.json({ error: '缺少合成模型名' }, { status: 400 });
  if (!input) return NextResponse.json({ error: '没有要合成的文本' }, { status: 400 });

  const allowPrivate = isLocalRequest(request);
  const urlCheck = checkUrl(baseUrl, { allowPrivate });
  if (!urlCheck.ok) {
    return NextResponse.json(
      { error: `接口地址被拒绝：${urlCheck.reason}` },
      { status: 400 },
    );
  }

  const endpoint = endpointOf(baseUrl, '/audio/speech');

  const payload: Record<string, unknown> = {
    model,
    input,
    response_format: 'mp3',
  };
  if (body.voice?.trim()) payload.voice = body.voice.trim();
  if (typeof body.speed === 'number' && Number.isFinite(body.speed)) {
    payload.speed = Math.min(2, Math.max(0.5, body.speed));
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      // 合成是同步返回整段音频，给个比对话短一些的上限
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `连不上合成服务：${message}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return NextResponse.json(
      { error: extractUpstreamError(detail) || `上游返回 ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const audio = await upstream.arrayBuffer();
  if (audio.byteLength === 0) {
    return NextResponse.json({ error: '合成服务返回了空音频' }, { status: 502 });
  }

  return new Response(audio, {
    headers: {
      // 各家返回的格式可能不同，以服务商自己声明的为准
      'Content-Type': upstream.headers.get('content-type') ?? 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
