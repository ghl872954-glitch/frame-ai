/**
 * 对话客户端：跟自己的 /api/chat 打交道，解析 SSE 流。
 *
 * 为什么不直接从浏览器打服务商的接口：
 *   1. 不是每家都开了 CORS，直连会随机失败
 *   2. 有些服务商要求特定的 header，走服务端更好控制
 * 本地跑的时候这个「服务端」就是你自己的电脑，key 不会离开本机。
 */

import type { AppConfig } from './config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** 原生 function calling 用得上 */
  tool_calls?: unknown;
  tool_call_id?: string;
}

export interface StreamChatOptions {
  config: AppConfig;
  messages: ChatMessage[];
  signal?: AbortSignal;
  /** 每收到一段就回调一次 */
  onChunk?: (text: string) => void;
  /** 走原生 function calling 时把工具清单带上 */
  tools?: unknown[];
}

export interface StreamChatResult {
  text: string;
  /** 服务端透传回来的原生 tool_calls（如果有） */
  toolCalls: unknown[] | null;
}

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ChatError';
  }
}

export async function streamChat(options: StreamChatOptions): Promise<StreamChatResult> {
  const { config, messages, signal, onChunk, tools } = options;

  if (!config.provider.baseUrl) {
    throw new ChatError('还没配置接口地址，去设置里填一下');
  }
  if (!config.provider.chatModel) {
    throw new ChatError('还没选模型');
  }

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      provider: {
        baseUrl: config.provider.baseUrl,
        apiKey: config.provider.apiKey,
        model: config.provider.chatModel,
      },
      messages,
      tools,
    }),
  });

  if (!response.ok) {
    const detail = await safeText(response);
    throw new ChatError(friendlyStatus(response.status, detail), response.status);
  }
  if (!response.body) {
    throw new ChatError('服务端没有返回流式内容');
  }

  return readSse(response.body, onChunk, signal);
}

async function readSse(
  body: ReadableStream<Uint8Array>,
  onChunk: ((text: string) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<StreamChatResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let toolCalls: unknown[] | null = null;

  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf('\n');

        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        try {
          const parsed = JSON.parse(payload);
          if (parsed?.error) throw new ChatError(String(parsed.error));

          const delta = parsed?.choices?.[0]?.delta;
          if (typeof delta?.content === 'string' && delta.content) {
            text += delta.content;
            onChunk?.(delta.content);
          }
          if (Array.isArray(delta?.tool_calls) && delta.tool_calls.length > 0) {
            toolCalls = delta.tool_calls;
          }
        } catch (error) {
          if (error instanceof ChatError) throw error;
          // 半截 JSON 是正常的（行还没收全），跳过
        }
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }

  return { text, toolCalls };
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 400);
  } catch {
    return '';
  }
}

function friendlyStatus(status: number, detail: string): string {
  if (status === 401 || status === 403) {
    return `鉴权失败（${status}）。检查 API key 是否正确、有没有余额。${detail}`;
  }
  if (status === 404) {
    return `接口地址不对（404）。检查 baseUrl 有没有写错，通常要以 /v1 结尾。${detail}`;
  }
  if (status === 429) {
    return `请求太频繁或超出额度（429）。${detail}`;
  }
  if (status >= 500) {
    return `服务商那边出错了（${status}）。${detail}`;
  }
  return `请求失败（${status}）。${detail}`;
}
