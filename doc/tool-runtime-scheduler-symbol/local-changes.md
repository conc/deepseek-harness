# 本地改动说明 — 工具调度器 seam 的符号身份

本地代码相对上游只改一件事：让 `dsh-tools` 的调度器 seam 在进程内只有一个身份，
与 `@deepseek-ai/dsh-tools` 被求值几次无关。

## 1. 改动点

`packages/core/tools/src/index.ts`，`ToolRuntimeScheduler` 接口之后（`0.1.6-alpha.2` 时为第 463 行，
fork 基线 `05db320` 时为第 480 行）。原样：

```ts
/**
 * Scheduler entry point omitted from the generated named service API.
 * @internal
 */
export const TOOL_RUNTIME_SCHEDULER: unique symbol = Symbol('@deepseek-ai/dsh-tools.scheduler')
```

改为注册符号，并补一段说明为何不能是普通 `Symbol`：

```ts
/**
 * Scheduler entry point omitted from the generated named service API.
 *
 * Registered so every loaded copy of this module shares one symbol:
 * `dsh-agent-loop` reads this key off `ctx.tools`, and a per-evaluation
 * `Symbol` is private to one copy, failing every tool call with
 * `Cannot read properties of undefined (reading 'prepare')`.
 *
 * The inference carries the `unique symbol` type; an explicit
 * `: unique symbol` annotation rejects `Symbol.for`'s `symbol` return.
 * @internal
 */
export const TOOL_RUNTIME_SCHEDULER = Symbol.for('@deepseek-ai/dsh-tools.scheduler')
```

类型标注必须**去掉**，不能沿用原来的 `: unique symbol`：`Symbol.for` 的返回类型是 `symbol`，
`const` 上显式标注 `unique symbol` 报 TS2322，改成 `as unique symbol` 报 TS1335
（`'unique symbol' types are not allowed here`）——`unique symbol` 只允许出现在声明位置，
不能出现在类型断言里。`as any` 虽然能过 `tsc`，但 `typescript/no-explicit-any` 是 error
（另有 `no-unsafe-assignment` 连带报错），所以在仓库门禁下同样不成立。

只留 `const` 推断即可：推断结果仍是 `unique symbol`，`lib/types/index.d.ts` 与改前逐字相同
（`export declare const TOOL_RUNTIME_SCHEDULER: unique symbol;`），因此把该 symbol 当计算属性用
的两处写法（`ToolRuntime` 的实例字段、`dsh-agent-loop` 的 `ctx.tools[...]`）不受影响。

新增回归测试 `packages/core/tools/tests/scheduler-symbol.spec.ts`：

```ts
/** Pins the scheduler seam to one process-global identity: dsh-agent-loop reads it off ctx.tools. */

import { describe, expect, it } from 'vitest'
import { TOOL_RUNTIME_SCHEDULER } from '@deepseek-ai/dsh-tools'

describe('TOOL_RUNTIME_SCHEDULER', () => {
  it('is a registered symbol, so every loaded copy of the module agrees', () => {
    expect(Symbol.keyFor(TOOL_RUNTIME_SCHEDULER)).toBe('@deepseek-ai/dsh-tools.scheduler')
  })
})
```

## 2. 契约

- **写方**：`ToolRuntime` 的实例字段以该 symbol 为键写入调度器（`packages/core/tools/src/index.ts` 内）。
- **读方**：跨包读取，至少两处——
  - `packages/core/agent-loop/src/tool-calls.ts`：`ctx.tools[TOOL_RUNTIME_SCHEDULER].prepare(...)`；
  - `packages/core/tools/src/ptc.ts`：`registry[TOOL_RUNTIME_SCHEDULER]`。
- **契约**：跨包 seam 的键身份必须**在进程内唯一，且与模块求值次数无关**。这就是改用
  `Symbol.for` 的全部理由；它不改变调度器行为，只改变键的可达性。

## 3. 失败语义（修前）

- 触发后不是「某个工具坏了」，而是「该进程内此后所有会话的所有工具调用都坏」，不会自愈，
  重启进程才恢复。
- 事件序列：`tool/call` 落盘 → 抛错 → `turn/end` 带 `code: UNKNOWN`，全程没有 `tool/result`。
- 抛错点（`0.1.6-alpha.2`）：`packages/core/agent-loop/src/tool-calls.ts:170`——
  先 `appendToolCall(...)` 写 `tool/call`，再取调度器时炸掉，因此「有 call 无 result」。
- 潜伏性：普通 `Symbol` 的身份只在一次求值内有效，而代码里没有任何东西保证读写来自同一次
  求值；平时不发作，一旦二次求值就永久失效——所以表现为「连续几天正常」后
  「突然开始失败且不自愈」。

## 4. 触发条件与时间线

（摘要，全文见 [upstream-report.md](upstream-report.md)）

| 时刻 | 事实 |
|---|---|
| 09-20 13:31 | 服务启动，此后未再重启 |
| 09-20 → 09-23 | 多个会话、共 300+ 次工具调用全部正常 |
| 09-23 14:56:54 | 最后一次成功的工具调用 |
| 09-24 14:00 | 一次纯文本会话，0 次工具调用，因此没有暴露 |
| 09-24 14:09:58 | 首次失败：该会话的第一个工具调用即中断 |
| 09-24 → 09-28 | 4 天内每个用工具的会话都失败，从未自愈 |
| 09-28 10:19 | 打补丁并重建 `lib`；10:21 起恢复正常（71 次工具调用 0 报错） |

翻转发生在一个 **23 小时窗口内的进程内事件**上，而不是某次代码/配置变更：窗口内 checkout
**0 个文件**被改动；`~/.dsh` 只有会话日志；工具清单、模型、agentPreset、sandbox、技能目录、
会话开局序列、插件事件均与健康会话逐项一致。

**尚未确定的环节**：具体的进程内触发事件没有取到证据——会话日志只持久化
`{message, code: "UNKNOWN"}` 不存堆栈，服务 stderr 未重定向留档，工具执行在
`bwrap --unshare-pid` 中看不到宿主模块注册表。唯一剩下的候选是**进程内对 `dsh-tools` 的
二次求值**（组合中确有 `cordis-plugin-hmr` 与 `plugin-manager`，这类事件不落盘）。
本改动把结论钉在「seam 身份契约」上，因此不依赖对该触发事件的最终定位。

## 5. 替代方案（上游可选）

1. 保持 `Symbol()`，转而保证单实例（把「同一进程内出现两次 `dsh-tools` 求值」本身当成要修的缺陷）；
2. 让该 seam 走普通公开 API 或 Service 方法，不再依赖符号键。

本改动选注册符号：改动面最小，且把「跨包 seam 必须有稳定身份」这条约束固定下来。
