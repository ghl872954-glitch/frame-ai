import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 这一组测的是完整的一轮：拼提示词 → 流式生成 → 解析工具调用 → 过策略 → 执行 → 喂回去 → 再生成。
 * 把网络那一层换成假模型，其余全走真代码。
 */

const mock = vi.hoisted(() => ({
  replies: [] as string[],
  index: 0,
  lastMessages: [] as { role: string; content: string }[],
  callCount: 0,
}));

vi.mock('@/lib/chat', () => ({
  ChatError: class ChatError extends Error {},
  streamChat: async (options: {
    messages: { role: string; content: string }[];
    onChunk?: (chunk: string) => void;
  }) => {
    mock.lastMessages = options.messages;
    mock.callCount += 1;
    const text = mock.replies[mock.index] ?? mock.replies[mock.replies.length - 1] ?? '';
    mock.index += 1;
    // 故意切成小段喂进去，顺带验证流式过滤在碎片输入下也站得住
    for (let i = 0; i < text.length; i += 3) {
      options.onChunk?.(text.slice(i, i + 3));
    }
    return { text, toolCalls: null };
  },
}));

const { runAgentTurn } = await import('@/lib/agent');
const { defaultConfig } = await import('@/lib/config');
const { addFact, emptyMemory } = await import('@/lib/memory');

function block(name: string, args: Record<string, unknown> = {}): string {
  return `\`\`\`tool\n${JSON.stringify({ name, arguments: args })}\n\`\`\``;
}

function turn(overrides: {
  userText?: string;
  grants?: Record<string, 'granted' | 'denied' | 'ask'>;
  memoryEnabled?: boolean;
  memory?: ReturnType<typeof emptyMemory>;
  maxSteps?: number;
  signal?: AbortSignal;
} = {}) {
  const config = defaultConfig();
  config.provider.apiKey = 'test-key';
  config.memory.enabled = overrides.memoryEnabled ?? true;

  return runAgentTurn({
    config,
    memory: overrides.memory ?? emptyMemory(),
    history: [],
    userText: overrides.userText ?? '在吗',
    grants: overrides.grants ?? {},
    signal: overrides.signal ?? new AbortController().signal,
    maxSteps: overrides.maxSteps,
  });
}

beforeEach(() => {
  mock.replies = [];
  mock.index = 0;
  mock.lastMessages = [];
  mock.callCount = 0;
});

describe('普通对话', () => {
  it('没有工具调用时，一轮就结束', async () => {
    mock.replies = ['今天天气不错。'];
    const result = await turn({ userText: '天气怎么样' });
    expect(result.text).toBe('今天天气不错。');
    expect(result.tools).toEqual([]);
    expect(mock.callCount).toBe(1);
  });

  it('本轮的消息都记下来，方便调用方存历史', async () => {
    mock.replies = ['在的。'];
    const result = await turn({ userText: '在吗' });
    expect(result.appended).toEqual([
      { role: 'user', content: '在吗' },
      { role: 'assistant', content: '在的。' },
    ]);
  });

  it('系统提示词带上工具清单', async () => {
    mock.replies = ['好。'];
    await turn({ userText: '在吗' });
    const system = mock.lastMessages[0];
    expect(system.role).toBe('system');
    expect(system.content).toContain('get_time');
    expect(system.content).toContain('```tool');
  });

  it('记忆里的东西会注入提示词', async () => {
    mock.replies = ['好。'];
    const memory = addFact(emptyMemory(), '用户在做医疗系统的安全自查');
    await turn({ userText: '在吗', memory });
    expect(mock.lastMessages[0].content).toContain('用户在做医疗系统的安全自查');
  });

  it('记忆关掉之后一个字都不注入', async () => {
    mock.replies = ['好。'];
    const memory = addFact(emptyMemory(), '这条不该出现');
    await turn({ userText: '在吗', memory, memoryEnabled: false });
    expect(mock.lastMessages[0].content).not.toContain('这条不该出现');
  });

  it('工具块不会混进最终正文里', async () => {
    mock.replies = [`好的，我查一下。${block('get_time')}现在是下午三点。`, '就是现在。'];
    const result = await turn();
    expect(result.text).not.toContain('get_time');
    expect(result.text).not.toContain('```');
    expect(result.text).toContain('好的，我查一下。');
    expect(result.text).toContain('现在是下午三点。');
  });
});

describe('工具调用', () => {
  it('调用一次工具，把结果喂回去再生成一轮', async () => {
    mock.replies = [block('get_time'), '现在是下午三点。'];
    const result = await turn();

    expect(result.tools).toHaveLength(1);
    expect(result.tools[0].name).toBe('get_time');
    expect(result.tools[0].status).toBe('done');
    expect(mock.callCount).toBe(2);
    expect(result.text).toContain('现在是下午三点。');
  });

  it('工具结果以 user 消息回灌，模型才知道发生了什么', async () => {
    mock.replies = [block('calculate', { expression: '12*8' }), '等于 96。'];
    await turn();
    const injected = mock.lastMessages.find((message) =>
      message.content.includes('[工具结果]'),
    );
    expect(injected).toBeDefined();
    expect(injected?.content).toContain('calculate');
    expect(injected?.content).toContain('96');
  });

  it('多步循环最多跑 maxSteps 轮，不会无限转下去', async () => {
    mock.replies = [block('get_time'), block('get_time'), block('get_time')];
    const result = await turn({ maxSteps: 2 });
    expect(result.tools).toHaveLength(2);
    expect(mock.callCount).toBe(2);
  });

  it('模型说了一个不存在的工具，如实报错而不是假装成功', async () => {
    mock.replies = [block('launch_missiles'), '抱歉，我做不到。'];
    const result = await turn();
    expect(result.tools[0].status).toBe('error');
    expect(result.tools[0].detail).toContain('没有这个工具');
  });

  it('用户拒绝过的工具不再出现在提示词里，省得模型反复尝试', async () => {
    mock.replies = ['好。'];
    await turn({ grants: { 'web.fetch': 'denied' } });
    expect(mock.lastMessages[0].content).not.toContain('fetch_url');
    expect(mock.lastMessages[0].content).toContain('get_time');
  });

  it('中途被打断时不再执行工具', async () => {
    mock.replies = [block('get_time')];
    const controller = new AbortController();
    controller.abort();
    const result = await turn({ signal: controller.signal });
    expect(result.tools).toEqual([]);
  });
});

describe('红线在真实链路里也拦得住', () => {
  it('参数里带删除命令，直接被拒，连执行的机会都没有', async () => {
    mock.replies = [block('web_search', { query: 'rm -rf /' }), '这个我不能做。'];
    const result = await turn();
    expect(result.tools[0].status).toBe('denied');
    expect(result.tools[0].detail).toContain('删除');
  });

  it('拒绝的结果照样喂回模型，让它如实告诉用户', async () => {
    mock.replies = [block('web_search', { query: 'rm -rf /' }), '这个我不能做。'];
    await turn();
    const injected = mock.lastMessages.find((message) => message.content.includes('[工具结果]'));
    expect(injected?.content).toContain('被拒绝');
    expect(injected?.content).toContain('不要再试一次');
  });

  it('就算用户点过「以后都允许」，红线仍然优先', async () => {
    mock.replies = [block('web_search', { query: 'shutdown -h now' }), '不行。'];
    const result = await turn({ grants: { 'web.search': 'granted' } });
    expect(result.tools[0].status).toBe('denied');
  });
});

describe('记忆写入', () => {
  it('remember 工具会把内容落进记忆，并带回给调用方', async () => {
    mock.replies = [block('remember', { text: '用户在做医疗系统安全自查' }), '好，记住了。'];
    const result = await turn();
    expect(result.tools[0].status).toBe('done');
    expect(result.memory.facts[0].text).toBe('用户在做医疗系统安全自查');
    expect(result.memory.facts[0].source).toBe('auto');
  });

  it('记忆功能关掉时，remember 被拒', async () => {
    mock.replies = [block('remember', { text: '不该记住' }), '好。'];
    const result = await turn({ memoryEnabled: false });
    expect(result.tools[0].status).toBe('denied');
    expect(result.memory.facts).toEqual([]);
  });

  it('要记的内容是空的，报错而不是塞一条空记录', async () => {
    mock.replies = [block('remember', { text: '   ' }), '好。'];
    const result = await turn();
    expect(result.tools[0].status).toBe('error');
    expect(result.memory.facts).toEqual([]);
  });
});

describe('流式回调', () => {
  it('onChunk 拿到的都是能安全念出来的文字，没有 JSON', async () => {
    mock.replies = [`先说一句。${block('get_time')}再说一句。`, '完了。'];
    const chunks: string[] = [];
    const config = defaultConfig();
    config.provider.apiKey = 'k';

    await runAgentTurn({
      config,
      memory: emptyMemory(),
      history: [],
      userText: '几点了',
      grants: {},
      signal: new AbortController().signal,
      onChunk: (chunk) => chunks.push(chunk),
    });

    const spoken = chunks.join('');
    expect(spoken).not.toContain('get_time');
    expect(spoken).toContain('先说一句。');
    expect(spoken).toContain('再说一句。');
  });

  it('onTool 每次执行都会回调一次，界面能实时显示', async () => {
    mock.replies = [block('get_time'), '好了。'];
    const seen: string[] = [];
    const config = defaultConfig();
    config.provider.apiKey = 'k';

    await runAgentTurn({
      config,
      memory: emptyMemory(),
      history: [],
      userText: '几点了',
      grants: {},
      signal: new AbortController().signal,
      onTool: (record) => seen.push(record.name),
    });

    expect(seen).toEqual(['get_time']);
  });
});
