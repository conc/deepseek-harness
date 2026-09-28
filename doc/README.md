# doc — fork 本地改动档案

本目录保存本 fork 相对上游 `deepseek-ai/deepseek-harness` 的本地改动记录，供**将来升级上游版本时**
按记录重新合并。远端为 https://github.com/conc/deepseek-harness.git ，默认分支 `master`。

上游没有 `doc/`，这里是 fork 自有内容，不受上游 `docs/` 门禁（doc-sync、verify-doc-budgets 等）
约束，升级合并时**不要删除、不要覆盖**。

## 约定

1. **一处改动一个目录**：`doc/<改动名>/`。名字用短横线小写英文（如 `session-deletion`），
   看到名字就知道是什么功能。
2. 同一处功能历经多次升级合并，继续补进**原目录**，不要另开新目录。
3. 每个目录必须有 `README.md` 作为入口，说清「这处改动是什么、涉及哪些文件、怎么合并升级」。
4. 新建目录后**回到本文件**，在下面的目录表里登记一行。
5. 目录内部可以自由组织。采用的模板是四件套：入口 `README.md`（是什么、关键坐标）、
   `local-changes.md`（功能与契约）、`changed-files.md`（文件清单与产物甄别）、
   `merge-guide.md`（升级操作手册）。改动小时一个 `README.md` 就够，不必凑齐。

## 目录表

| 目录 | 改动 | 上游基线 | 入口 |
|---|---|---|---|
| [`session-deletion/`](session-deletion/) | 会话删除：Host 侧 `SessionDeleteController`，Web Client 侧菜单项与确认弹窗，并把 `SessionPersistence.remove()` 引入为抽象成员 | `112ce776ac`（2026-09-22 12:12） | [README](session-deletion/README.md) |

> 落地提交**不在此处写死哈希**：本目录自身就随该提交一起提交，写死会立刻自相矛盾。
> 需要时用 `git log --oneline -- doc/<改动名>` 查。

## 与 `.agents/notes/` 的分工

`.agents/notes/` 是上游的 Agent Notes 约定，记录要向上游提 PR 的长期决策理由；
本目录是 fork 自己的合并档案，两者互不替代，也不要互相搬运。
