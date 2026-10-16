/**
 * 能力分级与红线。
 *
 * ============================ 红线 ============================
 * 「永不删除用户设备上的重要信息」。
 *
 * 这句话不是靠一条规则实现的，而是三层叠加：
 *
 *   第一层（物理层）：执行器里**根本没有实现删除和覆盖的函数**。
 *                     不存在的函数，任何配置、任何授权、任何模型请求都调不到。
 *   第二层（静态层）：下面这些规则。任何动作落地前先扫一遍，命中直接拒绝，
 *                     连确认弹窗都不给。
 *   第三层（授权层）：分级授权，用户自己决定放开到哪一级。
 *
 * 只做第一层会被绕过（有人加个新函数就完了），只做第二层也不够（规则总有漏的）。
 * 两层叠在一起才站得住。
 * ==============================================================
 */

export type RiskLevel = 0 | 1 | 2 | 3 | 4;

export interface Capability {
  id: string;
  level: RiskLevel;
  /** 中文说明，界面直接显示 */
  label: string;
  /** 是否默认放行（不需要用户点确认） */
  defaultAllow: boolean;
}

export const CAPABILITIES: Capability[] = [
  // L0：只读、不碰隐私，默认放行
  { id: 'time.now', level: 0, label: '读取当前时间', defaultAllow: true },
  { id: 'calc.eval', level: 0, label: '数学计算', defaultAllow: true },
  { id: 'chart.render', level: 0, label: '生成图表', defaultAllow: true },
  { id: 'memory.write', level: 0, label: '记住事情', defaultAllow: true },

  // L1：联网读，默认放行，用户可关
  { id: 'web.search', level: 1, label: '联网搜索', defaultAllow: true },
  { id: 'web.fetch', level: 1, label: '抓取网页内容', defaultAllow: true },

  // L2：读本机，首次要授权，可按目录限制
  { id: 'fs.list', level: 2, label: '查看文件夹内容', defaultAllow: false },
  { id: 'fs.read', level: 2, label: '读取文件内容', defaultAllow: false },
  { id: 'clipboard.read', level: 2, label: '读取剪贴板', defaultAllow: false },

  // L3：写本机，每次确认。注意：只有「新建」和「追加」，没有覆盖
  { id: 'fs.create', level: 3, label: '新建文件', defaultAllow: false },
  { id: 'fs.append', level: 3, label: '追加内容到文件', defaultAllow: false },
  { id: 'app.open', level: 3, label: '打开程序或链接', defaultAllow: false },
  { id: 'clipboard.write', level: 3, label: '写入剪贴板', defaultAllow: false },

  // L4：最高风险，每次确认 + 展示完整命令
  { id: 'shell.run', level: 4, label: '执行命令', defaultAllow: false },
  { id: 'http.request', level: 4, label: '发起网络请求', defaultAllow: false },
];

export function findCapability(id: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

/* -------------------------------------------------------------------------- */
/* 红线规则 */
/* -------------------------------------------------------------------------- */

export interface ForbiddenRule {
  id: string;
  pattern: RegExp;
  reason: string;
}

/**
 * 命中即拒绝。这些不是「危险但可以用」的东西，是**永远不做**的东西。
 *
 * 分类：删除 / 覆盖 / 提权 / 持久化 / 远程执行 / 系统破坏 / 隐私读取
 */
export const FORBIDDEN_RULES: ForbiddenRule[] = [
  // ---- 删除：任何形式都不做 ----
  {
    id: 'delete-unix',
    pattern: /\b(rm|rmdir|unlink|shred|srm|truncate)\b/i,
    reason: '任何删除操作都不开放，你要删文件请自己删',
  },
  {
    id: 'delete-windows',
    pattern: /\b(del|erase|rd|Remove-Item|ri\b|Clear-RecycleBin)\b/i,
    reason: '任何删除操作都不开放',
  },
  {
    id: 'delete-find',
    pattern: /-delete\b|-exec\s+rm\b/i,
    reason: '批量删除不开放',
  },
  {
    id: 'delete-git',
    pattern: /\bgit\s+(clean\s+-[a-z]*[fd]|reset\s+--hard|checkout\s+--\s)/i,
    reason: '会丢弃未提交的改动，属于数据破坏',
  },

  // ---- 覆盖：写入只允许新建和追加 ----
  {
    id: 'overwrite-redirect',
    pattern: /(?<![>])>(?![>])/,
    reason: '「>」会截断已有文件，写入只支持新建和追加（用 >>）',
  },
  {
    id: 'overwrite-copy',
    pattern: /\b(cp|copy|xcopy|robocopy|mv|move|Move-Item|Rename-Item|tee)\b/i,
    reason: '复制和移动会覆盖同名文件，本项目不实现覆盖',
  },
  {
    id: 'overwrite-force',
    pattern: /Copy-Item\s+.*-Force|Set-Content\b|Out-File\b/i,
    reason: '强制覆盖不开放',
  },

  // ---- 提权 ----
  {
    id: 'privilege',
    pattern: /\b(sudo|doas|runas|Start-Process\s+.*-Verb\s+RunAs)\b/i,
    reason: '提权执行不开放',
  },
  {
    id: 'permission-change',
    pattern: /\b(chmod|chown|chgrp|icacls|takeown|attrib)\b/i,
    reason: '修改权限或所有者不开放',
  },

  // ---- 远程执行 / 动态执行 ----
  {
    id: 'pipe-to-shell',
    pattern: /\|\s*(ba|z|k)?sh\b|\|\s*(cmd|powershell|pwsh)\b/i,
    reason: '把下载内容直接交给 shell 执行，不开放',
  },
  {
    id: 'dynamic-exec',
    pattern: /\b(eval|Invoke-Expression|iex)\b|powershell[^\n]*-(enc|EncodedCommand)\b/i,
    reason: '动态执行代码不开放',
  },

  // ---- 系统破坏 ----
  {
    id: 'disk',
    pattern: /\b(mkfs(\.\w+)?|format|diskpart|fdisk|parted|dd)\b/i,
    reason: '磁盘操作不开放',
  },
  {
    id: 'power',
    pattern: /\b(shutdown|reboot|halt|poweroff|Restart-Computer|Stop-Computer)\b/i,
    reason: '关机重启不开放',
  },
  {
    id: 'registry',
    pattern: /\breg\s+(add|delete|import|restore)\b|\bSet-ItemProperty\s+.*HKLM/i,
    reason: '修改注册表不开放',
  },
  {
    id: 'process-kill',
    pattern: /\b(taskkill|pkill|killall)\b|\bkill\s+-9\s+-1\b/i,
    reason: '强制结束进程不开放',
  },
  {
    id: 'persistence',
    pattern: /\b(schtasks|sc\s+create|launchctl|systemctl)\b|\bcrontab\b/i,
    reason: '创建计划任务或服务不开放',
  },
  {
    id: 'account',
    pattern: /\bnet\s+(user|localgroup)\b|\buseradd\b|\buserdel\b|\bpasswd\b/i,
    reason: '修改系统账户不开放',
  },
  {
    id: 'firewall',
    pattern: /\bnetsh\s+firewall\b|\bufw\b|\biptables\b|\bfirewall-cmd\b/i,
    reason: '修改防火墙不开放',
  },
  {
    id: 'fork-bomb',
    pattern: /:\(\)\s*\{.*\}\s*;\s*:|while\s+true\s*;\s*do.*done/i,
    reason: 'fork 炸弹不开放',
  },
];

/** 系统目录：只读可以，写一律不行 */
const PROTECTED_PATH = /(^|[\\/])(etc|usr|bin|sbin|boot|sys|proc|dev|var|opt|Library|System|Windows|Program Files( \(x86\))?|ProgramData)([\\/]|$)/i;

/** 敏感文件：连读都不行，读了就等于把密钥送给模型 */
const SENSITIVE_PATH = /(^|[\\/])(\.ssh|\.aws|\.gnupg|\.config[\\/]gcloud|\.docker[\\/]config\.json|\.npmrc|\.netrc|\.git-credentials|id_rsa|id_ed25519|credentials\.json|\.env(\..+)?)([\\/]|$)/i;

export interface ForbiddenHit {
  ruleId: string;
  reason: string;
}

/** 扫一段文本（命令原文或路径），命中红线返回原因 */
export function inspect(text: string): ForbiddenHit | null {
  if (!text) return null;

  // 去掉引号里的内容再匹配，避免误伤 echo "rm -rf" 这种只是提到命令的情况
  const stripped = stripQuoted(text);

  for (const rule of FORBIDDEN_RULES) {
    if (rule.pattern.test(stripped)) {
      return { ruleId: rule.id, reason: rule.reason };
    }
  }
  return null;
}

/** 路径是否落在系统目录里 */
export function isProtectedPath(path: string): boolean {
  return PROTECTED_PATH.test(path);
}

/** 路径是否属于敏感文件（读了会泄露密钥） */
export function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATH.test(path);
}

function stripQuoted(text: string): string {
  return text.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
}

/* -------------------------------------------------------------------------- */
/* 授权判定 */
/* -------------------------------------------------------------------------- */

export type GrantState = 'granted' | 'denied' | 'ask';

export interface Decision {
  outcome: 'allow' | 'confirm' | 'deny';
  capability?: Capability;
  reason?: string;
}

/**
 * 判定一个动作能不能做。
 *
 * @param capabilityId 能力 id
 * @param payload      动作内容（命令原文、路径等），用于红线扫描
 * @param grants       用户已经授予的权限
 */
export function decide(
  capabilityId: string,
  payload: string,
  grants: Record<string, GrantState> = {},
): Decision {
  const capability = findCapability(capabilityId);
  if (!capability) {
    return { outcome: 'deny', reason: `未知能力：${capabilityId}` };
  }

  // 红线优先级最高，压过一切授权
  const hit = inspect(payload);
  if (hit) {
    return { outcome: 'deny', capability, reason: hit.reason };
  }

  if (isSensitivePath(payload)) {
    return {
      outcome: 'deny',
      capability,
      reason: '这个路径下是密钥类文件，读取会把你的凭据发给模型，已拒绝',
    };
  }

  // 写操作碰到系统目录直接拒
  if (capability.level >= 3 && isProtectedPath(payload)) {
    return {
      outcome: 'deny',
      capability,
      reason: '不允许写入系统目录',
    };
  }

  const grant = grants[capabilityId];
  if (grant === 'denied') {
    return { outcome: 'deny', capability, reason: '你已明确拒绝过这个能力' };
  }
  if (grant === 'granted') {
    return { outcome: 'allow', capability };
  }

  if (capability.defaultAllow) {
    return { outcome: 'allow', capability };
  }
  return { outcome: 'confirm', capability };
}
