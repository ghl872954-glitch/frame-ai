/**
 * 服务端工具。
 *
 * 抓网页、搜索这类事必须在服务端做 —— 浏览器直连会被 CORS 挡掉。
 * 本地运行时这个「服务端」就是你自己电脑上的 Next.js 进程。
 *
 * 红线同样生效：地址先过 checkUrl，内网和云元数据地址一律不放行。
 */

import { NextResponse } from 'next/server';
import { htmlToText } from '@/lib/tools/net';
import { fetchPageText } from '@/lib/tools/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ToolBody {
  tool?: string;
  url?: string;
  query?: string;
}

export async function POST(request: Request) {
  let body: ToolBody;
  try {
    body = (await request.json()) as ToolBody;
  } catch {
    return NextResponse.json({ ok: false, content: '请求体不是合法 JSON' }, { status: 400 });
  }

  switch (body.tool) {
    case 'fetch_url':
      return NextResponse.json(await fetchPageText(String(body.url ?? '')));
    case 'web_search':
      return NextResponse.json(await search(String(body.query ?? '')));
    default:
      return NextResponse.json({ ok: false, content: `不支持的工具：${body.tool ?? '(空)'}` });
  }
}

/**
 * 搜索走 DuckDuckGo 的免 key 页面。
 *
 * 说实话：这是尽力而为的方案。没有正式 API 那么稳，结果条数也少，
 * 而且它哪天改版就可能失效。想要更稳的话，接一个正式的搜索 API 更靠谱。
 */
async function search(query: string) {
  const clean = query.trim();
  if (!clean) return { ok: false, content: '搜索词是空的' };

  const endpoint = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(clean)}`;

  try {
    const response = await fetch(endpoint, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      return { ok: false, content: `搜索服务返回 ${response.status}` };
    }

    const html = await response.text();
    const results = parseDuckDuckGo(html);

    if (results.length === 0) {
      return {
        ok: false,
        content: '没搜到结果，或者搜索页改版了解析失败。可以改用 fetch_url 直接抓具体网页。',
      };
    }

    const text = results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join('\n\n');

    return {
      ok: true,
      content: `搜索「${clean}」的结果：\n\n${text}`,
      display: `搜到 ${results.length} 条`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: `搜索失败：${message}` };
  }
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function parseDuckDuckGo(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blockPattern =
    /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>)?/gi;

  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) !== null && results.length < 8) {
    const url = normalizeDuckDuckGoUrl(match[1]);
    const title = htmlToText(match[2] ?? '', 200).replace(/\s+/g, ' ').trim();
    const snippet = htmlToText(match[3] ?? '', 400).replace(/\s+/g, ' ').trim();
    if (url && title) results.push({ title, url, snippet });
  }

  return results;
}

/** DuckDuckGo 的链接是 /l/?uddg=<encoded> 这种跳转形式，得还原成真实地址 */
function normalizeDuckDuckGoUrl(href: string): string {
  const decoded = href.startsWith('//') ? `https:${href}` : href;
  try {
    const url = new URL(decoded, 'https://duckduckgo.com');
    const target = url.searchParams.get('uddg');
    if (target) return decodeURIComponent(target);
    return url.toString();
  } catch {
    return '';
  }
}
