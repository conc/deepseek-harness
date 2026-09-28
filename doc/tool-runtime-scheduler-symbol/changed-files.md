# 文件清单与产物甄别

## 1. 本地改动的代码文件（2）

相对基线（fork `05db320`，其父为上游 `21638c5631`）代码部分合计 **2 files, +19/−1**，
**不含本 `doc/` 目录**。

| 文件 | +/− | 作用 |
|---|---|---|
| `packages/core/tools/src/index.ts` | +9/−1 | `TOOL_RUNTIME_SCHEDULER` 改用 `Symbol.for`，去掉 `: unique symbol` 标注（推断不变），并补 JSDoc 说明为何不能是普通 `Symbol`、为何不能显式标注 |
| `packages/core/tools/tests/scheduler-symbol.spec.ts` | +10 | **新增** 回归测试：钉住 `Symbol.keyFor()` 的注册名 |

补丁原文见本目录 [fix.patch](fix.patch)。

## 2. 必须排除的构建产物

本处改动最初在 `0.1.6-alpha.2` tarball 检出上落地；该检出里存在、但**不属于本地改动**的路径：

| 现象 | 排除依据 |
|---|---|
| `packages/**/lib/`、`apps/*/lib/`、`apps/web/dist/`、`native/system/.release/`、`native/system/packages/linux-x64/bin/` | 构建产物；上游 `.gitignore` 已忽略 `lib/`、`apps/web/dist/`、`native/system/test/bin/` 等 |
| `node_modules/`、`.dsh-build/` | 本地安装/构建缓存；`.gitignore` 忽略 |

重新推导时一律排除，只保留上面「代码文件（2）」。构建产物不进仓库，**但源码改动必须重建 `lib`
才在运行期生效**，见 [merge-guide.md](merge-guide.md) 第 5 节。

## 3. 验证命令

```bash
# 1) 符号确实改成了注册符号
grep -n "TOOL_RUNTIME_SCHEDULER" packages/core/tools/src/index.ts
# 期望：export const TOOL_RUNTIME_SCHEDULER = Symbol.for('@deepseek-ai/dsh-tools.scheduler')

# 2) 回归测试（需要先 pnpm install）
pnpm --filter @deepseek-ai/dsh-tools exec vitest run tests/scheduler-symbol.spec.ts
```

## 4. 相关但不进仓库的工作区临时文件

| 文件 | 说明 |
|---|---|
| `dsh-fix-tool-runtime-scheduler-symbol.patch` | 本改动在 tarball 检出上的补丁原文；仓库内以 [fix.patch](fix.patch) 留档 |
| `dsh-discussion-tool-runtime-scheduler-symbol.md` | 排查报告原文，已收入本目录 [upstream-report.md](upstream-report.md) |
