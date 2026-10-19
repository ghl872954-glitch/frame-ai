/**
 * 云端识别的可用性判断。
 *
 * 录音那部分（MediaRecorder / AudioContext / 音量检测）在 node 里没法真跑，
 * 这里只锁住「什么情况下它认为自己能用」—— 这个判断错了，
 * 用户会看到「云端识别」但一点声音都录不到。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CloudStt } from '@/lib/voice/cloud-stt';

const base = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'FunAudioLLM/SenseVoiceSmall',
  silenceMs: 900,
};

/** node 里的 navigator 是只读的，直接赋值会抛，必须走 defineProperty */
function setGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

describe('CloudStt 可用性', () => {
  beforeEach(() => {
    setGlobal('window', {});
    setGlobal('navigator', { mediaDevices: {} });
    setGlobal('MediaRecorder', class {});
  });

  afterEach(() => {
    // 恢复成「什么都没有」—— 每个用例自己按需设置
    setGlobal('window', undefined);
    setGlobal('navigator', undefined);
    setGlobal('MediaRecorder', undefined);
  });

  it('条件齐全时可用', async () => {
    expect(await new CloudStt(base).available()).toBe(true);
  });

  it('缺接口地址就不可用', async () => {
    expect(await new CloudStt({ ...base, baseUrl: '' }).available()).toBe(false);
  });

  it('缺识别模型就不可用 —— 预设里没有 sttModel 的服务商不该走这条路', async () => {
    expect(await new CloudStt({ ...base, model: '' }).available()).toBe(false);
  });

  it('浏览器不支持录音就不可用', async () => {
    setGlobal('MediaRecorder', undefined);
    expect(await new CloudStt(base).available()).toBe(false);
  });

  it('没有 mediaDevices 就不可用', async () => {
    setGlobal('navigator', {});
    expect(await new CloudStt(base).available()).toBe(false);
  });

  it('服务端渲染环境（没有 window）一律不可用', async () => {
    setGlobal('window', undefined);
    expect(await new CloudStt(base).available()).toBe(false);
  });
});
