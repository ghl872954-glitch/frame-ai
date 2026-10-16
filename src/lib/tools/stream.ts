/**
 * 流式输出里的工具块过滤。
 *
 * 场景：模型一边流式吐字，我们一边把内容送去合成播放。
 * 但如果它吐的是工具调用块（```tool {...}```），直接播出去就变成念 JSON 了。
 *
 * 做法是「留尾巴」：每次只放出已经确定安全的部分，最后 24 个字符先扣着。
 * 因为工具块的起始标记最长 7 个字符，扣 24 个字符足够等到标记完整出现，
 * 一旦发现块开始，就不再往外放，直到块结束。
 */

const START_MARKERS = ['```tool_call', '```tool', '<tool_call>'];
const END_MARKERS = ['</tool_call>', '```'];

/** 留多少字符不放出，必须大于最长起始标记 */
const HOLDBACK = 24;

interface Marker {
  index: number;
  length: number;
}

export class ToolAwareStream {
  private raw = '';
  private emitted = 0;
  private inBlock = false;

  /** 喂一段新内容，返回这次可以安全播放的文字 */
  push(chunk: string): string {
    if (!chunk) return '';
    this.raw += chunk;
    return this.drain(false);
  }

  /** 流结束，把剩下的交出来（如果停在工具块里就不交） */
  flush(): string {
    return this.drain(true);
  }

  /** 已经累积的全部原文 */
  get full(): string {
    return this.raw;
  }

  /** 扣着还没放出去的部分 */
  get pending(): string {
    return this.raw.slice(this.emitted);
  }

  private drain(final: boolean): string {
    let out = '';

    for (;;) {
      if (this.inBlock) {
        const end = this.findMarker(END_MARKERS, this.emitted);
        if (!end) return out; // 块还没结束，继续等
        this.inBlock = false;
        this.emitted = end.index + end.length;
        continue;
      }

      const start = this.findMarker(START_MARKERS, this.emitted);
      if (start) {
        out += this.raw.slice(this.emitted, start.index);
        this.emitted = start.index + start.length;
        this.inBlock = true;
        continue;
      }

      if (final) {
        out += this.raw.slice(this.emitted);
        this.emitted = this.raw.length;
        return out;
      }

      const safeEnd = Math.max(this.emitted, this.raw.length - HOLDBACK);
      out += this.raw.slice(this.emitted, safeEnd);
      this.emitted = safeEnd;
      return out;
    }
  }

  /** 从 from 开始找最早的标记；起始标记优先长匹配，避免 ```tool_call 被 ```tool 截断 */
  private findMarker(markers: string[], from: number): Marker | null {
    let best: Marker | null = null;
    for (const marker of markers) {
      const index = this.raw.indexOf(marker, from);
      if (index < 0) continue;
      if (!best || index < best.index || (index === best.index && marker.length > best.length)) {
        best = { index, length: marker.length };
      }
    }
    return best;
  }
}
