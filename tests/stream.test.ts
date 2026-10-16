import { describe, expect, it } from 'vitest';

import { ToolAwareStream } from '@/lib/tools/stream';

const BLOCK = '```tool\n{"name":"get_time"}\n```';

describe('ToolAwareStream 流式过滤', () => {
  it('内容太短时先扣着不吐，等标记能完整出现', () => {
    const stream = new ToolAwareStream();
    expect(stream.push('你好')).toBe('');
    expect(stream.pending).toBe('你好');
  });

  it('超过留存量之后开始往外放，但尾巴还扣着', () => {
    const stream = new ToolAwareStream();
    const text = 'A'.repeat(30);
    expect(stream.push(text)).toBe('A'.repeat(6));
    expect(stream.pending).toBe('A'.repeat(24));
  });

  it('流结束时把扣着的尾巴补上', () => {
    const stream = new ToolAwareStream();
    stream.push('A'.repeat(30));
    expect(stream.flush()).toBe('A'.repeat(24));
    expect(stream.pending).toBe('');
  });

  it('纯工具块一个字都不往外放 —— 不能把 JSON 念给用户听', () => {
    const stream = new ToolAwareStream();
    expect(stream.push(BLOCK)).toBe('');
    expect(stream.flush()).toBe('');
  });

  it('工具块前后的正文都能正常放出，块本身被吃掉', () => {
    const stream = new ToolAwareStream();
    expect(stream.push('先算一下```tool\n{"name":"calculate"}\n```结果是 42')).toBe('先算一下');
    expect(stream.flush()).toBe('结果是 42');
    // full 里保留完整原文，调用方要再解析一遍工具调用时用得上
    expect(stream.full).toContain('```tool');
  });

  it('分多次喂进来也一样过滤得掉', () => {
    const stream = new ToolAwareStream();
    expect(stream.push('好的。')).toBe('');
    expect(stream.push(BLOCK)).toBe('好的。');
    expect(stream.push('现在告诉你。')).toBe('');
    expect(stream.flush()).toBe('现在告诉你。');
  });

  it('```tool_call 要整段吃掉，不能被 ```tool 截断留下半截', () => {
    const stream = new ToolAwareStream();
    const raw = 'hi```tool_call\n{"name":"x"}\n```';
    const out = stream.push(raw) + stream.flush();
    expect(out).toBe('hi');
    expect(out).not.toContain('call');
  });

  it('<tool_call> 这种 XML 写法也认', () => {
    const stream = new ToolAwareStream();
    const out =
      stream.push('查一下<tool_call>{"name":"web_search"}</tool_call>完毕') +
      stream.flush();
    expect(out).toBe('查一下完毕');
    expect(out).not.toContain('web_search');
  });

  it('块还没收尾就断流，不能把半截 JSON 吐出来', () => {
    const stream = new ToolAwareStream();
    expect(stream.push('看这个```tool\n{"name":"x"}')).toBe('看这个');
    expect(stream.flush()).toBe('');
  });

  it('连续两个工具块，中间的文字照样放出', () => {
    const stream = new ToolAwareStream();
    const raw = `${BLOCK}中间${BLOCK}结尾`;
    const out = stream.push(raw) + stream.flush();
    expect(out).toBe('中间结尾');
  });

  it('full 里始终保留完整原文，方便调用方再解析一遍', () => {
    const stream = new ToolAwareStream();
    const raw = `正文${BLOCK}`;
    stream.push(raw);
    expect(stream.full).toBe(raw);
  });

  it('空 chunk 不产生任何输出', () => {
    const stream = new ToolAwareStream();
    expect(stream.push('')).toBe('');
  });
});
