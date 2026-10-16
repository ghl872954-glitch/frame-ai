/**
 * 一轮对话的完整流程。
 *
 *   拼系统提示词 → 流式生成 → 解析工具调用 → 过安全策略 → 执行 → 把结果喂回去 → 再生成
 *
 * 这一层不依赖 React，也不依赖浏览器，所以可以用假模型完整测出来。
 *
 * 关于工具调用方式：这里只走「提示词协议」这一条路 —— 把工具清单写进提示词，
 * 让模型输出约定格式的代码块，我们解析。
 * 为什么不走原生 function calling：那样只有支持它的模型能用，
 * 而我们的要求是**不管模型支不支持，功能都得能用**。
 */

import { streamChat, type ChatMessage } from './chat';
import type { AppConfig } from './config';
import { addFact, type MemoryState, summarizeForPrompt } from './memory';
import { composeSystemPrompt, findPersona } from './personas';
import { buildToolHint, parseToolCalls } from './tools/protocol';
import { decide, findCapability, type GrantState } from './tools/policy';
import { executeTool, visibleTools } from './tools/registry';
import { ToolAwareStream } from './tools/stream';

export interface ToolConfirmRequest {
  capabilityId: string;
  label: string;
  /** 给用户看的完整内容 */
  detail: string;
  level: number;
}

export interface ToolRunRecord {
  name: string;
  args: Record<string, unknown>;
  status: 'done' | 'denied' | 'error';
  detail: string;
}

export interface AgentTurnInput {
  config: AppConfig;
  memory: MemoryState;
  /** 之前的对话（不含本轮用户输入） */
  history: ChatMessage[];
  userText: string;
  grants: Record<string, GrantState>;
  signal: AbortSignal;
  /** 可以安全播放/显示的正文片段 */
  onChunk?: (text: string) => void;
  onTool?: (record: ToolRunRecord) => void;
  /** 需要用户确认时调用；没给就等于拒绝 */
  confirm?: (request: ToolConfirmRequest) => Promise<boolean>;
  maxSteps?: number;
}

export interface AgentTurnResult {
  /** 去掉工具块之后的正文 */
  text: string;
  memory: MemoryState;
  tools: ToolRunRecord[];
  /** 本轮新增的消息，方便调用方存历史 */
  appended: ChatMessage[];
}

const DEFAULT_MAX_STEPS = 3;

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurnResult> {
  const lang = input.config.ui.language;
  const persona = findPersona(input.config.persona.id);
  const tools = visibleTools(input.grants);

  const toolHint = buildToolHint(
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as Record<string, unknown>,
    })),
    lang,
  );

  const system = composeSystemPrompt({
    persona,
    personaEnabled: input.config.persona.enabled,
    language: lang,
    memorySummary: input.config.memory.enabled ? summarizeForPrompt(input.memory) : '',
    toolHint,
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...input.history,
    { role: 'user', content: input.userText },
  ];

  const appended: ChatMessage[] = [{ role: 'user', content: input.userText }];
  const records: ToolRunRecord[] = [];
  let memory = input.memory;
  let text = '';
  const maxSteps = input.maxSteps ?? DEFAULT_MAX_STEPS;

  for (let step = 0; step < maxSteps; step += 1) {
    const stream = new ToolAwareStream();

    const result = await streamChat({
      config: input.config,
      messages,
      signal: input.signal,
      onChunk: (chunk) => {
        const safe = stream.push(chunk);
        if (safe) {
          text += safe;
          input.onChunk?.(safe);
        }
      },
    });

    const tail = stream.flush();
    if (tail) {
      text += tail;
      input.onChunk?.(tail);
    }

    const raw = result.text || stream.full;
    const { calls } = parseToolCalls(raw);

    appended.push({ role: 'assistant', content: raw });

    if (calls.length === 0) break;

    messages.push({ role: 'assistant', content: raw });

    let executedAny = false;
    for (const call of calls) {
      if (input.signal.aborted) break;

      const record = await runTool(call.name, call.arguments, {
        ...input,
        memory,
      });

      if (call.name === 'remember' && record.status === 'done') {
        memory = addFact(memory, String(call.arguments.text ?? ''));
      }

      records.push(record);
      input.onTool?.(record);
      executedAny = true;

      messages.push({
        role: 'user',
        content: buildToolResultMessage(call.name, record, lang),
      });
    }

    if (!executedAny) break;

    // 后面几轮的文字也要收进最终正文
    if (step < maxSteps - 1) text += '\n';
  }

  return { text: text.trim(), memory, tools: records, appended };
}

interface RunToolContext extends AgentTurnInput {
  memory: MemoryState;
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  context: RunToolContext,
): Promise<ToolRunRecord> {
  // remember 不进 executeTool：它改的是本地状态，没有副作用，也不该弹确认
  if (name === 'remember') {
    if (!context.config.memory.enabled) {
      return { name, args, status: 'denied', detail: '记忆功能被关掉了' };
    }
    const text = String(args.text ?? '').trim();
    if (!text) return { name, args, status: 'error', detail: '要记的内容是空的' };
    return { name, args, status: 'done', detail: `记住了：${text}` };
  }

  const tool = visibleTools(context.grants).find((t) => t.name === name);
  if (!tool) {
    return { name, args, status: 'error', detail: `没有这个工具，或者它被你关掉了：${name}` };
  }

  const payload = Object.values(args).map((v) => String(v)).join(' ');
  const decision = decide(tool.capability, payload, context.grants);

  if (decision.outcome === 'deny') {
    return { name, args, status: 'denied', detail: decision.reason ?? '被安全策略拒绝' };
  }

  let approved = false;
  if (decision.outcome === 'confirm') {
    const capability = findCapability(tool.capability);
    const request: ToolConfirmRequest = {
      capabilityId: tool.capability,
      label: capability?.label ?? name,
      detail: payload,
      level: capability?.level ?? 4,
    };
    approved = context.confirm ? await context.confirm(request) : false;
    if (!approved) {
      return { name, args, status: 'denied', detail: '用户拒绝了这次操作' };
    }
  }

  const result = await executeTool(name, args, {
    grants: context.grants,
    approved: true,
    lang: context.config.ui.language,
  });

  return {
    name,
    args,
    status: result.ok ? 'done' : 'error',
    detail: result.display ?? result.content,
  };
}

function buildToolResultMessage(
  name: string,
  record: ToolRunRecord,
  lang: 'zh' | 'en',
): string {
  const header =
    lang === 'en'
      ? `[tool result] ${name}:`
      : `[工具结果] ${name}：`;

  if (record.status === 'denied') {
    return lang === 'en'
      ? `${header} refused — ${record.detail}. Tell the user plainly, do not retry.`
      : `${header} 被拒绝 —— ${record.detail}。直接如实告诉用户，不要再试一次。`;
  }
  if (record.status === 'error') {
    return lang === 'en'
      ? `${header} failed — ${record.detail}. Explain the failure briefly.`
      : `${header} 失败了 —— ${record.detail}。简短说明失败原因。`;
  }

  return lang === 'en'
    ? `${header} ${record.detail}\n\nAnswer the user now. Do not call the same tool again.`
    : `${header} ${record.detail}\n\n现在回答用户。不要再调用同一个工具。`;
}
