# session-deletion — 会话删除

本目录记录本 fork 的一处本地改动：**删除会话**，以及将来升级上游时如何重新合并它。

## 这处改动是什么

给用户一条彻底、不可撤销的会话删除路径：删掉会话的持久化日志、投影缓存，以及它在各 Workspace
中的归属、归档与固定记录，同时保证不会有活着的写入者比日志活得更久。它横跨 Host
（`packages/api/session-controller`）与 Web Client（`packages/client/ui-workspace`），并把
`SessionPersistence.remove()` 引入为抽象成员。

与「归档」的区别：归档可撤销、有提示；删除是终态，因此 Client 侧必须先确认。

## 关键坐标

| 项 | 值 |
|---|---|
| 上游基线（本地改动基于此） | `112ce776ac`（2026-09-22 12:12:33 +08:00） |
| 合并时的上游 HEAD | `21638c5631`（2026-09-27 22:30:17 +08:00） |
| 本地快照来源 | `C:\Users\yuegu\Desktop\deepseek-harness-master`（Windows 检出，**没有 `.git`**） |
| 落地提交 | 引入本目录的那个提交，用 `git log --oneline -- doc/session-deletion` 查 |

`112ce776ac` 与 `c36a83ff6b` 给出的差异集合完全一致，任一个都可作基线。

## 结论摘要

- 本地改动最初涉及 **26 个文件**（2 新增 + 24 修改）。
- 与上游 09-22 → 09-27 的进展做三方合并后，**代码部分落地 25 个文件**：上游已将
  `packages/schedule/schedule/tests/plugin.spec.ts` 整体重写并删除了本地补丁所针对的测试替身，
  故该文件采用上游版本，不保留本地改动。
- 代码部分统计：25 files changed, 672 insertions(+), 31 deletions(-)，**不含本 `doc/` 目录**。

## 文档

| 文档 | 内容 |
|---|---|
| [local-changes.md](local-changes.md) | 功能说明：Host 与 Client 两侧各做了什么、契约与失败语义 |
| [changed-files.md](changed-files.md) | 逐文件清单与改动量，以及**必须排除**的 Windows 检出产物清单 |
| [merge-guide.md](merge-guide.md) | **升级上游时照此执行**：环境前置、基线反查、三方合并、冲突处理、验证清单 |
