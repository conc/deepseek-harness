# 文件清单与产物甄别

## 1. 本地改动的代码文件（25）

代码部分（**不含本 `doc/` 目录**）相对 `21638c5631` 的内容，共 25 files, +672/−31。

| 文件 | +/− | 作用 |
|---|---|---|
| `packages/api/session-controller/src/delete.ts` | +104 | **新增** `SessionDeleteController` |
| `packages/client/ui-workspace/src/client/session-actions/DeleteSession.tsx` | +110 | **新增** 菜单项与确认弹窗 |
| `packages/api/session-controller/src/agent.ts` | +34/−6 | `disposeOwnedAgent()`，区分自有/他人 Agent |
| `packages/api/session-controller/src/client/contract/sessions.ts` | +12 | 删除请求/结果类型 |
| `packages/api/session-controller/src/client/sessions/manager.ts` | +23/−2 | 透出 `deleteSession` |
| `packages/api/session-controller/src/client/sessions/service.ts` | +30 | 客户端删除服务与 `SessionDeleteError` |
| `packages/api/session-controller/src/index.ts` | +33/−5 | 装配控制器、声明 `api-session/removed` |
| `packages/api/session-controller/src/types.ts` | +17 | `SessionDeleteRequest` / `SessionDeleteValue` |
| `packages/api/session-controller/tsconfig.host.json` | +1 | `delete.ts` 进入 Host 编译面 |
| `packages/session/session-persistence/src/index.ts` | +22 | `SessionPersistenceRemoveOptions` + 抽象 `remove()` |
| `packages/session/session-persistence-jsonl/src/index.ts` | +70/−13 | JSONL 后端 `remove()` 实现 |
| `packages/session/session-projection-cache/src/index.ts` | +21 | 具体方法 `drop(id)` |
| `packages/client/ui-workspace/src/client/contract/slots.ts` | +40 | 删除相关注入类型与派生 props |
| `packages/client/ui-workspace/src/client/index.ts` | +48/−4 | 装配删除项/弹窗与注入面 |
| `packages/client/ui-workspace/src/client/locales.ts` | +12 | 删除相关词条 |
| `packages/client/ui-workspace/src/client/navigation.ts` | +12 | `UiWorkspace.deleteSession` |
| `packages/client/ui-workspace/tests/workspaces-service.client.spec.ts` | +7 | 覆盖删除 |
| `packages/client/ui-conversation/tests/conversation-registry.client.spec.ts` | +1 | 随接口调整 |
| `packages/feedback/message-feedback/tests/helpers.ts` | +8 | 替身补 `remove()` 桩 |
| `packages/session/session-checkpoint-policy/tests/session-checkpoint-policy.spec.ts` | +8 | 同上 |
| `packages/session-query/session-query/tests/observation.spec.ts` | +8 | 同上 |
| `packages/session-query/session-query/tests/session-query.spec.ts` | +8 | 同上 |
| `packages/session-query/session-query/tests/tracing.spec.ts` | +8 | 同上 |
| `packages/session-query/session-query-sqlite/tests/sqlite.spec.ts` | +8 | 同上 |
| `packages/test-support/client-runtime/src/sessions.ts` | +27/−1 | 客户端测试支撑随接口调整 |

## 2. 原始本地改动集（26）中被放弃的 1 个文件

| 文件 | 原改动 | 为何放弃 |
|---|---|---|
| `packages/schedule/schedule/tests/plugin.spec.ts` | +8（给 `PersistenceProbe` 补 `remove()` 桩） | 上游在 09-22 之后**整体重写**了该文件（HEAD 与本地相差 246 插入 / 528 删除）并删除了 `PersistenceProbe` 类，桩失去对象。采用上游版本 |

## 3. 必须排除的检出产物（26 项）

本地快照是 **Windows 检出**，与上游仓库形态存在系统性差异。这些差异**不是本地改动**，
重新推导时一律排除；否则会把上游内容改回去（例如把符号链接实体化成普通文件）。

### 3.1 符号链接被实体化（15 项，`120000` → `100644`）

Windows 下 `core.symlinks=false`，仓库中的符号链接被检出成内容为「链接目标路径」的普通文件。

```
.agents/notes/implemented/CLAUDE.md
.claude/skills
apps/cli/tests/profiles/acp/cordis.yml
CLAUDE.md
packages/CLAUDE.md
snapshots/acp/escalation-approved/system-prompt.expected.md
snapshots/acp/escalation-approved/tool-schemas.expected.json
snapshots/acp/image-compaction/system-prompt.expected.md
snapshots/session/agent-instructions/workspace/AGENTS.md
snapshots/session/agent-instructions/workspace/nested/AGENTS.md
snapshots/session/office-skills/system-prompt.expected.md
snapshots/session/office-skills/tool-schemas.expected.json
snapshots/session/office-skills-no-renderer/system-prompt.expected.md
snapshots/session/office-skills-no-renderer/tool-schemas.expected.json
vendor/CLAUDE.md
```

判定方法：`git ls-tree <base> -- <path>` 的模式是 `120000`，而本地树是 `100644`。

### 3.2 可执行位丢失（10 项，`100755` → `100644`）

克隆配置为 `core.filemode=false`（Windows 常态），本地树记录不到可执行位，内容完全相同、**仅模式不同**。

```
.agents/skills/record-browser-gif/scripts/encode_gif.py
apps/desktop/scripts/logged-notarytool.mjs
apps/desktop/scripts/node-bin/node
packages/experimental/webworker-packer/bin.js
scripts/check-expected-filenames.sh
scripts/check-vendor-manifest.sh
scripts/merge-translation-pairing-driver.sh
scripts/prepare-ci-bubblewrap.sh
scripts/wine-windows-gates.sh
vendor/cordis/bin.js
```

判定方法：两侧 blob SHA 相同、模式不同。

### 3.3 被嵌套 `.gitignore` 跳过（1 项）

```
snapshots/web/changed-files-turn/workspace.expected/app.local
```

该目录下存在 `.gitignore`（`*.local`）。用 `git add -A` 生成本地树时它被跳过，于是在差异里
显示为「本地缺失」。实测其内容与 `112ce776ac` 和 `21638c5631` **完全一致**
（blob `3bf90408b4ed9d90c35a8d33b62f7b29503d65de`），并非本地删除，应还原。

> 注意：`.gitignore` 对**已跟踪**文件本不生效；这里出现差异纯粹是「临时索引 + `git add -A`」
> 推导方式造成的假象。重新推导时必须单独检查此类路径。

## 4. `remove()` 子类核对清单

`remove()` 是抽象成员，升级合并后必须确认所有子类都实现了它，否则类型检查失败。
在 `112ce776ac → 21638c5631` 期间上游可能新增子类，**这是最容易漏的一步**：

```powershell
Get-ChildItem packages -Recurse -File -Include *.ts |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' } |
  ForEach-Object {
    $t = Get-Content $_.FullName -Raw
    if ($t -match '(extends|implements)\s+SessionPersistence\b') {
      "{0,-8} {1}" -f ($t -match 'remove\s*\('), $_.FullName
    }
  }
```

合并落地时的结果（7/7 全部实现）：

```
True  packages/feedback/message-feedback/tests/helpers.ts
True  packages/session/session-checkpoint-policy/tests/session-checkpoint-policy.spec.ts
True  packages/session/session-persistence-jsonl/src/index.ts
True  packages/session-query/session-query/tests/observation.spec.ts
True  packages/session-query/session-query/tests/session-query.spec.ts
True  packages/session-query/session-query/tests/tracing.spec.ts
True  packages/session-query/session-query-sqlite/tests/sqlite.spec.ts
```

据此判断：上游 `21638c5631` **尚未**引入 `remove()`（即该抽象成员完全来自本地改动），
所以将来升级时，只要上游还没自己加删除能力，这套改动就要继续带着合并。
