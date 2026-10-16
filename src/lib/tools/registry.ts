/**
 * 工具注册表。
 *
 * 每个工具声明自己属于哪一级能力（见 policy.ts）。执行前一律先过 policy.decide()，
 * 通过之后才轮到 handler 干活。
 *
 * 标注 serverOnly 的工具必须在服务端跑 —— 浏览器的 CORS 不允许直接抓别人家的网页。
 * 本地运行时这个「服务端」就是你自己电脑上的 Next.js 进程。
 */

import { calculate, CalcError } from './calculator';
import { checkUrl, htmlToText } from './net';
import { decide, type GrantState } from './policy';

export interface ToolParameter {
  type: 'string' | 'number' | 'boolean';
  description: string;
}

export interface ToolDefinition {
  name: string;
  capability: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
  serverOnly?: boolean;
}

export interface ToolResult {
  ok: boolean;
  /** 回给模型看的内容 */
  content: string;
  /** 给用户看的简短说明 */
  display?: string;
}

export const TOOLS: ToolDefinition[] = [
  {
    name: 'get_time',
    capability: 'time.now',
    description: '获取当前日期和时间',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'calculate',
    capability: 'calc.eval',
    description: '计算数学表达式，支持 + - * / % ^、括号和 sqrt/abs/round/min/max/log 等函数',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '要计算的算式，例如 (12+8)*3/4' },
      },
      required: ['expression'],
    },
  },
  {
    name: 'remember',
    capability: 'memory.write',
    description:
      '记住一件关于用户的事，以后每次对话都会带上。只在真的值得长期记住时才用，别记流水账',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要记住的一句话，比如「用户在做医疗系统的安全自查」' },
      },
      required: ['text'],
    },
  },
  {
    name: 'fetch_url',
    capability: 'web.fetch',
    description: '抓取一个网页并返回其中的正文文字',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '要抓取的网址，必须以 http 或 https 开头' },
      },
      required: ['url'],
    },
    serverOnly: true,
  },
  {
    name: 'web_search',
    capability: 'web.search',
    description: '联网搜索，返回若干条结果的标题、链接和摘要',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' },
      },
      required: ['query'],
    },
    serverOnly: true,
  },
];

export function findTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** 转成 OpenAI 原生 function calling 的格式 */
export function toOpenAiTool(def: ToolDefinition) {
  return {
    type: 'function' as const,
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  };
}

/** 模型该看到哪些工具：用户拒绝过的就别给它看了，省得它反复尝试 */
export function visibleTools(grants: Record<string, GrantState> = {}): ToolDefinition[] {
  return TOOLS.filter((tool) => grants[tool.capability] !== 'denied');
}

export interface ExecuteOptions {
  grants?: Record<string, GrantState>;
  /** 用户在确认弹窗里点了同意 */
  approved?: boolean;
  lang?: 'zh' | 'en';
}

/**
 * 执行一个工具调用。
 *
 * 注意执行顺序：**先过策略，再干活**。策略不通过时 handler 一行都不会跑。
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  options: ExecuteOptions = {},
): Promise<ToolResult> {
  const def = findTool(name);
  if (!def) {
    return { ok: false, content: `没有这个工具：${name}` };
  }

  const payload = buildPayload(def, args);
  const decision = decide(def.capability, payload, options.grants ?? {});

  if (decision.outcome === 'deny') {
    return {
      ok: false,
      content: `被安全策略拒绝：${decision.reason ?? '未知原因'}`,
      display: decision.reason,
    };
  }

  if (decision.outcome === 'confirm' && !options.approved) {
    return {
      ok: false,
      content: '这个操作需要用户确认之后才能执行',
      display: `等待确认：${decision.capability?.label ?? name}`,
    };
  }

  try {
    return await runHandler(def, args, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: `执行失败：${message}` };
  }
}

async function runHandler(
  def: ToolDefinition,
  args: Record<string, unknown>,
  options: ExecuteOptions,
): Promise<ToolResult> {
  switch (def.name) {
    case 'get_time':
      return handleGetTime(options.lang ?? 'zh');
    case 'calculate':
      return handleCalculate(String(args.expression ?? ''));
    case 'fetch_url':
    case 'web_search':
      return handleRemote(def, args);
    default:
      return { ok: false, content: `工具 ${def.name} 还没实现` };
  }
}

function handleGetTime(lang: 'zh' | 'en'): ToolResult {
  const now = new Date();
  const iso = now.toISOString();
  const local = now.toLocaleString(lang === 'en' ? 'en-US' : 'zh-CN', {
    dateStyle: 'full',
    timeStyle: 'medium',
  });
  return {
    ok: true,
    content: `当前时间：${local}（ISO: ${iso}）`,
    display: local,
  };
}

function handleCalculate(expression: string): ToolResult {
  try {
    const result = calculate(expression);
    return {
      ok: true,
      content: `${expression} = ${result.formatted}`,
      display: `${expression} = ${result.formatted}`,
    };
  } catch (error) {
    const message = error instanceof CalcError ? error.message : '算式无法计算';
    return { ok: false, content: message };
  }
}

async function handleRemote(def: ToolDefinition, args: Record<string, unknown>): Promise<ToolResult> {
  const body = def.name === 'fetch_url' ? { url: String(args.url ?? '') } : { query: String(args.query ?? '') };

  if (def.name === 'fetch_url') {
    const check = checkUrl(body.url ?? '');
    if (!check.ok) {
      return { ok: false, content: `拒绝抓取：${check.reason}` };
    }
  }

  const response = await fetch('/api/tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: def.name, ...body }),
  });

  if (!response.ok) {
    return { ok: false, content: `工具服务返回 ${response.status}` };
  }
  return (await response.json()) as ToolResult;
}

/** 把参数拼成一段文本交给红线扫描 */
function buildPayload(def: ToolDefinition, args: Record<string, unknown>): string {
  switch (def.name) {
    case 'fetch_url':
      return String(args.url ?? '');
    case 'web_search':
      return String(args.query ?? '');
    case 'calculate':
      return String(args.expression ?? '');
    default:
      return Object.values(args).map((v) => String(v)).join(' ');
  }
}

/** 供服务端路由复用：抓网页 */
export async function fetchPageText(url: string, timeoutMs = 12_000): Promise<ToolResult> {
  const check = checkUrl(url);
  if (!check.ok) return { ok: false, content: `拒绝抓取：${check.reason}` };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'frame/0.1 (+https://github.com/) Mozilla/5.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) {
      return { ok: false, content: `目标站点返回 ${response.status}` };
    }
    const html = await response.text();
    const text = htmlToText(html);
    return {
      ok: true,
      content: `来自 ${url} 的正文：\n\n${text || '（页面里没有可读文字）'}`,
      display: `已抓取 ${url}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, content: `抓取失败：${message}` };
  } finally {
    clearTimeout(timer);
  }
}
