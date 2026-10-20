import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 动作层（点击 / 输入）。
 *
 * 只测「决策与坐标换算」这一层：真正的鼠标键盘在 Windows 上，node 里跑不了，
 * 那部分靠 `npm run electron` 在真机上验。
 *
 * 重点盯三件事：
 *   1. 动作层永远逐次确认，即使用户给过「以后都允许」
 *   2. 坐标锁在框选区域内，越界会被夹回来
 *   3. 用户拒绝就一步都不执行
 */

const mock = vi.hoisted(() => ({
  replies: [] as string[],
  index: 0,
  fetchCalls: [] as { url: string; body: unknown }[],
}));

vi.mock('@/lib/chat', () => ({
  ChatError: class ChatError extends Error {},
  streamChat: async (options: { onChunk?: (chunk: string) => void }) => {
    const text = mock.replies[mock.index] ?? mock.replies[mock.replies.length - 1] ?? '';
    mock.index += 1;
    for (let i = 0; i < text.length; i += 4) options.onChunk?.(text.slice(i, i + 4));
    return { text, toolCalls: null };
  },
}));

const { runAgentTurn } = await import('@/lib/agent');
const { defaultConfig } = await import('@/lib/config');
const { emptyMemory } = await import('@/lib/memory');

function block(name: string, args: Record<string, unknown> = {}): string {
  return `\`\`\`tool\n${JSON.stringify({ name, arguments: args })}\n\`\`\``;
}

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function turn(overrides: {
  replies: string[];
  region?: Region | null;
  grants?: Record<string, 'granted' | 'denied' | 'ask'>;
  approve?: boolean;
}) {
  mock.replies = overrides.replies;
  mock.index = 0;

  const config = defaultConfig();
  config.provider.apiKey = 'k';

  const confirmed: string[] = [];
  const result = await runAgentTurn({
    config,
    memory: emptyMemory(),
    history: [],
    userText: '帮我点一下',
    region: overrides.region ?? null,
    grants: overrides.grants ?? {},
    signal: new AbortController().signal,
    confirm: async (request) => {
      confirmed.push(request.detail);
      return overrides.approve ?? true;
    },
  });

  return { result, confirmed };
}

beforeEach(() => {
  mock.replies = [];
  mock.index = 0;
  mock.fetchCalls = [];
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    mock.fetchCalls.push({ url: String(url), body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, detail: '已执行' }),
    } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const REGION: Region = { x: 100, y: 200, width: 400, height: 300 };

describe('点击', () => {
  it('没框选区域时直接拒绝，不会瞎点', async () => {
    const { result } = await turn({
      replies: [block('desktop_click', { nx: 0.5, ny: 0.5 }), '好。'],
      region: null,
    });
    expect(result.tools[0].status).toBe('error');
    expect(result.tools[0].detail).toContain('还没框选');
    expect(mock.fetchCalls).toHaveLength(0);
  });

  it('相对坐标换算成屏幕绝对坐标', async () => {
    const { result } = await turn({
      replies: [block('desktop_click', { nx: 0.5, ny: 0.5 }), '点好了。'],
      region: REGION,
    });
    expect(result.tools[0].status).toBe('done');
    expect(mock.fetchCalls[0].body).toEqual({ action: 'click', x: 300, y: 350 });
  });

  it('坐标越界会被夹回框内（锁死不会点到框外）', async () => {
    await turn({
      replies: [block('desktop_click', { nx: 5, ny: -3 }), '好。'],
      region: REGION,
    });
    // nx 夹到 1 → 100 + 400 = 500；ny 夹到 0 → 200 + 0 = 200
    expect(mock.fetchCalls[0].body).toEqual({ action: 'click', x: 500, y: 200 });
  });
});

describe('确认', () => {
  it('即使用户给过「以后都允许」，动作层仍然逐次确认', async () => {
    const { confirmed } = await turn({
      replies: [block('desktop_click', { nx: 0.1, ny: 0.1 }), '好。'],
      region: REGION,
      grants: { 'desktop.control': 'granted' },
    });
    expect(confirmed).toHaveLength(1);
  });

  it('用户拒绝就一步都不执行', async () => {
    const { result } = await turn({
      replies: [block('desktop_click', { nx: 0.1, ny: 0.1 }), '好。'],
      region: REGION,
      approve: false,
    });
    expect(result.tools[0].status).toBe('denied');
    expect(mock.fetchCalls).toHaveLength(0);
  });
});

describe('输入', () => {
  it('把原文一字不改地发出去', async () => {
    const { result } = await turn({
      replies: [block('desktop_type', { text: '你好，世界' }), '打好了。'],
      region: REGION,
    });
    expect(result.tools[0].status).toBe('done');
    expect(mock.fetchCalls[0].body).toEqual({ action: 'type', text: '你好，世界' });
  });

  it('空内容报错，不会发一个空动作出去', async () => {
    const { result } = await turn({
      replies: [block('desktop_type', { text: '   ' }), '好。'],
      region: REGION,
    });
    expect(result.tools[0].status).toBe('error');
    expect(mock.fetchCalls).toHaveLength(0);
  });

  it('一次输入太长会被拒', async () => {
    const { result } = await turn({
      replies: [block('desktop_type', { text: 'a'.repeat(4001) }), '好。'],
      region: REGION,
    });
    expect(result.tools[0].status).toBe('error');
    expect(mock.fetchCalls).toHaveLength(0);
  });
});
