# 本地改动说明 — 会话删除（Session Deletion）

本地代码相对上游只加了一件事：**删除会话**。它横跨 Host（`packages/api/session-controller`）
与 Web Client（`packages/client/ui-workspace`）两侧，并顺带把「持久化层可删除」这一抽象成员
引入 `SessionPersistence`。

## 1. 功能目标

给用户提供一条彻底的、不可撤销的会话删除路径：删掉会话的持久化日志、投影缓存，以及它在各
Workspace 中的归属、归档与固定记录；同时保证不会有活着的写入者比日志活得更久。

与「归档」的区别：归档可撤销、有提示；删除是终态，没有撤销也没有提示，因此 Client 侧必须
先确认。

## 2. Host 侧

### 2.1 `SessionDeleteController` — `packages/api/session-controller/src/delete.ts`（新增 104 行）

删除一个会话的完整顺序，顺序本身是语义的一部分：

1. 校验 `sessionId` 非空，否则抛 `gateway/bad-request`。
2. 若 Agent 仍存活：`status === 'running'` 且请求未带 `stopActivity` → 抛 `session/agent-busy`
   （`reason: 'running-work'`）；否则调用 `agents.disposeOwnedAgent(sessionId)` 拆除。
   控制器只拆除**自己** resume/create 的 Agent；若 Agent 归别的 owner（子代理的，或 loop 自己
   启动的），返回 false → 抛 `session/agent-busy`（`reason: 'foreign-owner'`），
   **拒绝而不是从别的 owner 手里抢删**。
3. 取 `sessionPersistence` 服务（缺失 → `gateway/internal`），调用新增的
   `persistence.remove(sessionId, { signal })`。
   捕获 `SessionAlreadyOwnedError` → 抛 `session/writer-held`（仍有写入者持有日志）。
4. `removed === false && !live` → 抛 `session/not-found`。
5. `dropProjectionCheckpoint()`：仅当确有其物时丢弃缓存投影行，失败只告警不抛出。
6. `forgetMembership()`：对所有 Workspace `detachSession`，必要时 `unarchiveSession` /
   `unpinSession`（幂等、无条件）。
7. `ctx.emit('api-session/removed', sessionId)`。
8. 返回 `{ deleted: removed }`。

要点：**先拆 Agent 再删日志**，否则活着的写入者会晚于日志存在；投影与归属清理放在删除成功之后
（「只在提交点发布状态」）。

### 2.2 持久化契约扩展 — `packages/session/session-persistence/src/index.ts`（+22）

新增 `SessionPersistenceRemoveOptions { readonly signal?: AbortSignal }` 与

```ts
abstract remove(id: SessionId, options?: SessionPersistenceRemoveOptions): Promise<boolean>
```

语义（JSDoc 已写明）：调用成功后该会话对同后端的 `stat` / `list` / `open` 永久不可见——删除的是
整个 per-session artifact 目录而非截断，因此并发读者只会看到「之前完整的日志」或「什么都没有」。
不负责终止活着的 owner（上层先停止或解绑）。仍持有写所有权时抛 `SessionAlreadyOwnedError`。

**这是抽象成员**：所有子类必须实现，见 [changed-files.md](changed-files.md) 的核对清单。

`packages/session/session-persistence-jsonl/src/index.ts`（+70/−13）是真实实现。
`packages/session/session-projection-cache/src/index.ts`（+21）新增具体方法 `async drop(id)`（非抽象）。

### 2.3 其余 Host 改动

- `agent.ts`（+34/−6）：`disposeOwnedAgent()`，区分「自己持有的 Agent」与「别人的」。
- `client/contract/sessions.ts`（+12）、`types.ts`（+17）：新增 `SessionDeleteRequest` /
  `SessionDeleteValue` 等类型。
- `client/sessions/manager.ts`（+23/−2）、`client/sessions/service.ts`（+30）：
  客户端会话管理器/服务透出 `deleteSession`，并定义 `SessionDeleteError`。
- `index.ts`（+33/−5）：装配 `SessionDeleteController`，声明 `api-session/removed` 事件。
- `tsconfig.host.json`（+1）：新增 `delete.ts` 进入 Host 编译面。

## 3. Client 侧

### 3.1 `DeleteSession.tsx` — `packages/client/ui-workspace/src/client/session-actions/DeleteSession.tsx`（新增 110 行）

- `DeleteSessionMenuItem`：`sidebar.workspaces.session.menu.item` 上的一行（order 500，图标
  `IconTrashOutlineRegular`），点击即关闭菜单并调用 `deleteSession(sessionId)`。
- `SessionDeleteConfirmDialog`：注册进 `shell.overlay`；没有待确认请求时返回 `null`，
  否则按 `sessionId` 作为 key 渲染一个弹窗，避免上一个请求的 in-flight / error 状态泄漏到下一个。
- `DeleteConfirmForm`：本地 `deleting` / `error` 状态；确认时调用
  `stopAndDeleteSession(sessionId)`，成功即 `onSettle()`，失败把消息显示在 `role="alert"` 里。
  删除中禁止关闭（`close()` 直接 return）。

弹窗文案全部走 locale，不硬编码（符合仓库的 locale-owned 文案规则）。

### 3.2 其余 Client 改动

- `index.ts`（+48/−4）：装配删除项与确认弹窗；`deleteRequest` 快照 store（`SessionDeleteConfirmRequest | null`）；
  `deleteInjected` / `deleteConfirmInjected` 两个注入面；`stopAndDeleteRefusal()` 判定
  「运行中工作」这一类拒删。
- `contract/slots.ts`（+40）：`DeleteSessionInjected`、`SessionDeleteConfirmInjected`、
  `SessionDeleteConfirmRequest`、`SessionDeleteMenuItem` 等注入类型与派生 props。
- `locales.ts`（+12）：`menu.deleteSession`、`delete.session.title/desc/action/running/pending` 等词条。
- `navigation.ts`（+12）：`UiWorkspace.deleteSession(sessionId, { stopActivity })`。

## 4. 测试与替身

因为 `remove()` 成为抽象成员，若干测试替身需要补桩；另有测试覆盖删除行为本身：

- `packages/session-query/session-query/tests/{observation,session-query,tracing}.spec.ts`（各 +8）
- `packages/session-query/session-query-sqlite/tests/sqlite.spec.ts`（+8）
- `packages/session/session-checkpoint-policy/tests/session-checkpoint-policy.spec.ts`（+8）
- `packages/feedback/message-feedback/tests/helpers.ts`（+8）
- `packages/test-support/client-runtime/src/sessions.ts`（+27/−1）
- `packages/client/ui-workspace/tests/workspaces-service.client.spec.ts`（+7）
- `packages/client/ui-conversation/tests/conversation-registry.client.spec.ts`（+1）

> `packages/schedule/schedule/tests/plugin.spec.ts` 原本也在本地改动中（给 `PersistenceProbe`
> 补 `remove()` 桩，+8），但上游在 09-22 之后整体重写了该文件并删除了 `PersistenceProbe`，
> 该桩随之失效，最终采用上游版本。

## 5. 已知未做的事

- 未运行 `pnpm run test` / `typecheck` / `test:gui`：合并时克隆目录没有 `node_modules`，
  只做了静态核对（见 [merge-guide.md](merge-guide.md) 的验证清单）。
- 未新增 keyless recorded-session snapshot。按仓库规则，产品可见改动通常需要更新快照；
  若将来要向上游提 PR，需要补齐。
