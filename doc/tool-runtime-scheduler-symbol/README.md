# tool-runtime-scheduler-symbol — 工具调度器 seam 的符号身份

本目录记录本 fork 的一处本地改动：**把 `TOOL_RUNTIME_SCHEDULER` 从普通 `Symbol()` 改为进程级
注册符号 `Symbol.for()`**，以及将来升级上游时如何重新合并它。

## 这处改动是什么

`@deepseek-ai/dsh-tools` 用 `TOOL_RUNTIME_SCHEDULER` 这个 symbol 键，把工具运行时调度器挂到
`ctx.tools` 上；`dsh-agent-loop` 在**另一个包**里用同一个键把它取出来执行 `prepare()`。
原实现是普通 `Symbol('@deepseek-ai/dsh-tools.scheduler')`——每次模块求值都产生一个新符号，
只有 `Symbol.for()` 才走进程级注册表。因此只要进程内出现**第二份 `dsh-tools` 模块求值**，
写方与读方的键就对不上，`ctx.tools[TOOL_RUNTIME_SCHEDULER]` 恒为 `undefined`，此后
**该进程内所有会话的所有工具调用**都在 `prepare` 处抛错且不会自愈。改成 `Symbol.for()` 后，
符号身份与求值次数无关。

## 关键坐标

| 项 | 值 |
|---|---|
| 上游基线（本次合并进 fork 时） | fork `master` `05db320`（其父为上游 `21638c5631`，2026-09-27 22:30）；该处代码自 09-17 起未变 |
| 本地首次落地与验证 | `0.1.6-alpha.2` tarball 检出，2026-09-28 10:19；改后重建 `lib`，10:21 起恢复 |
| 涉及文件 | 2 个：1 修改 + 1 新增，见 [changed-files.md](changed-files.md) |
| 落地提交 | 引入本目录的那个提交；用 `git log --oneline -- doc/tool-runtime-scheduler-symbol` 查 |

## 结论摘要

- 报错形态：`{"type":"turn/end","reason":{"kind":"error","error":{"message":"Cannot read properties of undefined (reading 'prepare')","code":"UNKNOWN"}}}`——
  会话里留下 `tool/call` 却没有对应的 `tool/result`。
- 判据：报错属性名是 `prepare` 而不是 symbol——`ctx.tools` 本身存在，**只是以该 symbol 为键取不到**，
  所以问题在符号身份，不是服务未加载。
- 根因：跨包 seam 用了**每次求值都新建**的普通 `Symbol`，身份契约不成立；「为什么会二次求值」
  是次要问题。
- 修复：改为 `Symbol.for(...)`，并去掉该常量原有的 `: unique symbol` 标注（`const` 推断结果仍是
  `unique symbol`，不能写成 `as unique symbol`——那是 TS1335），另加一条钉住 `Symbol.keyFor()` 的回归测试。
- 副作用面：只改键的可达性，不改调度器行为。

## 文档

| 文档 | 内容 |
|---|---|
| [local-changes.md](local-changes.md) | 功能与契约：seam 两端、修复语义、失败语义、触发条件与时间线 |
| [changed-files.md](changed-files.md) | 逐文件清单与改动量、必须排除的构建产物、验证命令 |
| [merge-guide.md](merge-guide.md) | **升级上游时照此执行**：定位、重打补丁、验证、重建与重启 |
| [fix.patch](fix.patch) | 可直接 `git apply` 的补丁（源码 + 回归测试） |
| [upstream-report.md](upstream-report.md) | 原始排查报告全文（GitHub Discussion 草稿）：复现、时间线、已排除项、替代方案 |

## 上游状态

截至 fork 基线 `21638c5631`，上游仍是 `Symbol(...)`，未修。若上游将来自己改成注册符号、
或让该 seam 改走公开 API，本处改动即被覆盖：升级合并时**采用上游版本**，并在本目录记一笔
（或整体删除本目录）。
