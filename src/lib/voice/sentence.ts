/**
 * 句子切分。
 *
 * 流式对话里最影响体感的一步：不等模型说完，凑够一句就送去合成，边生成边播。
 * 不切的话，用户要等到整段回答生成完才听见第一个字。
 */

const HARD_END = /[。！？!?；;\n]/;
const SOFT_END = /[，,、：:—]/;
/** 一直等不到句号时，超过这个长度就在逗号处强行切一刀 */
const MAX_LEN = 80;

export class SentenceBuffer {
  private buffer = '';

  /** 喂一段新内容，返回这次能切出来的完整句子 */
  push(chunk: string): string[] {
    if (!chunk) return [];
    this.buffer += chunk;

    const out: string[] = [];
    for (;;) {
      const cut = this.findCut(this.buffer);
      if (cut < 0) break;
      const sentence = this.buffer.slice(0, cut + 1).trim();
      this.buffer = this.buffer.slice(cut + 1);
      if (sentence) out.push(sentence);
    }
    return out;
  }

  /** 流结束，把剩下的尾巴交出来 */
  flush(): string | null {
    const rest = this.buffer.trim();
    this.buffer = '';
    return rest || null;
  }

  reset(): void {
    this.buffer = '';
  }

  get pending(): string {
    return this.buffer;
  }

  private findCut(text: string): number {
    for (let i = 0; i < text.length; i += 1) {
      if (HARD_END.test(text[i])) {
        // 句首就是标点（比如模型先吐了个换行），跳过它继续找
        if (text.slice(0, i + 1).trim().length === 0) continue;
        return i;
      }
    }
    if (text.length > MAX_LEN) {
      for (let i = MAX_LEN; i > MAX_LEN / 2; i -= 1) {
        if (SOFT_END.test(text[i])) return i;
      }
    }
    return -1;
  }
}
