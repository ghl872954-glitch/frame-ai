/**
 * 工具调用协议解析。
 *
 * 为什么需要这个：很多模型（尤其是便宜的、本地跑的小模型）**不支持原生 function calling**。
 * 如果工具能力绑死在原生 function calling 上，这些模型的用户就用不了执行功能。
 *
 * 所以除了原生方式，还有一条兜底：把工具清单写进提示词，要求模型输出一个约定格式的代码块，
 * 我们解析出来执行。这条路径对所有模型都通用。
 *
 * 一个容易忽略的细节：解析完必须把工具块从文本里**删掉**，
 * 否则 TTS 会把 `{"name":"get_time"}` 一字一句念给用户听。
 */

export interface ParsedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ParseResult {
  calls: ParsedToolCall[];
  /** 去掉工具块之后、可以拿去朗读和显示的正文 */
  cleaned: string;
}

const XML_BLOCK = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
/** 围栏的语言标记单独捕获 —— 标记决定这一段算不算工具调用 */
const FENCED_BLOCK = /```([a-zA-Z_-]*)[ \t]*\r?\n([\s\S]*?)```/gi;

const TOOL_TAGS = new Set(['tool', 'tool_call', 'toolcall']);
const ARG_KEYS = ['arguments', 'args', 'parameters', 'params'];

/** 挂到系统提示词后面，告诉模型怎么调用工具 */
export function buildToolHint(
  tools: { name: string; description: string; parameters: Record<string, unknown> }[],
  lang: 'zh' | 'en' = 'zh',
): string {
  if (tools.length === 0) return '';

  const list = tools
    .map((tool) => {
      const params = Object.entries(
        (tool.parameters.properties as Record<string, { type?: string; description?: string }>) ??
          {},
      )
        .map(([key, schema]) => `${key}(${schema.type ?? 'any'})`)
        .join(', ');
      return `- ${tool.name}(${params}) — ${tool.description}`;
    })
    .join('\n');

  if (lang === 'en') {
    return [
      'You can call tools. When you need one, output a fenced block exactly like this and nothing else inside it:',
      '',
      '```tool',
      '{"name": "tool_name", "arguments": {"arg": "value"}}',
      '```',
      '',
      'Available tools:',
      list,
      '',
      'Rules: one block per call, multiple calls are allowed. After the block, wait for the result.',
      'Never mention the JSON to the user, and never read it out loud.',
    ].join('\n');
  }

  return [
    '你可以调用工具。需要调用时，输出一个如下格式的代码块，块内只放 JSON：',
    '',
    '```tool',
    '{"name": "工具名", "arguments": {"参数": "值"}}',
    '```',
    '',
    '可用的工具：',
    list,
    '',
    '规则：一次调用一个块，可以有多个块。输出块之后停下来等结果。',
    '不要把 JSON 念给用户听，也不要跟用户提这段 JSON。',
  ].join('\n');
}

export function parseToolCalls(text: string): ParseResult {
  if (!text) return { calls: [], cleaned: '' };

  const calls: ParsedToolCall[] = [];
  const spans: [number, number][] = [];
  let match: RegExpExecArray | null;

  XML_BLOCK.lastIndex = 0;
  while ((match = XML_BLOCK.exec(text)) !== null) {
    const parsed = normalize(parseJsonLoose(match[1]));
    if (!parsed) continue;
    calls.push(parsed);
    spans.push([match.index, match.index + match[0].length]);
  }

  FENCED_BLOCK.lastIndex = 0;
  while ((match = FENCED_BLOCK.exec(text)) !== null) {
    const tag = match[1].toLowerCase();
    const json = parseJsonLoose(match[2]);

    // 打了 tool 标记的围栏，只要 JSON 说得通就认。
    // 没打标记的（或者标成 json 的）要多一道判断：必须同时给出名字和参数，
    // 否则用户只是想看一段 JSON 示例，也会被当成工具调用吃掉。
    if (!TOOL_TAGS.has(tag) && !hasArgKey(json)) continue;

    const parsed = normalize(json);
    if (!parsed) continue;

    calls.push(parsed);
    spans.push([match.index, match.index + match[0].length]);
  }

  const cleaned = removeSpans(text, spans).trim();
  return { calls, cleaned };
}

/** 只要正文，不要调用 */
export function stripToolCalls(text: string): string {
  return parseToolCalls(text).cleaned;
}

/** 模型有时会把 JSON 包在解释里，或者用单引号，逐级降级试 */
function parseJsonLoose(body: string): unknown {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));

  // 单引号 → 双引号（只在简单场景下兜底）
  if (trimmed.includes("'") && !trimmed.includes('"')) {
    candidates.push(trimmed.replace(/'/g, '"'));
  }

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object') return value;
    } catch {
      // 继续试下一个
    }
  }
  return null;
}

/** 把各家模型五花八门的字段名统一成 {name, arguments} */
function normalize(value: unknown): ParsedToolCall | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const name =
    firstString(record.name) ??
    firstString(record.tool) ??
    firstString(record.tool_name) ??
    firstString(record.function);

  if (!name) return null;

  let args = record.arguments ?? record.args ?? record.parameters ?? record.params ?? {};

  if (typeof args === 'string') {
    const parsed = parseJsonLoose(args);
    args = parsed ?? {};
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};

  return { name, arguments: args as Record<string, unknown> };
}

/** 解析出来的对象里有没有显式给参数。没打 tool 标记时用它来区分「工具调用」和「示例 JSON」 */
function hasArgKey(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ARG_KEYS.some((key) => key in record);
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  // 有些模型会写成 {"function": {"name": "x"}}
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const inner = (value as Record<string, unknown>).name;
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
  }
  return null;
}

function removeSpans(text: string, spans: [number, number][]): string {
  if (spans.length === 0) return text;
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let out = '';
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start < cursor) continue;
    out += text.slice(cursor, start);
    cursor = end;
  }
  out += text.slice(cursor);
  return out;
}
