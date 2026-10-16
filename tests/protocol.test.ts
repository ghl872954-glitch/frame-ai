import { describe, expect, it } from 'vitest';

import { buildToolHint, parseToolCalls, stripToolCalls } from '@/lib/tools/protocol';

describe('parseToolCalls 提示词协议解析', () => {
  it('认出标准写法', () => {
    const result = parseToolCalls('```tool\n{"name":"get_time","arguments":{}}\n```');
    expect(result.calls).toEqual([{ name: 'get_time', arguments: {} }]);
    expect(result.cleaned).toBe('');
  });

  it('工具块从正文里删干净，不能留下痕迹', () => {
    const text = '好的，我来查一下。\n\n```tool\n{"name":"get_time"}\n```\n\n查到了。';
    const result = parseToolCalls(text);
    expect(result.calls).toHaveLength(1);
    expect(result.cleaned).toContain('好的，我来查一下。');
    expect(result.cleaned).toContain('查到了。');
    expect(result.cleaned).not.toContain('get_time');
    expect(result.cleaned).not.toContain('```');
  });

  it('一次输出多个调用，全都收下', () => {
    const text = [
      '```tool',
      '{"name":"get_time","arguments":{}}',
      '```',
      '```tool',
      '{"name":"calculate","arguments":{"expression":"1+1"}}',
      '```',
    ].join('\n');
    const result = parseToolCalls(text);
    expect(result.calls.map((call) => call.name)).toEqual(['get_time', 'calculate']);
    expect(result.calls[1].arguments).toEqual({ expression: '1+1' });
  });

  it('XML 写法也认', () => {
    const result = parseToolCalls('<tool_call>{"name":"web_search","arguments":{"query":"天气"}}</tool_call>');
    expect(result.calls).toEqual([{ name: 'web_search', arguments: { query: '天气' } }]);
  });

  it('字段名各家不一样，统一成 name + arguments', () => {
    const cases: [string, string][] = [
      ['{"tool":"get_time","args":{}}', 'get_time'],
      ['{"tool_name":"get_time","parameters":{}}', 'get_time'],
      ['{"name":"get_time","params":{}}', 'get_time'],
      ['{"function":{"name":"get_time"},"arguments":{}}', 'get_time'],
    ];
    for (const [body, expected] of cases) {
      const result = parseToolCalls(`\`\`\`tool\n${body}\n\`\`\``);
      expect(result.calls[0]?.name, body).toBe(expected);
    }
  });

  it('参数写成字符串（很多模型会这样）也能还原成对象', () => {
    const text = '```tool\n{"name":"calculate","arguments":"{\'expression\':\'1+1\'}"}\n```';
    const result = parseToolCalls(text);
    expect(result.calls[0].arguments).toEqual({ expression: '1+1' });
  });

  it('单引号 JSON 兜底', () => {
    const result = parseToolCalls("```tool\n{'name':'get_time','arguments':{}}\n```");
    expect(result.calls[0]?.name).toBe('get_time');
  });

  it('JSON 前面带解释文字也扒得出来', () => {
    const text = '```tool\n我来调用一下：\n{"name":"get_time","arguments":{}}\n```';
    expect(parseToolCalls(text).calls[0]?.name).toBe('get_time');
  });

  it('围栏里不是 JSON 就当没看见，原文保留', () => {
    const text = '看这段代码：\n\n```js\nconsole.log(1)\n```';
    const result = parseToolCalls(text);
    expect(result.calls).toEqual([]);
    expect(result.cleaned).toContain('console.log(1)');
  });

  it('用户要一段 JSON 示例，不能被当成工具调用吃掉', () => {
    const text = '给你：\n\n```json\n{"name": "张三", "age": 30}\n```';
    const result = parseToolCalls(text);
    expect(result.calls).toEqual([]);
    expect(result.cleaned).toContain('张三');
  });

  it('没打 tool 标记，但 name 和 arguments 都在，仍然认', () => {
    const result = parseToolCalls('```\n{"name":"get_time","arguments":{}}\n```');
    expect(result.calls).toHaveLength(1);
  });

  it('只有 name 没有 arguments 的裸围栏不算调用', () => {
    const result = parseToolCalls('```\n{"name":"get_time"}\n```');
    expect(result.calls).toEqual([]);
  });

  it('缺少 name 的对象不算调用', () => {
    expect(parseToolCalls('```tool\n{"arguments":{}}\n```').calls).toEqual([]);
    expect(parseToolCalls('```tool\n{"foo":"bar"}\n```').calls).toEqual([]);
  });

  it('数组形式的 JSON 不算调用', () => {
    expect(parseToolCalls('```tool\n[{"name":"get_time"}]\n```').calls).toEqual([]);
  });

  it('空输入返回空结果，不炸', () => {
    expect(parseToolCalls('')).toEqual({ calls: [], cleaned: '' });
  });

  it('纯正文原样返回', () => {
    expect(stripToolCalls('今天天气不错。')).toBe('今天天气不错。');
  });
});

describe('buildToolHint', () => {
  it('没有工具时不往提示词里塞东西', () => {
    expect(buildToolHint([])).toBe('');
  });

  it('中文提示词里带上工具名、参数和调用格式', () => {
    const hint = buildToolHint([
      {
        name: 'calculate',
        description: '算数学题',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string', description: '算式' } },
        },
      },
    ]);
    expect(hint).toContain('calculate');
    expect(hint).toContain('expression(string)');
    expect(hint).toContain('```tool');
    expect(hint).toContain('不要把 JSON 念给用户听');
  });

  it('英文提示词走另一套文案', () => {
    const hint = buildToolHint(
      [{ name: 'get_time', description: 'get time', parameters: { type: 'object', properties: {} } }],
      'en',
    );
    expect(hint).toContain('Available tools:');
    expect(hint).toContain('never read it out loud');
  });

  it('没有参数的工具也能列出来，不留个空括号', () => {
    const hint = buildToolHint([
      { name: 'get_time', description: '获取时间', parameters: { type: 'object', properties: {} } },
    ]);
    expect(hint).toContain('- get_time() — 获取时间');
  });
});
