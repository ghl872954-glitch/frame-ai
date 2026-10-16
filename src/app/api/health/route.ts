/**
 * 自检。前端启动时会打一次，用来判断「本机能力」有哪些。
 *
 * 也方便用户排查问题：访问 /api/health 就能看到服务端这边什么情况。
 */

import { NextResponse } from 'next/server';
import { TOOLS } from '@/lib/tools/registry';
import { CAPABILITIES } from '@/lib/tools/policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const startedAt = process.uptime();

  return NextResponse.json({
    ok: true,
    app: 'frame',
    version: '0.1.0',
    runtime: {
      node: process.version,
      platform: process.platform,
      uptimeSeconds: Math.round(startedAt),
      /** 本地运行还是部署在服务器上 */
      mode: process.env.VERCEL ? 'cloud' : 'local',
    },
    tools: TOOLS.map((tool) => ({
      name: tool.name,
      capability: tool.capability,
      serverOnly: Boolean(tool.serverOnly),
    })),
    capabilities: CAPABILITIES.map((c) => ({
      id: c.id,
      level: c.level,
      label: c.label,
    })),
    redline: {
      // 这两句是写死的，任何配置都改不了
      delete: 'never',
      overwrite: 'never',
      note: '执行器里不存在删除和覆盖的函数，不是靠规则拦的',
    },
  });
}
