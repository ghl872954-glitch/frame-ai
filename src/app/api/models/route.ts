/**
 * 拉取模型列表。
 *
 * 为什么要有这个：各家的模型名换得比文档快，硬编码一堆名字迟早过期。
 * 让用户填完地址和 key，直接从服务商拿真实可用的清单，比什么预设都准。
 */

import { NextResponse } from 'next/server';
import { checkUrl } from '@/lib/tools/net';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ModelsBody {
  baseUrl?: string;
  apiKey?: string;
}

export async function POST(request: Request) {
  let body: ModelsBody;
  try {
    body = (await request.json()) as ModelsBody;
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }

  const baseUrl = body.baseUrl?.trim();
  if (!baseUrl) return NextResponse.json({ error: '缺少接口地址' }, { status: 400 });

  const allowPrivate = isLocalRequest(request);
  const urlCheck = checkUrl(baseUrl, { allowPrivate });
  if (!urlCheck.ok) {
    return NextResponse.json({ error: `接口地址被拒绝：${urlCheck.reason}` }, { status: 400 });
  }

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = {};
  if (body.apiKey?.trim()) headers.Authorization = `Bearer ${body.apiKey.trim()}`;

  try {
    const response = await fetch(endpoint, {
      headers,
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return NextResponse.json(
        { error: `服务商返回 ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}` },
        { status: response.status },
      );
    }

    const data = (await response.json()) as { data?: { id?: string }[] };
    const ids = (data.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ models: ids });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `拉取失败：${message}` }, { status: 502 });
  }
}

function isLocalRequest(request: Request): boolean {
  const host = request.headers.get('host') ?? '';
  const hostname = host.split(':')[0].toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}
