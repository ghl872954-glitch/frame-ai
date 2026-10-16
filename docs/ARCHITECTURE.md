# 架构

这份文档讲的是「东西怎么连起来」。各个设计决策**为什么**这么做，在 [DESIGN.md](../DESIGN.md) 里。

---

## 一句话

一个 Next.js 应用。浏览器负责界面和语音，服务端 Route Handler 负责转发模型请求和抓网页。
本地跑的时候，「服务端」就是你自己电脑上的这个进程。

```
┌─────────────────────────── 浏览器 ───────────────────────────┐
│                                                              │
│  UI 层（很薄）                                                │
│    page.tsx / VoiceOrb / Transcript / Composer / SettingsPanel│
│         │  只读状态、只调动作                                  │
│         ▼                                                     │
│  状态层  store.ts（zustand）                                   │
│         │                                                     │
│         ├──────────────▶ agent.ts      一轮对话的完整流程       │
│         │                   │                                 │
│         │                   ├─▶ personas.ts    拼系统提示词     │
│         │                   ├─▶ memory.ts      注入记忆         │
│         │                   ├─▶ tools/protocol 工具协议 + 解析  │
│         │                   ├─▶ tools/policy   红线 + 分级授权   │
│         │                   └─▶ tools/registry 执行             │
│         │                                                     │
│         └──────────────▶ voice/session.ts  语音会话状态机       │
│                             ├─▶ voice/browser.ts  Web Speech  │
│                             └─▶ voice/sentence.ts 流式切句      │
└──────────────────────────────────┬───────────────────────────┘
                                   │ fetch（SSE 流式）
                                   ▼
┌────────────────────────── Next.js 服务端 ─────────────────────┐
│  /api/chat    转发到服务商的 /chat/completions，绕 CORS        │
│  /api/models  拉模型列表                                       │
│  /api/tools   抓网页正文 + 搜索                                │
│  /api/health  自检，返回能力表和红线声明                        │
└───────────────────────────────────────────────────────────────┘
```

**为什么界面这么薄**：所有碰浏览器 API 的东西都收在 `store.ts` 里。
组件只做两件事 —— 读状态、调动作。这样组件不需要测试，逻辑集中在一处也好排查。

---

## 一轮文字对话的完整路径

```
用户输入
  │
  ▼
store.send(text)
  │  ├─ 检查有没有配 baseUrl / 模型名，没有就直接报错，不发请求
  │  └─ 往 messages 里插两条：用户消息 + 一条 pending 的助手消息
  ▼
agent.runAgentTurn()
  │
  ├─ 1. 拼系统提示词
  │     人格提示词 + 记忆摘要 + 工具清单
  │
  ├─ 2. streamChat() → POST /api/chat → 上游 SSE
  │     每个 delta 进来时：
  │       ToolAwareStream.push(delta)
  │         → 扣掉最后 24 字符，把安全的部分交给 store 追加到消息上
  │         → 遇到工具块就不再往外放
  │
  ├─ 3. 流结束后 parseToolCalls(完整原文)
  │      没有调用 → 这一轮结束
  │      有调用   → 往下走
  │
  ├─ 4. 逐个执行
  │      policy.decide(能力, 参数, 用户授权)
  │        ├─ deny    → 记一条 denied，直接把原因回灌给模型
  │        ├─ confirm → 弹窗问用户；没同意就记 denied
  │        └─ allow   → executeTool() 真的执行
  │      结果以 user 消息的形式回灌给模型
  │
  └─ 5. 回到第 2 步，最多循环 maxSteps 次（默认 3）
  │
  ▼
store 把 pending 去掉，存记忆，回到 idle
```

两个容易忽略但必须做对的细节：

- **工具块不能念出来**。所以有 `ToolAwareStream` 那层过滤，而不是直接把 delta 交给 TTS。
- **工具结果要回灌**。模型不知道执行结果的话，会一直重复调同一个工具。

---

## 一轮语音对话的完整路径

```
点圆 → store.startVoice()
  │
  ├─ decideTier(当前环境能力, 用户偏好) → 决定用哪一档
  └─ new BrowserStt + BrowserTts → new VoiceSession
  ▼
session.start() → stt.start({ onPartial, onFinal })
  │
  │  用户在说话……
  │  onPartial 每来一段：如果正在播放，就触发打断
  │
  ▼
onFinal(识别出的整句)
  │
  ▼
session.handleUserUtterance(text)
  │
  ├─ 轮次号 turn += 1        ← 记住这个数，它是打断的关键
  ├─ 状态 → thinking
  ├─ store 追加一条用户消息
  │
  ├─ ask(text, onChunk, signal)  ← 内部就是 runAgentTurn
  │     每个 chunk 进来：
  │       SentenceBuffer.push(chunk)
  │         → 凑够一句就送进「说话队列」
  │         → 队列是串行的，保证按顺序播
  │       每次进入播放前先检查 turn 有没有变，变了就整段丢弃
  │
  ├─ 流结束 → flush 尾巴 → 等队列播完
  │
  └─ 状态 → listening
```

### 打断是怎么做到「一个字都不漏」的

打断要做三件事，缺一不可：

1. `turn += 1` —— 让所有还活着的回调自己失效
2. `AbortController.abort()` —— 掐掉正在进行的网络请求
3. `tts.stop()` + 清空切句缓冲 —— 停掉已经在播的声音

关键在于第 1 条。**不是去「停止」已经排好的任务，而是让它们自己发现轮次对不上然后退出。**
停止是竞争条件的高发区（正好在停止的那一刻有 chunk 进来怎么办），而比对轮次号没有这个问题。

代价是 `turn` 这个数字必须在每个异步边界上检查一遍 —— `onChunk` 里、播放队列里、`ask` 返回后。
少检查一处，就会出现「打断之后又冒出半句话」的 bug。

---

## 红线为什么分三层

```
第一层  执行器里根本没有删除和覆盖的函数
        ↑ 不存在的函数，任何配置、任何授权、任何模型请求都调不到

第二层  静态正则表（19 条）
        ↑ 命中直接拒，连确认弹窗都不给

第三层  分级授权 L0–L4
        ↑ 用户自己决定放开到哪一级
```

只做第一层会被绕过 —— 将来有人加个新函数就完了。
只做第二层也不够 —— 规则总有漏的。
三层叠在一起才站得住。

`policy.decide()` 的判定顺序是有讲究的：

1. 能力不认识 → 拒（不能默认放行）
2. **红线扫描 → 拒**（压过一切授权，包括用户点过的「以后都允许」）
3. 敏感路径（`.ssh` / `.env` 等）→ 拒
4. 写操作落在系统目录 → 拒
5. 用户明确拒绝过 → 拒
6. 用户明确允许过 → 放行
7. 默认允许的能力 → 放行
8. 其余 → 弹窗确认

第 2 步在第 5、6 步之前，这就是「红线压过一切」在代码里的样子。

---

## 模块职责

### `src/lib/`

| 文件 | 职责 | 有没有副作用 |
| --- | --- | --- |
| `agent.ts` | 一轮对话的编排 | 会执行工具 |
| `chat.ts` | SSE 解析、错误翻译 | 发网络请求 |
| `config.ts` | 配置模型、持久化、**坏值修正** | 读写 localStorage |
| `memory.ts` | 三层记忆 | 读写 localStorage |
| `personas.ts` | 预设人格、拼系统提示词 | 纯 |
| `providers.ts` | 服务商预设 | 纯 |
| `store.ts` | 全局状态，唯一碰浏览器 API 的地方 | 大量 |

### `src/lib/voice/`

| 文件 | 职责 | 有没有副作用 |
| --- | --- | --- |
| `types.ts` | 适配器接口、能力探测 | 读 window |
| `router.ts` | **降级决策，纯函数** | 纯 |
| `browser.ts` | Web Speech API 适配器 | 浏览器 API |
| `sentence.ts` | 流式切句 | 纯 |
| `session.ts` | 会话状态机、打断 | 无（依赖全注入） |

`router.ts` 和 `session.ts` 是刻意做成「无副作用」的 ——
它们是整个项目里最容易出错、出错后果最严重的两块（一个决定有没有声音，一个决定打断干不干净），
做成纯的才能完整测出来。

### `src/lib/tools/`

| 文件 | 职责 | 有没有副作用 |
| --- | --- | --- |
| `policy.ts` | 能力表、19 条红线、授权判定 | 纯 |
| `calculator.ts` | 手写词法分析 + 递归下降解析 | 纯 |
| `protocol.ts` | 工具协议的拼装与解析 | 纯 |
| `stream.ts` | 流式工具块过滤 | 纯 |
| `net.ts` | SSRF 防护、HTML 转文本 | 纯 |
| `registry.ts` | 工具定义与执行 | 会抓网页 |

`registry.ts` 是**唯一**有真实副作用的地方（除了 store 的持久化）。
想加新工具的话，先看 [CONTRIBUTING.md](../CONTRIBUTING.md)。

---

## 测试策略

203 个用例，11 个文件。测的是「错了会很难查」的地方，不是覆盖率数字。

| 文件 | 测什么 |
| --- | --- |
| `router.test.ts` | 降级决策的各种能力组合 |
| `session.test.ts` | 状态流转、打断、轮次作废 |
| `sentence.test.ts` | 切句边界 |
| `stream.test.ts` | 流式工具块过滤 |
| `policy.test.ts` | 红线拦不拦得住、授权判定顺序 |
| `calculator.test.ts` | 解析器、拒绝一切非算式输入 |
| `protocol.test.ts` | 各家模型五花八门的输出格式 |
| `net.test.ts` | SSRF、HTML 转文本 |
| `memory.test.ts` | 去重、注入预算 |
| `config.test.ts` | 坏配置修正 |
| `agent.test.ts` | 一轮对话的完整链路（假模型） |

`agent.test.ts` 把网络那一层换成假模型，其余全走真代码 —— 所以它测的是真实链路，
而不是一堆 mock 之间互相调用的假象。

**没有测的**：React 组件、Next.js Route Handler。前者靠界面手测，
后者需要 e2e 环境，等 Playwright 那步补。
