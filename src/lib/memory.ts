/**
 * 记忆。
 *
 * 三层：短期（当前会话对话）、长期事实（偏好习惯）、事件摘要（历史对话的浓缩）。
 *
 * 一条硬规矩：**用户必须能看到、能删、能导出每一条记忆。**
 * 记忆是个黑盒的话，用户会不安，而且删不掉的东西迟早出事。
 * 所以这里所有状态都是普通对象数组，没有隐藏字段。
 */

export const MEMORY_STORAGE_KEY = 'frame.memory.v1';

export interface MemoryFact {
  id: string;
  text: string;
  createdAt: number;
  source: 'auto' | 'manual';
}

export interface MemorySummary {
  id: string;
  text: string;
  createdAt: number;
  /** 这条摘要覆盖了几轮对话 */
  turns: number;
}

export interface MemoryState {
  facts: MemoryFact[];
  summaries: MemorySummary[];
}

export function emptyMemory(): MemoryState {
  return { facts: [], summaries: [] };
}

/* -------------------------------------------------------------------------- */
/* 持久化 */
/* -------------------------------------------------------------------------- */

export function loadMemory(): MemoryState {
  if (typeof window === 'undefined') return emptyMemory();
  try {
    const raw = window.localStorage.getItem(MEMORY_STORAGE_KEY);
    if (!raw) return emptyMemory();
    const parsed = JSON.parse(raw);
    return {
      facts: Array.isArray(parsed?.facts) ? parsed.facts : [],
      summaries: Array.isArray(parsed?.summaries) ? parsed.summaries : [],
    };
  } catch {
    return emptyMemory();
  }
}

export function saveMemory(state: MemoryState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 写不进去就算了，记忆不是关键路径
  }
}

/* -------------------------------------------------------------------------- */
/* 增删 */
/* -------------------------------------------------------------------------- */

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 同样的内容不重复记，返回原状态 */
export function addFact(
  state: MemoryState,
  text: string,
  source: MemoryFact['source'] = 'auto',
): MemoryState {
  const clean = text.trim();
  if (!clean) return state;

  const normalized = clean.toLowerCase();
  const duplicate = state.facts.some((f) => f.text.trim().toLowerCase() === normalized);
  if (duplicate) return state;

  const fact: MemoryFact = { id: createId(), text: clean, createdAt: Date.now(), source };
  // 新的放前面，界面上更好找
  return { ...state, facts: [fact, ...state.facts] };
}

export function removeFact(state: MemoryState, id: string): MemoryState {
  return { ...state, facts: state.facts.filter((f) => f.id !== id) };
}

export function addSummary(state: MemoryState, text: string, turns: number): MemoryState {
  const clean = text.trim();
  if (!clean) return state;
  const summary: MemorySummary = { id: createId(), text: clean, createdAt: Date.now(), turns };
  return { ...state, summaries: [summary, ...state.summaries] };
}

export function removeSummary(state: MemoryState, id: string): MemoryState {
  return { ...state, summaries: state.summaries.filter((s) => s.id !== id) };
}

export function clearMemory(): MemoryState {
  return emptyMemory();
}

/* -------------------------------------------------------------------------- */
/* 喂给模型 */
/* -------------------------------------------------------------------------- */

/** 拼成一段注入系统提示词的内容，超过预算就截断（宁可少记，不要挤爆上下文） */
export function summarizeForPrompt(state: MemoryState, maxChars = 1200): string {
  const parts: string[] = [];

  if (state.facts.length > 0) {
    parts.push(state.facts.map((f) => `- ${f.text}`).join('\n'));
  }
  if (state.summaries.length > 0) {
    parts.push(state.summaries.slice(0, 3).map((s) => `- ${s.text}`).join('\n'));
  }

  const text = parts.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export function exportMemory(state: MemoryState): string {
  return JSON.stringify(state, null, 2);
}

export function memoryStats(state: MemoryState): { facts: number; summaries: number } {
  return { facts: state.facts.length, summaries: state.summaries.length };
}
