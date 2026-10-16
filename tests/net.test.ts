import { describe, expect, it } from 'vitest';

import { checkUrl, htmlToText } from '@/lib/tools/net';

describe('checkUrl 防 SSRF', () => {
  it('放行正常外网地址', () => {
    expect(checkUrl('https://example.com').ok).toBe(true);
    expect(checkUrl('https://api.deepseek.com/v1').ok).toBe(true);
    expect(checkUrl('http://example.com/path?q=1').ok).toBe(true);
  });

  it('拦住回环地址 —— 否则模型能把本机服务当跳板', () => {
    expect(checkUrl('http://localhost:3000').ok).toBe(false);
    expect(checkUrl('http://localhost/admin').ok).toBe(false);
    expect(checkUrl('http://127.0.0.1:8080').ok).toBe(false);
    expect(checkUrl('http://127.1.2.3').ok).toBe(false);
    expect(checkUrl('http://[::1]:3000').ok).toBe(false);
  });

  it('拦住云元数据地址 —— 经典 SSRF 目标，能拿到实例凭据', () => {
    const check = checkUrl('http://169.254.169.254/latest/meta-data/');
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('元数据');
  });

  it('拦住内网段', () => {
    const hosts = [
      'http://10.0.0.5',
      'http://192.168.1.1',
      'http://172.16.0.1',
      'http://172.31.255.254',
      'http://0.0.0.0',
    ];
    for (const url of hosts) {
      expect(checkUrl(url).ok, url).toBe(false);
    }
  });

  it('172.15 和 172.32 不在私有段里，别误伤', () => {
    expect(checkUrl('http://172.15.0.1').ok).toBe(true);
    expect(checkUrl('http://172.32.0.1').ok).toBe(true);
  });

  it('拦住没有域名的裸主机名 —— 基本都是在探内网', () => {
    expect(checkUrl('http://internal').ok).toBe(false);
    expect(checkUrl('http://router').ok).toBe(false);
  });

  it('只允许 http 和 https', () => {
    expect(checkUrl('file:///etc/passwd').ok).toBe(false);
    expect(checkUrl('ftp://example.com').ok).toBe(false);
    expect(checkUrl('javascript:alert(1)').ok).toBe(false);
    expect(checkUrl('data:text/html,x').ok).toBe(false);
  });

  it('不是网址就拒，不抛异常', () => {
    expect(() => checkUrl('not a url')).not.toThrow();
    expect(checkUrl('not a url').ok).toBe(false);
    expect(checkUrl('').ok).toBe(false);
  });

  it('用户明确放开时可以访问内网 —— 本机部署时需要这个口子', () => {
    expect(checkUrl('http://localhost:3000', { allowPrivate: true }).ok).toBe(true);
    expect(checkUrl('http://192.168.1.10', { allowPrivate: true }).ok).toBe(true);
  });

  it('就算放开了内网，file:// 也不放行', () => {
    expect(checkUrl('file:///etc/passwd', { allowPrivate: true }).ok).toBe(false);
  });
});

describe('htmlToText', () => {
  it('把标签扒掉，只留正文', () => {
    const html =
      '<html><head><style>body{color:red}</style><script>alert(1)</script></head>' +
      '<body><h1>标题</h1><p>第一段 &amp; 第二段</p></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('标题');
    expect(text).toContain('第一段 & 第二段');
    expect(text).not.toContain('alert(1)');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('<');
  });

  it('块级标签断开成行', () => {
    expect(htmlToText('<div>a</div><div>b</div>')).toBe('a\nb');
  });

  it('br 也换行', () => {
    expect(htmlToText('a<br>b<br/>c')).toBe('a\nb\nc');
  });

  it('实体解码，数字和十六进制都认', () => {
    expect(htmlToText('&lt;x&gt;')).toBe('<x>');
    expect(htmlToText('&#65;&#x42;')).toBe('AB');
    expect(htmlToText('a&nbsp;b')).toBe('a b');
  });

  it('注释丢掉', () => {
    const text = htmlToText('前<!-- 这是注释 -->后');
    expect(text).not.toContain('注释');
    expect(text.replace(/\s/g, '')).toBe('前后');
  });

  it('多余的空白压掉', () => {
    expect(htmlToText('<p>  多    空格  </p>')).toBe('多 空格');
  });

  it('超长内容截断，别把上下文塞满', () => {
    const html = `<p>${'字'.repeat(9000)}</p>`;
    expect(htmlToText(html, 500).length).toBe(500);
  });

  it('空页面不报错', () => {
    expect(htmlToText('')).toBe('');
  });
});
