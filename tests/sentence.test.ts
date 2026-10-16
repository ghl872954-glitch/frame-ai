import { describe, expect, it } from 'vitest';

import { SentenceBuffer } from '@/lib/voice/sentence';

describe('SentenceBuffer 流式切句', () => {
  it('凑够句号才吐出来', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('今天天气')).toEqual([]);
    expect(buffer.push('不错。')).toEqual(['今天天气不错。']);
  });

  it('一次喂进来好几句，全部切出来', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('第一句。第二句！第三句？')).toEqual([
      '第一句。',
      '第二句！',
      '第三句？',
    ]);
  });

  it('换行也算断句 —— 模型经常用换行分段', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('先说结论\n')).toEqual(['先说结论']);
  });

  it('句首的换行不算一句，跳过继续找', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('\n\n')).toEqual([]);
    expect(buffer.push('你好。')).toEqual(['你好。']);
  });

  it('半角标点也认', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('OK!')).toEqual(['OK!']);
    expect(buffer.push('Sure?')).toEqual(['Sure?']);
  });

  it('一直不出现句号时，在逗号处强行切一刀，避免憋太久', () => {
    const buffer = new SentenceBuffer();
    const long = `${'甲'.repeat(60)}，${'乙'.repeat(40)}`;
    const out = buffer.push(long);
    expect(out).toHaveLength(1);
    expect(out[0].endsWith('，')).toBe(true);
    expect(out[0].length).toBe(61);
    // 剩下的没丢，还在缓冲区里
    expect(buffer.pending).toBe('乙'.repeat(40));
  });

  it('长度没超上限就不切，宁可等一个完整句子', () => {
    const buffer = new SentenceBuffer();
    const short = `${'甲'.repeat(20)}，${'乙'.repeat(10)}`;
    expect(buffer.push(short)).toEqual([]);
  });

  it('flush 把没说完的尾巴交出来', () => {
    const buffer = new SentenceBuffer();
    buffer.push('说到一半');
    expect(buffer.flush()).toBe('说到一半');
    expect(buffer.pending).toBe('');
  });

  it('缓冲区是空的时 flush 返回 null', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.flush()).toBeNull();
  });

  it('空字符串不产生任何东西', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('')).toEqual([]);
  });

  it('reset 清掉没说完的话', () => {
    const buffer = new SentenceBuffer();
    buffer.push('说到一半');
    buffer.reset();
    expect(buffer.pending).toBe('');
    expect(buffer.flush()).toBeNull();
  });

  it('切出来的句子不带前后空白', () => {
    const buffer = new SentenceBuffer();
    expect(buffer.push('  你好。  ')).toEqual(['你好。']);
  });
});
