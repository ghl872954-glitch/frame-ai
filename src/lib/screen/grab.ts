/**
 * 本机截屏（Windows）。
 *
 * 为什么不用浏览器的 getDisplayMedia：那要求你先共享整个屏幕或某个窗口，
 * 然后才能拿到画面 —— 但我们要的顺序是「先框选，再问要不要共享」。
 * 本地跑的好处就在这里：Next 的 Route Handler 本身就是本机进程，
 * 可以直接调系统能力，不用绕浏览器那道墙。
 *
 * 用的是 PowerShell + .NET 的 Graphics.CopyFromScreen，
 * 不装任何原生依赖 —— 用户 pip/npm install 之外不该再有额外步骤。
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ScreenRegion } from './types';

export type { ScreenRegion };

const run = promisify(execFile);

export interface GrabbedFrame {
  /** PNG 二进制 */
  data: Buffer;
  /** 实际截到的尺寸，前端用它把显示坐标换算成真实坐标 */
  width: number;
  height: number;
}

/** 截一张图。传了 region 就只截那一块。 */
export async function grabScreen(region?: ScreenRegion): Promise<GrabbedFrame> {
  if (process.platform !== 'win32') {
    throw new Error('看屏幕第一版只支持 Windows');
  }

  const dir = await mkdtemp(join(tmpdir(), 'frame-shot-'));
  const out = join(dir, 'shot.png');

  try {
    const script = buildScript(out, region);
    // 用 -EncodedCommand 而不是 -Command：脚本里有引号、括号、换行，
    // 走命令行参数转义必出问题，base64 过去最省心
    const encoded = Buffer.from(script, 'utf16le').toString('base64');

    await run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { timeout: 15_000, windowsHide: true },
    );

    const data = await readFile(out);
    if (data.byteLength === 0) throw new Error('截出来的图是空的');

    const size = readPngSize(data);
    return { data, ...size };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 从 PNG 的 IHDR 里直接读宽高，省得再引一个图像库 */
function readPngSize(data: Buffer): { width: number; height: number } {
  // PNG 签名 8 字节 + 长度 4 + "IHDR" 4，宽高就在第 16 字节开始
  if (data.byteLength < 24) throw new Error('不是有效的 PNG');
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

function buildScript(out: string, region?: ScreenRegion): string {
  const path = out.replace(/'/g, "''");
  const lines = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $bmp.Size)',
  ];

  if (region) {
    const x = Math.max(0, Math.round(region.x));
    const y = Math.max(0, Math.round(region.y));
    const w = Math.max(1, Math.round(region.width));
    const h = Math.max(1, Math.round(region.height));
    lines.push(
      // 坐标可能超出截图范围（用户拖到屏幕外），这里夹一下
      `$x = [Math]::Min(${x}, $bmp.Width - 1)`,
      `$y = [Math]::Min(${y}, $bmp.Height - 1)`,
      `$w = [Math]::Min(${w}, $bmp.Width - $x)`,
      `$h = [Math]::Min(${h}, $bmp.Height - $y)`,
      '$rect = New-Object System.Drawing.Rectangle($x, $y, $w, $h)',
      '$crop = $bmp.Clone($rect, $bmp.PixelFormat)',
      `$crop.Save('${path}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      '$crop.Dispose()',
    );
  } else {
    lines.push(`$bmp.Save('${path}', [System.Drawing.Imaging.ImageFormat]::Png)`);
  }

  lines.push('$g.Dispose()', '$bmp.Dispose()');
  return lines.join('; ');
}
