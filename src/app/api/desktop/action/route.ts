/**
 * 动作执行接口。
 *
 * 前端把「点哪儿 / 打什么」发过来，这里落到本机。
 * 两道门：
 *   1. 只接受本机请求（远程访问直接拒）
 *   2. 必须是 application/json —— 跨站请求发 JSON 会触发预检，
 *      没配 CORS 就发不出来，这样挡住「随便一个网页就能操纵你鼠标」的 CSRF。
 *
 * 这里只有 click 和 type 两种动作。没有任何删除/覆盖的函数可以调。
 */

import { NextResponse } from 'next/server';

import { clickAt, typeText } from '@/lib/desktop/input';
import { isLocalRequest } from '@/lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ActionBody {
  action?: string;
  x?: number;
  y?: number;
  text?: string;
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ ok: false, error: '只允许本机调用' }, { status: 403 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return NextResponse.json({ ok: false, error: '只接受 JSON' }, { status: 415 });
  }

  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 });
  }

  try {
    if (body.action === 'click') {
      const x = Math.round(Number(body.x));
      const y = Math.round(Number(body.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return NextResponse.json({ ok: false, error: '坐标不合法' }, { status: 400 });
      }
      await clickAt(x, y);
      return NextResponse.json({ ok: true, detail: `在 (${x}, ${y}) 点了一下` });
    }

    if (body.action === 'type') {
      const text = String(body.text ?? '');
      if (!text.trim()) {
        return NextResponse.json({ ok: false, error: '没有要输入的内容' }, { status: 400 });
      }
      if (text.length > 4000) {
        return NextResponse.json({ ok: false, error: '一次输入太长' }, { status: 400 });
      }
      await typeText(text);
      return NextResponse.json({ ok: true, detail: `输入了 ${text.length} 个字符` });
    }

    return NextResponse.json({ ok: false, error: '不认识的动作' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: `动作失败：${message}` }, { status: 500 });
  }
}
