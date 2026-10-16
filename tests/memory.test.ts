import { describe, expect, it } from 'vitest';

import {
  addFact,
  addSummary,
  clearMemory,
  emptyMemory,
  exportMemory,
  memoryStats,
  removeFact,
  removeSummary,
  summarizeForPrompt,
  type MemoryState,
} from '@/lib/memory';

describe('记忆：事实', () => {
  it('新加的放最前面，界面上好找', () => {
    let state = emptyMemory();
    state = addFact(state, '第一条');
    state = addFact(state, '第二条');
    expect(state.facts.map((fact) => fact.text)).toEqual(['第二条', '第一条']);
  });

  it('同样的话不重复记，大小写和空格都算同一条', () => {
    let state = emptyMemory();
    state = addFact(state, '我不吃香菜');
    const before = state;
    expect(addFact(state, '我不吃香菜')).toBe(before);
    expect(addFact(state, '  我不吃香菜  ')).toBe(before);
    expect(state.facts).toHaveLength(1);
  });

  it('空内容不记，返回原状态而不是造一条空记录', () => {
    const state = emptyMemory();
    expect(addFact(state, '')).toBe(state);
    expect(addFact(state, '   ')).toBe(state);
  });

  it('记下来源，自动记的和手动加的能分开', () => {
    let state = addFact(emptyMemory(), '自动记的', 'auto');
    state = addFact(state, '手动加的', 'manual');
    expect(state.facts[0].source).toBe('manual');
    expect(state.facts[1].source).toBe('auto');
  });

  it('每条都有 id 和时间，用户能逐条删', () => {
    const state = addFact(emptyMemory(), '一条');
    expect(state.facts[0].id).toBeTruthy();
    expect(state.facts[0].createdAt).toBeGreaterThan(0);
  });

  it('按 id 删得掉', () => {
    let state = addFact(emptyMemory(), 'a');
    state = addFact(state, 'b');
    const target = state.facts[0].id;
    state = removeFact(state, target);
    expect(state.facts).toHaveLength(1);
    expect(state.facts[0].text).toBe('a');
  });

  it('删不存在的 id 不出错', () => {
    const state = addFact(emptyMemory(), 'a');
    expect(() => removeFact(state, 'nope')).not.toThrow();
    expect(removeFact(state, 'nope').facts).toHaveLength(1);
  });
});

describe('记忆：摘要', () => {
  it('摘要记下覆盖了几轮对话', () => {
    const state = addSummary(emptyMemory(), '聊了聊部署的事', 12);
    expect(state.summaries[0].turns).toBe(12);
  });

  it('空摘要不记', () => {
    const state = emptyMemory();
    expect(addSummary(state, '  ', 3)).toBe(state);
  });

  it('按 id 删得掉', () => {
    let state = addSummary(emptyMemory(), 'x', 1);
    state = addSummary(state, 'y', 2);
    state = removeSummary(state, state.summaries[0].id);
    expect(state.summaries.map((s) => s.text)).toEqual(['x']);
  });
});

describe('喂给模型的部分', () => {
  it('事实和摘要都带上', () => {
    let state = addFact(emptyMemory(), '在做医疗系统安全自查');
    state = addSummary(state, '聊过部署方案', 6);
    const text = summarizeForPrompt(state);
    expect(text).toContain('在做医疗系统安全自查');
    expect(text).toContain('聊过部署方案');
  });

  it('摘要有的是历史，最多带最近三条，别把上下文挤爆', () => {
    let state: MemoryState = emptyMemory();
    for (let i = 1; i <= 6; i += 1) state = addSummary(state, `摘要${i}`, i);
    const text = summarizeForPrompt(state);
    expect(text).toContain('摘要6');
    expect(text).toContain('摘要4');
    expect(text).not.toContain('摘要3');
    expect(text).not.toContain('摘要1');
  });

  it('超过预算就截断，宁可少记也不要撑爆上下文', () => {
    let state = emptyMemory();
    for (let i = 0; i < 50; i += 1) state = addFact(state, `这是第 ${i} 条很长的记忆内容`);
    const text = summarizeForPrompt(state, 100);
    expect(text.length).toBeLessThanOrEqual(101);
    expect(text.endsWith('…')).toBe(true);
  });

  it('空记忆返回空串，不会塞一段没用的标题进提示词', () => {
    expect(summarizeForPrompt(emptyMemory())).toBe('');
  });

  it('事实在前、摘要在后，模型先看到最稳定的偏好', () => {
    let state = addFact(emptyMemory(), '事实');
    state = addSummary(state, '摘要', 1);
    const text = summarizeForPrompt(state);
    expect(text.indexOf('事实')).toBeLessThan(text.indexOf('摘要'));
  });
});

describe('导出与清空', () => {
  it('导出的是能直接解析的 JSON，没有隐藏字段', () => {
    let state = addFact(emptyMemory(), 'a');
    state = addSummary(state, 'b', 2);
    const parsed = JSON.parse(exportMemory(state));
    expect(parsed.facts).toHaveLength(1);
    expect(parsed.summaries).toHaveLength(1);
    expect(Object.keys(parsed).sort()).toEqual(['facts', 'summaries']);
  });

  it('清空之后什么都不剩', () => {
    const populated = addSummary(addFact(emptyMemory(), 'a'), 'b', 1);
    expect(memoryStats(populated)).toEqual({ facts: 1, summaries: 1 });

    const wiped = clearMemory();
    expect(memoryStats(wiped)).toEqual({ facts: 0, summaries: 0 });
    expect(wiped.facts).toEqual([]);
    expect(wiped.summaries).toEqual([]);
  });

  it('统计数字对得上', () => {
    let state = addFact(emptyMemory(), 'a');
    state = addFact(state, 'b');
    state = addSummary(state, 'c', 1);
    expect(memoryStats(state)).toEqual({ facts: 2, summaries: 1 });
  });
});
