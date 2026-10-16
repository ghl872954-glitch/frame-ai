/**
 * 预设服务商。
 *
 * 设计原则：**预设只是省事的起点，不是绑定。**
 * 每个字段（baseUrl / 模型名 / 音色）在界面上都能改，而且可以点「拉取模型列表」
 * 直接从服务商拿到真实可用的模型名 —— 因为各家模型名换得比文档快，
 * 硬编码一堆名字迟早会过期。
 *
 * 所有预设都走 OpenAI 兼容协议（`/chat/completions`、`/audio/transcriptions`、`/audio/speech`）。
 * 标注 voice: false 的表示它没有 OpenAI 兼容的语音接口，语音会自动走浏览器内置那档。
 */

export type Region = 'cn' | 'global' | 'local';

export interface ProviderPreset {
  id: string;
  name: { zh: string; en: string };
  region: Region;
  /** 接口根地址，不含 /chat/completions */
  baseUrl: string;
  chatModel: string;
  /** 有值表示这家提供 OpenAI 兼容的语音识别接口 */
  sttModel?: string;
  /** 有值表示这家提供 OpenAI 兼容的语音合成接口 */
  ttsModel?: string;
  ttsVoice?: string;
  /** 控制台地址，界面上一键跳转去拿 key */
  console: string;
  note?: { zh: string; en: string };
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'siliconflow',
    name: { zh: '硅基流动', en: 'SiliconFlow' },
    region: 'cn',
    baseUrl: 'https://api.siliconflow.cn/v1',
    chatModel: 'Qwen/Qwen3-8B',
    sttModel: 'FunAudioLLM/SenseVoiceSmall',
    ttsModel: 'FunAudioLLM/CosyVoice2-0.5B',
    ttsVoice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
    console: 'https://cloud.siliconflow.cn/account/ak',
    note: {
      zh: '一个 key 同时有对话、识别、合成，国内直连。语音模型名请以官网为准',
      en: 'One key covers chat, STT and TTS. Direct access from mainland China',
    },
  },
  {
    id: 'deepseek',
    name: { zh: 'DeepSeek', en: 'DeepSeek' },
    region: 'cn',
    baseUrl: 'https://api.deepseek.com/v1',
    chatModel: 'deepseek-chat',
    console: 'https://platform.deepseek.com/api_keys',
    note: {
      zh: '只有文本模型，语音会自动走浏览器内置那档，功能照常可用',
      en: 'Text-only model. Voice falls back to the built-in browser engine automatically',
    },
  },
  {
    id: 'dashscope',
    name: { zh: '阿里百炼', en: 'Alibaba Bailian' },
    region: 'cn',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    chatModel: 'qwen-plus',
    console: 'https://bailian.console.aliyun.com/',
    note: {
      zh: '语音合成走的是阿里自有协议，本项目的云端语音层暂不覆盖',
      en: 'Its speech synthesis uses a proprietary protocol, not covered by the cloud voice layer yet',
    },
  },
  {
    id: 'zhipu',
    name: { zh: '智谱 GLM', en: 'Zhipu GLM' },
    region: 'cn',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    chatModel: 'glm-4-flash',
    console: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'moonshot',
    name: { zh: '月之暗面 Kimi', en: 'Moonshot Kimi' },
    region: 'cn',
    baseUrl: 'https://api.moonshot.cn/v1',
    chatModel: 'moonshot-v1-8k',
    console: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'openai',
    name: { zh: 'OpenAI', en: 'OpenAI' },
    region: 'global',
    baseUrl: 'https://api.openai.com/v1',
    chatModel: 'gpt-4o-mini',
    sttModel: 'whisper-1',
    ttsModel: 'tts-1',
    ttsVoice: 'nova',
    console: 'https://platform.openai.com/api-keys',
    note: {
      zh: '一个 key 同时有对话、识别、合成',
      en: 'One key covers chat, STT and TTS',
    },
  },
  {
    id: 'groq',
    name: { zh: 'Groq', en: 'Groq' },
    region: 'global',
    baseUrl: 'https://api.groq.com/openai/v1',
    chatModel: 'llama-3.3-70b-versatile',
    sttModel: 'whisper-large-v3',
    console: 'https://console.groq.com/keys',
    note: {
      zh: '识别极快且免费额度大，语音首选',
      en: 'Very fast STT with a generous free tier',
    },
  },
  {
    id: 'openrouter',
    name: { zh: 'OpenRouter', en: 'OpenRouter' },
    region: 'global',
    baseUrl: 'https://openrouter.ai/api/v1',
    chatModel: 'openai/gpt-4o-mini',
    console: 'https://openrouter.ai/keys',
    note: {
      zh: '一个 key 用几百个模型，但只有对话接口',
      en: 'One key, hundreds of models, chat endpoint only',
    },
  },
  {
    id: 'ollama',
    name: { zh: 'Ollama（本地）', en: 'Ollama (local)' },
    region: 'local',
    baseUrl: 'http://localhost:11434/v1',
    chatModel: 'qwen2.5:7b',
    console: 'https://ollama.com/download',
    note: {
      zh: '完全跑在自己电脑上，数据不出本机。key 随便填，如 ollama',
      en: 'Runs entirely on your machine. Any placeholder works as the key',
    },
  },
  {
    id: 'custom',
    name: { zh: '自定义', en: 'Custom' },
    region: 'global',
    baseUrl: '',
    chatModel: '',
    console: '',
    note: {
      zh: '任何 OpenAI 兼容的网关都能用，包括公司内网自建的',
      en: 'Any OpenAI-compatible gateway works, including self-hosted ones',
    },
  },
];

export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/** 从接口根地址猜是哪个预设，用于用户手填 baseUrl 后自动匹配 */
export function guessPresetByUrl(baseUrl: string): ProviderPreset | undefined {
  if (!baseUrl) return undefined;
  const normalized = baseUrl.replace(/\/+$/, '').toLowerCase();
  return PROVIDERS.find(
    (p) => p.baseUrl && p.baseUrl.replace(/\/+$/, '').toLowerCase() === normalized,
  );
}

/** 这家服务商能不能提供云端语音能力 */
export function voiceCapability(preset: ProviderPreset | undefined): {
  stt: boolean;
  tts: boolean;
} {
  return {
    stt: Boolean(preset?.sttModel),
    tts: Boolean(preset?.ttsModel),
  };
}

export function regionLabel(region: Region, lang: 'zh' | 'en'): string {
  const map = {
    cn: { zh: '国内', en: 'China' },
    global: { zh: '海外', en: 'Global' },
    local: { zh: '本地', en: 'Local' },
  } as const;
  return map[region][lang];
}
