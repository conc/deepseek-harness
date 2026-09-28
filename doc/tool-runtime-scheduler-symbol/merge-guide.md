# 升级合并指南

将来把上游 `deepseek-ai/deepseek-harness` 的新版本合并进本 fork 时，照本文重新合并这处改动。
目标：**让调度器 seam 在新版本上仍是进程级注册符号，且不引入其它差异。**

## 0. 这是一处一行的改动

与 `session-deletion` 不同，本改动只改**一个标识符的构造方式**加一个测试文件，没有跨文件的
接口变更，升级时通常**不会冲突**。

## 1. 定位

```bash
grep -n "TOOL_RUNTIME_SCHEDULER" packages/core/tools/src/index.ts
```

它应位于 `ToolRuntimeScheduler` 接口定义之后。

## 2. 判定上游当前形态

| 上游该行 | 处理 |
|---|---|
| `Symbol('@deepseek-ai/dsh-tools.scheduler')` | **重打本补丁**（第 3 节） |
| `Symbol.for('@deepseek-ai/dsh-tools.scheduler')` | 上游已修，**采用上游版本**（连同它的类型写法）；在本目录记一笔或整体删除本目录 |
| 该 seam 改走公开 API / 不再是 symbol 键 | 上游换了设计，**采用上游版本**，本改动撤回 |

## 3. 重打补丁

优先直接 apply 本目录的补丁：

```bash
git apply doc/tool-runtime-scheduler-symbol/fix.patch
```

若因上游行号漂移 apply 失败，手工替换同样只有两处：

1. `packages/core/tools/src/index.ts`：`Symbol(` → `Symbol.for(`，**去掉**该常量的 `: unique symbol`
   类型标注（不能写成 `as unique symbol`，见第 4 节），同时补上解释性 JSDoc
   （原文见 [local-changes.md](local-changes.md) 第 1 节）；
2. 重新加入 `packages/core/tools/tests/scheduler-symbol.spec.ts`（内容见同节）。

## 4. 验证

```bash
grep -n "TOOL_RUNTIME_SCHEDULER" packages/core/tools/src/index.ts
# 期望：export const TOOL_RUNTIME_SCHEDULER = Symbol.for('@deepseek-ai/dsh-tools.scheduler')

pnpm install
pnpm run typecheck
pnpm --filter @deepseek-ai/dsh-tools exec vitest run tests/scheduler-symbol.spec.ts
```

类型标注不能写成 `as unique symbol`：`unique symbol` 只允许出现在声明位置，出现在类型断言里报
TS1335。留 `const` 推断即可，推断结果仍是 `unique symbol`，`lib/types/index.d.ts` 与显式标注时
逐字相同；`as any` 则会被 `typescript/no-explicit-any` 拦下。

## 5. 重建与重启

源码改动**必须重建 `lib` 并重启 `dsh web` 进程**才生效：

- `lib/` 是构建产物且被 `.gitignore` 忽略，不在仓库里；本地安装需 `pnpm build`（或对应
  workspace 构建脚本）重新生成。
- 打补丁后仅靠插件热重载可能仍留有旧实例，症状会复现——**重启进程**。
- 顺带检查 profile 目录（`~/.dsh/profiles/node_modules/@deepseek-ai/`）是否存在指向已删除
  checkout 的悬空链接；有则说明系统里还有第二份安装，应清理或重装 profile。

## 6. 提交与推送

```bash
git add packages/core/tools/src/index.ts packages/core/tools/tests/scheduler-symbol.spec.ts doc/
git commit -m "fix(tools): register the tool runtime scheduler seam symbol"
git push origin master
```

## 7. 本次执行留档

| 步骤 | 结果 |
|---|---|
| 克隆 | `conc/deepseek-harness` `master` @ `05db320` |
| 基线核对 | 该 commit 的 `packages/core/tools/src/index.ts:480` 仍是 `Symbol(`，确认上游未修 |
| 落地 | 源码 +5/−1，新增测试 +10；本 `doc/` 目录同提交 |
| 验证 | 另见收尾提交说明（克隆无 `node_modules`，未跑 `pnpm install`/测试；已核对符号构造与源码位置） |
| 结果 | 本地提交并推送 `master` |
