# 升级合并指南

将来把上游 `deepseek-ai/deepseek-harness` 的新版本合并进本 fork 时，照本文执行。
目标：**只把「会话删除」这处本地改动叠加到新版本上，不把上游的新进展改回去。**

## 0. 先读这一条

本地改动最初是在 `C:\Users\yuegu\Desktop\deepseek-harness-master`（一个**没有 `.git`** 的
Windows 检出）上做的。没有 git 元数据，就无法用 `git diff` 直接得到改动，只能**反查基线提交**
再推导（第 3 节）。这套推导又会被 Windows 检出产物干扰（第 4 节）。

> **强烈建议**：以后本地改动直接在本仓库（`Documents\deepseek-harness\deepseek-harness`）里改，
> 保留 `.git`。那样升级时只需第 6 节的三方合并，第 3–5 节全部可以跳过。

## 1. 环境前置

本机 `git` **不在 PATH 上**，用绝对路径：

```powershell
$git = "C:\Program Files\Git\cmd\git.exe"
```

三个已在本仓库 `.git/config` 里设好的键（换新克隆要重设）：

```powershell
& $git -C $d config http.sslBackend openssl              # 沙箱下 schannel 报 SEC_E_NO_CREDENTIALS
& $git -C $d config http.proxy http://127.0.0.1:10808   # 直连约 40 KiB/s，走代理才可用
& $git -C $d config user.name  conc
& $git -C $d config user.email yueguangsenvzixiang@foxmail.com
```

- **克隆/拉取**：必须带 `-c http.sslBackend=openssl`（只设 `http.proxy` 不够，schannel 会先失败）。
  直连吞吐约 40 KiB/s，本地代理 `127.0.0.1:10808` 才现实。
- **推送**：Git Credential Manager 需要 IPC，沙箱会拦（`couldn't create signal pipe, Win32 error 5`）。
  用 `danger-full-access` 提权重试即可成功。
- 仓库约 246 MB / 534k 对象，完整克隆走代理约几分钟。

## 2. 拉取上游

```powershell
& $git -C $d fetch origin --tags
& $git -C $d log --oneline -1 origin/master
```

若要与上游 `deepseek-ai` 对照（本 fork 是它的副本），按需添加并 fetch 上游远端：

```powershell
& $git -C $d remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
& $git -C $d -c http.sslBackend=openssl -c http.proxy=http://127.0.0.1:10808 fetch upstream
```

## 3. 反查本地改动所基于的上游基线（仅当本地快照无 `.git`）

### 3.1 把本地目录哈希成一棵 git 树

```powershell
$gd = "$d\.git"
$wt = "C:\Users\yuegu\Desktop\deepseek-harness-master"     # 本地快照
$ws = "C:\Users\yuegu\Documents\deepseek-harness"
$env:GIT_INDEX_FILE = "$ws\localtree.index"                # 独立索引，绝不碰仓库自己的索引
Remove-Item "$ws\localtree.index" -ErrorAction SilentlyContinue
& $git --git-dir=$gd --work-tree=$wt add -A
$lt = (& $git --git-dir=$gd write-tree).Trim()             # 本地树对象
& $git --git-dir=$gd ls-tree -r --name-only $lt | Measure-Object | Select-Object -ExpandProperty Count
```

`git add -A` 会遵守 `.gitignore`（`node_modules/`、`.dsh-build/` 等自动排除），
这正是我们要的。**但也会因此漏掉「已跟踪却被忽略」的路径**，见 4.3。

### 3.2 找出差异最小的候选基线

对候选提交逐个比较**两棵树**（不要用 `--work-tree` 的 `git diff <commit>`，见下方警告）：

```powershell
$commits = & $git --git-dir=$gd log --since=2026-09-21T12:00 --until=2026-09-23T06:00 --format='%H|%cI'
$res = foreach ($c in $commits) {
  $h, $dt = $c -split '\|'
  [pscustomobject]@{
    diff  = (& $git --git-dir=$gd diff --name-only $h $lt).Count
    date  = $dt
    short = $h.Substring(0,10)
  }
}
$res | Sort-Object diff | Select-Object -First 8
```

取 `diff` 最小者。**本次结果**：`112ce776ac`（2026-09-22 12:12:33）与 `c36a83ff6b` 同为 52，
且差异集合完全一致，用任一个都行。

> **踩过的坑（务必避免）**：`git --work-tree=<本地目录> diff <commit>` 与
> `... status` 会给出**错误结论**——它把实际存在于磁盘上的文件报成 `D`（删除），
> 因为 git 用仓库自己的 index 做 stat 缓存，与外来 work tree 不匹配。
> 本次它报出 3451 M / 825 D / 27 ??，全部不可信。
> **只比较两个树对象**（上面的写法）才可靠。

## 4. 甄别差异：哪些是真改动，哪些是检出产物

```powershell
$base = "112ce776ac"
& $git --git-dir=$gd diff --name-status $base $lt
```

本次得 **52 项**：26 项真改动 + 25 项 Windows 产物 + 1 项被忽略造成的假象。判定规则：

| 现象 | 判定 | 依据 |
|---|---|---|
| `T`（typechange） | 产物，排除 | `git ls-tree $base` 是 `120000`（符号链接），本地树是 `100644` |
| `M` 但两侧 blob SHA 相同 | 产物，排除 | 仅 `100755` → `100644`，即 `core.filemode=false` 丢了可执行位 |
| `D`（本地缺失）但磁盘上有 | 假象，还原 | `git add -A` 尊重了嵌套 `.gitignore` |

逐项分类脚本：

```powershell
$restore = @()
foreach ($l in (& $git --git-dir=$gd diff --name-status $base $lt)) {
  $st, $p = $l -split "`t"
  if (-not $p) { continue }
  $b  = (& $git --git-dir=$gd ls-tree $base -- $p | Select-Object -First 1)
  $l2 = (& $git --git-dir=$gd ls-tree $lt   -- $p | Select-Object -First 1)
  $bm = ($b -split '\s+')[0]; $bb = ($b -split '\s+')[2]
  if ($st -eq 'T') { $restore += ,@($bm,$bb,$p); continue }              # 符号链接
  if (-not $l2)    { $restore += ,@($bm,$bb,$p); continue }              # 被忽略/缺失
  if ($bb -eq ($l2 -split '\s+')[2]) { $restore += ,@($bm,$bb,$p) }      # 仅模式不同
}
$restore.Count   # 本次 = 26
```

逐项核对清单见 [changed-files.md](changed-files.md) 第 3 节。

## 5. 构造「纯本地改动」树

把 4 节得到的产物路径**还原成基线版本**，剩下的就只是真改动：

```powershell
$env:GIT_INDEX_FILE = "$ws\merged.index"
Remove-Item "$ws\merged.index" -ErrorAction SilentlyContinue
& $git --git-dir=$gd read-tree $lt
foreach ($r in $restore) {
  & $git --git-dir=$gd update-index --add --cacheinfo "$($r[0]),$($r[1]),$($r[2])"
}
$real = (& $git --git-dir=$gd write-tree).Trim()

# 自检：相对基线应只剩真改动，且不含 T、不含仅模式变化
& $git --git-dir=$gd diff --name-status $base $real
& $git --git-dir=$gd diff --name-status $base $real | Group-Object { $_.Substring(0,1) } | Select-Object Name,Count
```

本次自检结果：26 项 = `M` 24 + `A` 2。

## 6. 三方合并到新版本

```powershell
& $git -C $d checkout master
& $git -C $d merge --ff-only origin/master          # 若把上游并入 master

# 用基线 + 纯本地改动树造一个合成提交，使 merge base 正好落在基线
$c = (& $git --git-dir=$gd commit-tree $real -p $base -m "chore: local session-deletion snapshot (base $base)").Trim()
& $git -C $d branch -f local/delete-session $c

# 三方合并（squash：结果落成 master 上一个干净提交，不引入合成提交）
& $git -C $d merge --squash local/delete-session
& $git -C $d diff --cached --name-status HEAD
```

`--squash` 会做完整的三方合并并暂存结果，只是不生成 merge commit。

### 冲突处理原则

本次 `--squash` 自动合并了大部分文件，冲突 3 个文件。通用原则：
**上游的重构优先保留，本地新增叠加其上。**

| 冲突文件 | 处理 |
|---|---|
| `packages/client/ui-workspace/src/client/contract/slots.ts` | 保留上游给 `RowToastProps` 扩写的 JSDoc，把本地 `SessionDeleteConfirmProps` 插在它前面 |
| `packages/client/ui-workspace/src/client/index.ts`（4 处） | 保留上游的 `store: viewStore`、`requestSessionRename = shortcutControls.rename`、product-analytics 导入等重构；加入本地的 delete 注册、`deleteRequest` store 与 3 个 delete 类型导入。注意 `SessionRenameTarget` 由 `export type {…} from './contract/slots.ts'` 直接再导出，**不要**加进 import |
| `packages/schedule/schedule/tests/plugin.spec.ts` | 上游整体重写并删除了本地桩所针对的 `PersistenceProbe` → 直接 `& $git -C $d checkout HEAD -- <path>` 采用上游版本 |

冲突解决后：

```powershell
& $git -C $d add <已解决的文件>
& $git -C $d diff --name-only --diff-filter=U          # 应为空
# 全树扫一遍残留标记
Get-ChildItem $d -Recurse -File -Include *.ts,*.tsx,*.json,*.md,*.css |
  Where-Object { $_.FullName -notmatch '\\node_modules\\|\\\.git\\' } |
  Select-String -Pattern '^(<<<<<<<|>>>>>>>) '
```

## 7. 验证清单（提交前）

按代价从低到高，至少做完前 4 项：

1. **无残留冲突标记**（上一节最后一条命令）。
2. **`remove()` 子类核对**：脚本与清单见 [changed-files.md](changed-files.md) 第 4 节。
   这是最容易漏的一步——上游若新增了 `SessionPersistence` 子类，它会因为缺少抽象成员而编译失败。
3. **删除链路端到端仍在**：`navigation.ts` 的 `deleteSession`、`session-controller/src/index.ts` 的
   `SessionDeleteController` 与 `api-session/removed`、`types.ts` 的 `SessionDeleteRequest`、
   `service.ts` 的 `SessionDeleteError`、JSONL 的 `async remove`、`locales.ts` 的 `menu.deleteSession`。
4. **`git diff --cached --check`** 通过（仓库门禁：文件以单个换行结尾）。
5. **CSS 类仍在**：`DeleteSession.tsx` 引用了 `WorkspaceBrowser.module.css` 的
   `deleteAction` / `deleteStatus` / `archiveActivity` / `renameError`。该 CSS 文件本地没改，
   合并后取上游版本，上游若改名会编译不过。
6. **真正跑测试**（本次未做，克隆里没有 `node_modules`）：
   ```powershell
   pnpm install
   pnpm run typecheck
   pnpm run test:gui        # 客户端 + host 侧 GUI 包，秒级
   ```
   `test:coverage` 才是 CI 的覆盖率门禁；`test:gui` 是内循环。

## 8. 提交与推送

```powershell
& $git -C $d commit -m "feat(session): delete sessions from the host and the workspace sidebar"
& $git -C $d push origin master
```

推送需 `danger-full-access`（凭据管理器被沙箱拦 IPC）。若改写了已推送的提交，
用 `--force-with-lease`，不要用裸 `--force`。

## 9. 本次执行留档

| 步骤 | 结果 |
|---|---|
| 克隆 | `conc/deepseek-harness` `master` @ `21638c5631`（246 MB，走代理） |
| 反查基线 | `112ce776ac`（2026-09-22 12:12:33），差异 52 项 |
| 甄别 | 26 真改动 + 25 Windows 产物 + 1 被忽略假象 |
| 三方合并 | 自动合并大部分；冲突 3 个文件，按第 6 节处理 |
| 验证 | 清单 1–5 项通过；第 6 项（测试）未做 |
| 结果 | 代码部分 25 files, +672/−31，已推送；提交用 `git log --oneline -- doc/session-deletion` 查 |

临时索引（`localtree.index`、`merged.index`）与中间文件用完即删；仓库工作区保持干净。
