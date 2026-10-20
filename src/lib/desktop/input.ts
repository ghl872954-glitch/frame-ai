/**
 * 本机输入模拟（Windows）。
 *
 * 用 PowerShell 调 user32 的 SendInput / SetCursorPos，不引 robotjs 这类原生模块 ——
 * 那种包每次 Electron 升级都要重编译，对非开发者是灾难。
 *
 * 这里只做两件事：点一下、打一段字。**没有删除、没有覆盖、没有快捷键组合**。
 * 红线不靠规则拦，靠「根本没有这种函数」。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function powershell(script: string, env: Record<string, string>): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('动作层第一版只支持 Windows');
  }
  // 脚本里有引号、C# 代码、换行，走 base64 最省心
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await run(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { timeout: 12_000, windowsHide: true, env: { ...process.env, ...env } },
  );
}

const CLICK_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FrameMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
$null = [FrameMouse]::SetCursorPos([int]$env:FRAME_X, [int]$env:FRAME_Y)
Start-Sleep -Milliseconds 40
[FrameMouse]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[FrameMouse]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
`;

const TYPE_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FrameKeys {
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion u; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  public static void Type(string s) {
    foreach (char c in s) {
      INPUT[] down = new INPUT[1];
      down[0].type = 1;
      down[0].u.ki.wVk = 0;
      down[0].u.ki.wScan = (ushort)c;
      down[0].u.ki.dwFlags = 4;
      SendInput(1, down, Marshal.SizeOf(typeof(INPUT)));

      INPUT[] up = new INPUT[1];
      up[0].type = 1;
      up[0].u.ki.wVk = 0;
      up[0].u.ki.wScan = (ushort)c;
      up[0].u.ki.dwFlags = 6;
      SendInput(1, up, Marshal.SizeOf(typeof(INPUT)));
    }
  }
}
"@
[FrameKeys]::Type($env:FRAME_TEXT)
`;

/** 在屏幕绝对坐标 (x, y) 左键点一下 */
export async function clickAt(x: number, y: number): Promise<void> {
  await powershell(CLICK_SCRIPT, { FRAME_X: String(x), FRAME_Y: String(y) });
}

/** 把文字打到当前光标位置（Unicode，中文也能打） */
export async function typeText(text: string): Promise<void> {
  await powershell(TYPE_SCRIPT, { FRAME_TEXT: text });
}
