/**
 * 网络访问的守卫。
 *
 * 工具能让模型去抓任意 URL，如果不管，模型可以把你的本地服务当成跳板 ——
 * 比如去读 http://localhost:8080/admin，或者扫内网。
 * 所以默认拦掉回环地址和内网段，要放开得用户自己改。
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  '169.254.169.254', // 云厂商的元数据服务，经典 SSRF 目标
]);

const PRIVATE_V4 =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export interface UrlCheck {
  ok: boolean;
  reason?: string;
}

export function checkUrl(rawUrl: string, options: { allowPrivate?: boolean } = {}): UrlCheck {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: '不是合法的网址' };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `不支持的协议：${url.protocol}` };
  }

  if (options.allowPrivate) return { ok: true };

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: '不允许访问本机和云元数据地址' };
  }
  if (PRIVATE_V4.test(host)) {
    return { ok: false, reason: '不允许访问内网地址' };
  }
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) {
    return { ok: false, reason: '不允许访问内网地址' };
  }
  if (!host.includes('.')) {
    // 裸主机名基本都是在试探内网
    return { ok: false, reason: '不允许访问没有域名的地址' };
  }

  return { ok: true };
}

/** 粗暴地把 HTML 变成可读文本，够用就行，不引解析库 */
export function htmlToText(html: string, maxLength = 6000): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  text = decodeEntities(text);

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, maxLength);
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ldquo: '“',
    rdquo: '”',
    hellip: '…',
    mdash: '—',
  };
  return text
    .replace(/&#(\d+);/g, (_m, code) => safeChar(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => safeChar(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => named[String(name).toLowerCase()] ?? match);
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}
