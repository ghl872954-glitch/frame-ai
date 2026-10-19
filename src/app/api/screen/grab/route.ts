/**
 * 截屏接口。
 *
 * 用 POST 而不是 GET，有两个原因：
 *   1. GET 能被任意网页用 `<img src="http://localhost:3000/api/screen/grab">` 触发，
 *      等于给所有网站开了个偷偷截你屏的口子。POST 要过 CORS 预检，天然挡住。
 *   2. 参数是结构化的坐标，放 body 里比拼 query 干净。
 *
 * 另外只允许本机调用 —— 部署到公网时这个接口不该对外开放。
 */

import { NextResponse } from 'next/server';

import { isLocalRequest } from '@/lib/http';
import { grabScreen, type ScreenRegion } from '@/lib/screen/grab';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GrabRequestBody {
  region?: Partial<ScreenRegion>;
}

export async function POST(request: Request) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: '截屏只允许从本机调用' }, { status: 403 });
  }

  let body: GrabRequestBody = {};
  try {
    body = (await request.json()) as GrabRequestBody;
  } catch {
    // 空 body 也允许，等于截全屏
  }

  const region = normalizeRegion(body.region);

  try {
    const frame = await grabScreen(region);
    return NextResponse.json({
      image: `data:image/png;base64,${frame.data.toString('base64')}`,
      width: frame.width,
      height: frame.height,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `截屏失败：${message}` }, { status: 500 });
  }
}

/** 坐标来自前端，不能信 —— 夹到合理范围，太小的框当没传 */
function normalizeRegion(raw?: Partial<ScreenRegion>): ScreenRegion | undefined {
  if (!raw) return undefined;

  const nums = [raw.x, raw.y, raw.width, raw.height];
  if (nums.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return undefined;

  const width = Math.round(raw.width as number);
  const height = Math.round(raw.height as number);
  if (width < 8 || height < 8) return undefined;

  return {
    x: Math.max(0, Math.round(raw.x as number)),
    y: Math.max(0, Math.round(raw.y as number)),
    width: Math.min(width, 20_000),
    height: Math.min(height, 20_000),
  };
}
