#!/usr/bin/env node
/**
 * 本机能力自检。
 *
 * 看屏幕要调系统能力（.NET 截屏、user32 读鼠标），这类东西最容易在
 * 别人机器上翻车 —— 权限、显卡、多屏缩放都可能出问题。
 * 所以先跑这个，三项都过再谈功能。
 *
 *   npm run doctor
 *
 * 零依赖：只用 Node 内置模块 + PowerShell。
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

const results = [];

function line(name, ok, detail) {
  results.push({ ok });
  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  const dots = '.'.repeat(Math.max(2, 22 - name.length));
  console.log(`  ${name} ${dots} ${mark} ${detail}`);
}

/** 把脚本编码成 base64 传给 powershell，避免引号和括号的转义地狱 */
async function ps(script, timeout = 20_000) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout, windowsHide: true },
  );
}

function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function main() {
  console.log('\nframe 本机能力自检\n');

  if (process.platform !== 'win32') {
    console.log(`  当前平台是 ${process.platform}，看屏幕第一版只支持 Windows。\n`);
    process.exit(1);
  }

  const dir = await mkdtemp(join(tmpdir(), 'frame-doctor-'));

  try {
    /* ---- 1. 截全屏 ---- */
    const fullPath = join(dir, 'full.png').replace(/\\/g, '\\\\');
    const t1 = Date.now();
    try {
      await ps(`
        $ErrorActionPreference = "Stop"
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $bmp.Size)
        $bmp.Save('${fullPath}', [System.Drawing.Imaging.ImageFormat]::Png)
        $g.Dispose(); $bmp.Dispose()
      `);
      const buf = await readFile(join(dir, 'full.png'));
      const { width, height } = pngSize(buf);
      line('截全屏', true, `${width}×${height}，${Date.now() - t1}ms，${Math.round(buf.byteLength / 1024)}KB`);
    } catch (error) {
      line('截全屏', false, error instanceof Error ? error.message.slice(0, 80) : String(error));
    }

    /* ---- 2. 按坐标裁剪 ---- */
    const cropPath = join(dir, 'crop.png').replace(/\\/g, '\\\\');
    const t2 = Date.now();
    try {
      await ps(`
        $ErrorActionPreference = "Stop"
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
        $bmp = New-Object System.Drawing.Bitmap($vs.Width, $vs.Height)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $bmp.Size)
        $w = [Math]::Min(400, $bmp.Width)
        $h = [Math]::Min(300, $bmp.Height)
        $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
        $crop = $bmp.Clone($rect, $bmp.PixelFormat)
        $crop.Save('${cropPath}', [System.Drawing.Imaging.ImageFormat]::Png)
        $crop.Dispose(); $g.Dispose(); $bmp.Dispose()
      `);
      const buf = await readFile(join(dir, 'crop.png'));
      const { width, height } = pngSize(buf);
      line('按坐标裁剪', true, `${width}×${height}，${Date.now() - t2}ms`);
    } catch (error) {
      line('按坐标裁剪', false, error instanceof Error ? error.message.slice(0, 80) : String(error));
    }

    /* ---- 3. 读鼠标位置（只读，不移动）---- */
    try {
      const { stdout } = await ps(`
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class FrameCursor {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT p);
}
"@
        $p = New-Object FrameCursor+POINT
        [void][FrameCursor]::GetCursorPos([ref]$p)
        Write-Output "$($p.X),$($p.Y)"
      `);
      const pos = stdout.trim();
      line('读鼠标位置', /^-?\d+,-?\d+$/.test(pos), pos ? `(${pos})` : '没有返回坐标');
    } catch (error) {
      line(
        '读鼠标位置',
        false,
        error instanceof Error ? error.message.slice(0, 80) : String(error),
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log('');
  if (failed === 0) {
    console.log('  \x1b[32m三项都过。\x1b[0m 看屏幕功能可以正常用。\n');
  } else {
    console.log(`  \x1b[31m有 ${failed} 项没过。\x1b[0m 上面写了原因，发我看一下。\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\n自检脚本自己挂了：', error);
  process.exit(1);
});
