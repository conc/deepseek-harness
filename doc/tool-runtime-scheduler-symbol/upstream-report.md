<!--
建议标题（填在 GitHub Discussion 标题栏）：

  所有工具调用报 `Cannot read properties of undefined (reading 'prepare')`：跨包 seam 的 Symbol 身份在模块重复求值后失效

备选（更短）：

  工具调用全部失败：TOOL_RUNTIME_SCHEDULER 使用了非注册 Symbol

建议分类：Bug（若本仓库 Discussions 没有 Bug 分类，用 General）
-->

## Summary

任意一次工具调用（`bash`、`read`、`glob` 等，与具体工具无关）都会让整个回合中断：会话日志里留下了 `tool/call`，但没有对应的 `tool/result`，`turn/end` 以错误收尾。

```json
{"type":"turn/end","reason":{"kind":"error","error":{"message":"Cannot read properties of undefined (reading 'prepare')","code":"UNKNOWN"}}}
```

受影响的不是某个工具，而是**该进程内此后所有会话的所有工具调用**：一旦命中，不会自愈，重启进程才恢复。按 `CONTRIBUTING.md`，仓库目前不接受外部 PR，所以我把完整分析、可复现最小例和可直接 apply 的补丁放在这里，供维护者取用。

## Reproduction

### 稳定复现（语义层，两分钟，不需要跑 harness）

两个模块各自用普通 `Symbol` 定义同一个键：写方把调度器挂上去，读方拿到的是自己那份 `Symbol`，于是读到 `undefined`。

```js
// a.mjs
export const S = Symbol('@deepseek-ai/dsh-tools.scheduler')
export const runtime = { [S]: { prepare: () => 'ok' } }
```

```js
// b.mjs
export const S = Symbol('@deepseek-ai/dsh-tools.scheduler')
```

```sh
node --input-type=module -e "
const a = await import('./a.mjs'), b = await import('./b.mjs');
console.log(a.S === b.S);              // false
console.log(a.runtime[b.S]);           // undefined
try { a.runtime[b.S].prepare() } catch (e) { console.log(e.message) }
"
# 输出：Cannot read properties of undefined (reading 'prepare')
```

把两处 `Symbol(` 换成 `Symbol.for(` 后，`a.S === b.S` 为 `true`，读取恢复正常。（已在 Node v24.14.1 上验证。）

### 进程级触发条件

写入方与读取方来自 `dsh-tools` 的**两次不同模块求值**。我没有把它收敛到单一操作步骤（见「尚未确定的环节」），观察到的表现是：长驻的 `dsh web` 进程运行期间发生一次二次求值后，此后每次工具调用必现，且不再恢复。

## Current behavior

- 会话事件顺序固定为：`tool/call` 落盘 → 抛错 → `turn/end` 带 `code: UNKNOWN`，全程没有 `tool/result`。
- 抛错点是 [`packages/core/agent-loop/src/tool-calls.ts:170`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/agent-loop/src/tool-calls.ts#L170)：

  ```ts
  callSeqs[index] = appendToolCall(session, turn, step, call.block)   // 168：先写 tool/call
  const prepared = await ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare(call.exec)  // 170：再取调度器
  ```

- 判据：报错里的属性名是 `prepare`，而不是 `Symbol(@deepseek-ai/dsh-tools.scheduler)`。也就是说 `ctx.tools` 本身存在，**只是以该 symbol 为键的属性取不到**——问题出在符号身份，不是服务未加载。

## Expected behavior

- 工具正常执行并返回 `tool/result`。
- 调度器 seam 在进程内只有一个身份，与 `@deepseek-ai/dsh-tools` 被求值几次无关；重复加载或插件重载不应让所有工具失效。

## Environment

- DeepSeek Harness `0.1.6-alpha.2`（官方 tarball 解压，非 `git clone`；触发期间 `packages/core/tools/src/index.ts` 为 tarball 原样，未打补丁）
- Node `v24.14.1`，pnpm `11.7.0`（`packageManager` 字段）
- Ubuntu 24.04 x86_64，`dsh web` profile，sandbox `workspace-write`（工具执行经 bwrap）

## Timeline：为什么"之前一直正常，09-24 才失败"

这一点很关键，我先把它钉死，避免被当成"某次升级引入的回归"。

| 时刻 | 事实 |
|---|---|
| 09-20 13:31 | 服务启动（`pnpm dsh web` / `node apps/cli/lib/bin.js web`），此后未再启动 |
| 09-20 → 09-23 | 多个会话、共 300+ 次工具调用全部正常，0 报错 |
| **09-23 14:56:54** | **最后一次成功的工具调用** |
| 09-24 14:00 | 一次提问全程 0 次工具调用（纯文本回答），因此没有暴露 |
| **09-24 14:09:58** | **首次失败**：该会话的第一个工具调用即中断 |
| 09-24 → 09-28 | 4 天内每个用工具的会话都失败，从未自愈 |
| 09-28 10:19 | 打上本补丁并重建 `lib`，10:21 起恢复正常（本次会话 71 次工具调用、0 报错） |

也就是说：**翻转发生在这 23 小时窗口内的某个进程内事件上，而不是某次代码/配置变更上。** 这个缺陷是潜伏的——普通 `Symbol()` 的身份只在一个模块求值内有效，而代码里没有任何东西保证写入方与读取方来自同一次求值。它平时不发作，一旦发生二次求值就永久失效，因此"连续几天正常"和"突然开始失败且不自愈"都是这类缺陷的典型表现。

### 已排除的原因（都在窗口内逐项核对过）

| 排查项 | 结果 |
|---|---|
| checkout 内任何文件（含 `src/`、`lib/`、构建产物） | 窗口内 **0 个文件**被改动；`lib/` 全为 09-20 13:30 构建 |
| `~/.dsh` 任何写入 | 只有会话日志；`settings.yaml`、profile 的 `cordis.yml`、skills 均未变 |
| 工具清单（会话日志的 `request/header.tools`） | 健康会话与失败会话**逐项一致**（同样 27 个工具） |
| 模型 / agentPreset | 全部 `deepseek-v4.1-flash` / `standard` |
| sandbox / permission / approval | 全部 `workspace-write` / `ask`；更早的会话中途切换过模式也正常 |
| 技能目录 | 自 08-24 未变 |
| 会话开局序列（消息投递路径、事件顺序） | 健康与失败会话**完全一致** |
| 插件 / 扩展类事件 | 所有会话日志中**不存在** |
| 启动方式差异 | `pnpm dsh web`（tsx 源码启动）与 `node apps/cli/lib/bin.js web`（构建）都解析 `exports["."] → lib/index.js`，不产生源码/构建分裂 |

### 尚未确定的环节

**具体的进程内触发事件我没有查到**，原因是取证条件不足，而非没有排查：

1. 会话日志只持久化 `{message, code: "UNKNOWN"}`，**不存堆栈**；投影缓存中也没有更完整的错误对象。
2. 服务在终端手动启动，stderr 未重定向到任何文件；`~/.dsh` 下没有日志。
3. 工具执行在 `bwrap --unshare-pid` 中，看不到宿主进程，无法检查其模块注册表或启动时间。

剩下的候选类别只有一个：**进程内对 `dsh-tools` 的二次求值**——例如插件被带缓存失效地重新加载（组合中确有 `cordis-plugin-hmr` 与 `plugin-manager`），或某个运行时动作重新挂载了 tools 插件。这类事件不落盘，所以不留痕迹。

## Root cause

- 该 symbol 全仓库只有一处定义，且刻意不走公开 API（JSDoc 自述 "omitted from the generated named service API"）：[`packages/core/tools/src/index.ts:463`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts#L463) 定义，[`:798`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/tools/src/index.ts#L798) 由 `ToolRuntime` 实例字段写入：

  ```ts
  export const TOOL_RUNTIME_SCHEDULER: unique symbol = Symbol('@deepseek-ai/dsh-tools.scheduler')
  ```

- 读取方跨包：`dsh-agent-loop`（`tool-calls.ts:153/154/170/174`）与同包的 PTC 路径（`packages/core/tools/src/ptc.ts:550`，`registry[TOOL_RUNTIME_SCHEDULER]`）。
- 普通 `Symbol('…')` **每次模块求值都产生新符号**（只有 `Symbol.for` 会查进程级注册表）。因此只要写入方与读取方来自不同次求值，键就必然对不上，表现为 `ctx.tools[TOOL_RUNTIME_SCHEDULER] === undefined`。
- 结论：跨包 seam 使用非注册符号，是身份契约上的缺陷；"为什么出现第二次求值"是次要问题。

## Proposed fix

改成进程级注册符号，并加一条回归测试。本地已验证：语义最小例 `plain=false / for=true`；下面对 tarball 上游的 `git apply --check` 通过（我从本段原样抽出后重新验证过）。

<details>
<summary>补丁（可直接 apply 到 master）</summary>

```diff
diff --git a/packages/core/tools/src/index.ts b/packages/core/tools/src/index.ts
index 6be7be6..8d8bb86 100644
--- a/packages/core/tools/src/index.ts
+++ b/packages/core/tools/src/index.ts
@@ -458,9 +458,17 @@ export interface ToolRuntimeScheduler {

 /**
  * Scheduler entry point omitted from the generated named service API.
+ *
+ * Registered so every loaded copy of this module shares one symbol:
+ * `dsh-agent-loop` reads this key off `ctx.tools`, and a per-evaluation
+ * `Symbol` is private to one copy, failing every tool call with
+ * `Cannot read properties of undefined (reading 'prepare')`.
+ *
+ * The inference carries the `unique symbol` type; an explicit
+ * `: unique symbol` annotation rejects `Symbol.for`'s `symbol` return.
  * @internal
  */
-export const TOOL_RUNTIME_SCHEDULER: unique symbol = Symbol('@deepseek-ai/dsh-tools.scheduler')
+export const TOOL_RUNTIME_SCHEDULER = Symbol.for('@deepseek-ai/dsh-tools.scheduler')

 /** Canonical error code for cancellation after a tool body was invoked. */
 export const TOOL_ABORTED = 'ABORTED'
diff --git a/packages/core/tools/tests/scheduler-symbol.spec.ts b/packages/core/tools/tests/scheduler-symbol.spec.ts
new file mode 100644
index 0000000..ec7e371
--- /dev/null
+++ b/packages/core/tools/tests/scheduler-symbol.spec.ts
@@ -0,0 +1,10 @@
+/** Pins the scheduler seam to one process-global identity: dsh-agent-loop reads it off ctx.tools. */
+
+import { describe, expect, it } from 'vitest'
+import { TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'
+
+describe('TOOL_RUNTIME_SCHEDULER', () => {
+  it('is a registered symbol, so every loaded copy of the module agrees', () => {
+    expect(Symbol.keyFor(TOOL_RUNTIME_SCHEDULER)).toBe('@deepseek-ai/dsh-tools.scheduler')
+  })
+})
```

</details>

替代方案由维护者定，我不确定该 seam 更偏向哪种设计意图：

1. 保持 `Symbol()`，转而保证单实例（把"同一进程内出现两次 `dsh-tools` 求值"本身当成要修的缺陷）；
2. 让该 seam 走普通公开 API 或 Service 方法，不再依赖符号键。

若选 1 或 2，本改动可以撤回——它的价值在于把"跨包 seam 必须有稳定身份"这条约束固定下来。

## Workaround（当前可用的规避手段）

- 打上面的补丁后**重启 `dsh web` 进程**；仅靠插件热重载可能仍留有旧实例，症状会复现。
- 检查 profile 目录（`~/.dsh/profiles/node_modules/@deepseek-ai/`）是否存在指向已删除 checkout 的悬空链接；有则说明系统里还有第二份安装，建议清理或重装 profile。

## 下次如何留下证据（可选，但对定位有益）

既然本次没能拿到堆栈，两个低成本改动能让下一次直接定位：

1. 把裸 TypeError 换成自描述断言，例如在 `agent-loop` 取用 seam 处：

   ```ts
   const scheduler = ctx.tools[TOOL_RUNTIME_SCHEDULER]
   if (scheduler === undefined) {
     throw new Error(
       `tool runtime scheduler seam missing (registered=${Symbol.keyFor(TOOL_RUNTIME_SCHEDULER) ?? 'no'})`,
     )
   }
   ```

2. 启动服务时捕获 stderr：`node apps/cli/lib/bin.js web 2>&1 | tee ~/dsh-web.log`。

也可主动复现以确认触发机制：临时把 `Symbol.for` 改回 `Symbol(`、重建 `lib`、**不重启进程**，然后在 GUI 触发一次插件 reload（或触摸一个被监听的文件），再调用任意工具；若必现，即可确认触发点是插件二次求值。

## Questions for maintainers

1. 这个 seam 的预期契约是哪一种：注册符号（本补丁）、保证单实例，还是改走公开 API？
2. 组合中的 `cordis-plugin-hmr` / `plugin-manager` 是否可能让某个插件在带缓存失效的情况下被重新挂载？如果是，这是否也值得在框架层禁止（例如统一用注册符号，或禁止重复挂载）？
