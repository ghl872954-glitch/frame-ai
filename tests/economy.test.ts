import { describe, expect, it } from 'vitest';

import { composeSystemPrompt } from '@/lib/personas';

/**
 * 省钱是默认行为，不是开关。这里守住两条最容易被改回去的：
 *   1. 系统提示里始终要求「回答简短」
 *   2. 换了人格也照样要求简短
 */

describe('默认就省：系统提示要求简短', () => {
  it('中文默认提示里带「回答保持简短」', () => {
    const prompt = composeSystemPrompt({ personaEnabled: false, language: 'zh' });
    expect(prompt).toContain('回答保持简短');
  });

  it('英文默认提示里也带', () => {
    const prompt = composeSystemPrompt({ personaEnabled: false, language: 'en' });
    expect(prompt).toContain('Keep replies short');
  });

  it('启用了人格也仍然要求简短', () => {
    const prompt = composeSystemPrompt({
      personaEnabled: true,
      persona: { id: 'x', name: 'x', prompt: '你是一只猫。', greeting: '' } as never,
      language: 'zh',
    });
    expect(prompt).toContain('你是一只猫。');
    expect(prompt).toContain('回答保持简短');
  });
});
