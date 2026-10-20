/**
 * frame 桌面外壳（Electron 主进程）。
 *
 * 职责很窄：把现有的 Next.js 服务在本机拉起来，再用窗口去加载它。
 * 对话、工具、语音、记忆全在 Next 那边，这里一行都不重写。
 *
 * 三个窗口 / 进程：
 *   主窗口     完整界面（对话、设置、记忆）
 *   悬浮窗     置顶小窗，只显示当前这句，不抢焦点
 *   Next 服务  跟着主进程一起起来，跑 /api/*
 *
 * 启动流程：
 *   1. 找一个空闲端口（默认 3000 被占就往后挪）
 *   2. 用 Electron 自带的 Node 起 next（有构建走 start，否则 dev）
 *   3. 轮询等 HTTP 有响应
 *   4. 开主窗 + 悬浮窗
 *   5. 注册全局快捷键
 *   6. 退出时把子进程和快捷键收拾干净
 *
 * 自检模式：设 FRAME_SMOKE=1 时不开窗口，只验证「Next 能在 Electron 里跑起来」，
 * 打完 /api/health 就退出。用来验 DESKTOP.md 里标注的最高风险项。
 */

import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nextBin = join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const preload = join(root, 'electron', 'preload.cjs');
const isSmoke = process.env.FRAME_SMOKE === '1';
const HOTKEY = process.env.FRAME_HOTKEY || 'Control+Shift+Space';

// 无 GPU 的环境（CI、远程会话、某些虚拟机）里 GPU 进程会直接崩掉整个应用。
// 自检时一律关硬件加速；真机上想关也可以设 FRAME_DISABLE_GPU=1。
if (isSmoke || process.env.FRAME_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('no-sandbox');
}

let server = null;
let mainWindow = null;
let floatWindow = null;
/** 是不是我们为了截屏主动藏起来的 —— 只有这种情况才需要放回来 */
let captureHidden = false;

/* -------------------------------------------------------------------------- */
/* 服务                                                                       */
/* -------------------------------------------------------------------------- */

/** 找一个能监听的端口；从 3000 开始，被占就 +1 */
function findFreePort(start = 3000, tries = 20) {
  return new Promise((resolve, reject) => {
    const attempt = (port, left) => {
      const tester = createServer();
      tester.unref();
      tester.once('error', () => {
        if (left <= 0) reject(new Error('找不到空闲端口'));
        else attempt(port + 1, left - 1);
      });
      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port, '127.0.0.1');
    };
    attempt(start, tries);
  });
}

/** 轮询直到这个地址能返回任意 HTTP 响应，或超时 */
async function waitForServer(url, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { method: 'GET' });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

function startNext(port) {
  if (!existsSync(nextBin)) {
    console.error('[frame] 找不到 next，先 npm install');
    return false;
  }
  // 有构建产物就生产模式，否则开发模式
  const built = existsSync(join(root, '.next', 'BUILD_ID'));
  const mode = built ? 'start' : 'dev';
  console.log(`[frame] 启动 next ${mode} @ ${port}`);

  server = spawn(
    process.execPath,
    [nextBin, mode, '-p', String(port), '-H', '127.0.0.1'],
    {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(port) },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  server.on('error', (err) => {
    console.error('[frame] 起 next 失败：', err.message);
  });
  server.on('exit', (code) => {
    // Next 自己非正常退了，壳也没必要留着
    if (code !== 0 && code !== null && !isSmoke) app.quit();
  });
  return true;
}

function stopServer() {
  if (server && !server.killed) {
    try {
      server.kill();
    } catch {
      // 已经没了
    }
    server = null;
  }
}

/* -------------------------------------------------------------------------- */
/* 窗口                                                                       */
/* -------------------------------------------------------------------------- */

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 520,
    minHeight: 420,
    backgroundColor: '#0b0b0f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // 站外链接交给系统浏览器，别在壳里开
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    if (!target.startsWith(url)) shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.loadURL(url);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createFloatWindow(url) {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = 360;
  const height = 96;
  const margin = 24;

  floatWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + workArea.width - width - margin,
    y: workArea.y + workArea.height - height - margin,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // 关键：不抢焦点。你在别的软件里打字，它冒出来也不会把光标抢走
    focusable: false,
    show: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // screen-saver 级别，比普通置顶更靠前，全屏应用也能压住
  floatWindow.setAlwaysOnTop(true, 'screen-saver');

  floatWindow.webContents.on('did-finish-load', () => {
    if (floatWindow && !floatWindow.isDestroyed()) floatWindow.showInactive();
  });

  floatWindow.loadURL(`${url}/float`);
  floatWindow.on('closed', () => {
    floatWindow = null;
  });
}

/** 显示/隐藏主窗：隐藏时用 hide，显示时拉回来并聚焦 */
function toggleMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* IPC                                                                        */
/* -------------------------------------------------------------------------- */

function registerIpc() {
  ipcMain.handle('frame:hide-for-capture', () => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return false;
    captureHidden = true;
    mainWindow.hide();
    if (floatWindow && !floatWindow.isDestroyed() && floatWindow.isVisible()) {
      floatWindow.hide();
    }
    return true;
  });

  ipcMain.handle('frame:show-after-capture', () => {
    if (!captureHidden) return false;
    captureHidden = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
    if (floatWindow && !floatWindow.isDestroyed()) {
      floatWindow.showInactive();
    }
    return true;
  });

  ipcMain.handle('frame:toggle-main', () => toggleMain());

  // 悬浮窗内容高度变化 → 窗口跟着收放，底边保持不动
  ipcMain.on('frame:resize-float', (_event, height) => {
    if (!floatWindow || floatWindow.isDestroyed()) return;
    const bounds = floatWindow.getBounds();
    const nextHeight = Math.max(40, Math.min(640, Math.round(Number(height) || bounds.height)));
    if (nextHeight === bounds.height) return;
    const bottom = bounds.y + bounds.height;
    floatWindow.setBounds({
      x: bounds.x,
      y: bottom - nextHeight,
      width: bounds.width,
      height: nextHeight,
    });
  });

  ipcMain.on('frame:close-float', () => {
    if (floatWindow && !floatWindow.isDestroyed()) floatWindow.close();
  });
}

/* -------------------------------------------------------------------------- */
/* 启动                                                                       */
/* -------------------------------------------------------------------------- */

async function boot() {
  let port;
  try {
    port = await findFreePort();
  } catch (err) {
    console.error('[frame]', err.message);
    app.exit(1);
    return;
  }
  const url = `http://127.0.0.1:${port}`;

  if (!startNext(port)) {
    app.exit(1);
    return;
  }

  const ready = await waitForServer(url);
  if (!ready) {
    console.error('[frame] Next 服务 45 秒内没起来，退出');
    stopServer();
    app.exit(1);
    return;
  }

  if (isSmoke) {
    // 只验「Next 能在 Electron 里跑」，不开窗口
    try {
      const res = await fetch(`${url}/api/health`);
      const body = (await res.text()).slice(0, 200);
      console.log(`[frame smoke] /api/health -> ${res.status} ${body}`);
      const ok = res.ok && body.includes('frame');
      console.log(ok ? '[frame smoke] OK' : '[frame smoke] FAIL: 响应不符合预期');
      stopServer();
      app.exit(ok ? 0 : 1);
    } catch (err) {
      console.error('[frame smoke] FAIL', err.message);
      stopServer();
      app.exit(1);
    }
    return;
  }

  registerIpc();
  createMainWindow(url);
  createFloatWindow(url);

  const registered = globalShortcut.register(HOTKEY, () => toggleMain());
  if (!registered) {
    console.warn(`[frame] 全局快捷键 ${HOTKEY} 注册失败，可能被别的程序占了`);
  }
}

if (isSmoke) {
  app.whenReady().then(boot);
} else {
  // 只允许一个实例，重复双击就把已有窗口顶上来
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });

    app.whenReady().then(boot);

    app.on('window-all-closed', () => {
      stopServer();
      app.quit();
    });

    app.on('will-quit', () => {
      globalShortcut.unregisterAll();
      stopServer();
    });

    app.on('before-quit', stopServer);
  }
}

process.on('exit', stopServer);
