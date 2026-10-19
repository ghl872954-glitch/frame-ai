/**
 * 语音识别代理。
 *
 * 和对话、合成同一个道理：浏览器不直连服务商，走这里。
 * 区别是它接收的是音频文件（multipart），不是 JSON。
 *
 * 转发的目标是 OpenAI 兼容的 /audio/transcriptions。
 */

import { NextResponse } from 'next/server';

import { checkUrl } from '@/lib/tools/net';
import { endpointOf, extractUpstreamError, isLocalRequest } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: '请求体不是合法的表单数据' }, { status: 400 });
  }

  const audio = form.get('file');
  const baseUrl = String(form.get('baseUrl') ?? '').trim();
  const apiKey = String(form.get('apiKey') ?? '').trim();
  const model = String(form.get('model') ?? '').trim();
  const language = String(form.get('language') ?? '').trim();

  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: '没有收到音频' }, { status: 400 });
  }
  if (!baseUrl) return NextResponse.json({ error: '缺少接口地址' }, { status: 400 });
  if (!model) return NextResponse.json({ error: '缺少识别模型名' }, { status: 400 });

  const allowPrivate = isLocalRequest(request);
  const urlCheck = checkUrl(baseUrl, { allowPrivate });
  if (!urlCheck.ok) {
    return NextResponse.json({ error: `接口地址被拒绝：${urlCheck.reason}` }, { status: 400 });
  }

  const upstreamForm = new FormData();
  upstreamForm.append('file', audio, 'speech.webm');
  upstreamForm.append('model', model);
  if (language) upstreamForm.append('language', language);

  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let upstream: Response;
  try {
    upstream = await fetch(endpointOf(baseUrl, '/audio/transcriptions'), {
      method: 'POST',
      headers,
      body: upstreamForm,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `连不上识别服务：${message}` }, { status: 502 });
  }

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    return NextResponse.json(
      { error: extractUpstreamError(detail) || `上游返回 ${upstream.status}` },
      { status: upstream.status },
    );
  }

  const raw = await upstream.text();
  let text = '';
  try {
    const parsed = JSON.parse(raw) as { text?: string };
    text = parsed.text ?? '';
  } catch {
    // 有些实现直接返回纯文本
    text = raw;
  }

  return NextResponse.json({ text: text.trim() });
}
