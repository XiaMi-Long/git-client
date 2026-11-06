# 重写 GitTrail 主界面技术方案

## 现有项目与复用能力

| 路径或接口 | 当前职责/行为 | 可复用能力 | 新增/修改/复用 | 原因与影响范围 |
| --- | --- | --- | --- | --- |
| `src/App.vue` | 挂载旧 `MainView` | 主题初始化、设置加载、恢复仓库 | 修改 | 改为挂载新应用壳；旧 MainView 不再从入口挂载 |
| `src/views/MainView.vue` | 旧三栏布局 + 工作区 + 提交框 | 窗口/监听/布局经验 | 不复用挂载 | 旧 UI 下线；文件暂留不删除 |
| `src/components/layout/TitleBar.vue` | 旧独立 32px 标题栏 | Tauri `getCurrentWindow` 最小化/最大化/关闭、拖拽区 | 逻辑复用，视觉重写 | 新头部整合窗口控制，避免双标题栏 |
| `src/stores/repo.ts` | 多仓库、分支/标签/储藏/状态、路径持久化 | `repos`、`activeRepo`、`openRepo`、`refreshRepo`、`closeRepo`、`setActive`、`restoreRepos` | 修改 | 增加别名、顺序、当前项目持久化；移除当前项目保持监听正确 |
| `src/stores/commit.ts` | 提交分页、搜索、范围、未推送 | `loadCommits`、`loadMore`、`setSearch`、`scope`、`commits` | 复用 | 新提交列表直接使用；不改查询契约 |
| `src/stores/selection.ts` | 旧工作区/提交/分支/远程/冲突/压缩挑拣 | 旧组件仍在用；新 UI 不复用其 working/commit、squash 方法 | 不复用挂载 | 新 UI 不暴露 working/commit UI，避免其 `selectWorking` 副作用 |
| `src/stores/settings.ts` | Git 路径/默认目录/远程保护/储藏模板/时间格式 | 字段和持久化 | 复用 + 设置页接入 | 保留旧设置能力；旧 SettingsDialog 不再挂载 |
| `src/stores/theme.ts` | 仅 light/dark | 主题持久化、`data-theme` | 修改 | 增加 system 模式；新增 density 或独立密度 store |
| `src/components/layout/DiffViewer.vue` | 统一/双栏/词级/换行 diff | 纯 diff 预处理逻辑（词级、双栏） | 逻辑抽取复用，新视觉壳 | 避免复制 500 行 UI；新 Review 外壳匹配原型 |
| `src-tauri/src/commands/mod.rs` | Git 命令注册 | 日志/diff/分支/远程/储藏/cherry-pick/冲突 | 复用 + 补 2 个命令 | 现有能力覆盖大部分需求 |
| `src-tauri/src/git/branch.rs` 等 | 真实 Git 执行 | 分支/远程/储藏/cherry-pick/冲突实现 | 复用 + 补 set upstream/merge continue | 真实数据，不用模板 mock |
| `prototype/*` | 已确认视觉/交互基准 | 全部布局、样式、文案、动效 | 视觉参考 | 实现需替换 mock 数据；不把原型当运行时代码 |

## 接口与字段映射

| 页面字段/业务对象 | 接口字段/业务 ID | 数据类型/单位/枚举 | 0/null/undefined/空串/缺失 | 校验或格式化 | 契约确认依据 |
| --- | --- | --- | --- | --- | --- |
| 项目显示名 | 本地 `alias` / 目录名 | string | 空别名回退目录名 | trim；非法空值提示 | 用户 Q1/Q5；本地 UI 数据 |
| 项目顺序 | localStorage 布局 `order` | number | 缺失按路径恢复顺序 | 拖拽后重排 | 原型 + 用户要求 |
| 当前项目 | `activeId` / 本地 activePath | string | 无效回退第一个项目 | 恢复时校验 | `repoStore` |
| 分支 | `BranchInfo.name` / `full_name` / `is_remote` | string/boolean | 空分支显示空说明 | 分支名 trim、禁止空白/重复 | `src/types/git.ts` |
| 上游 | `BranchInfo.upstream` | string/null | null 表示未设置 | 选择远程分支后 `git_set_upstream` | branch.rs；Q7 |
| ahead/behind | `BranchInfo.ahead/behind` | number | 0 表示同步 | 不小于 0 | 后端 |
| 提交 | `CommitInfo.hash/short_hash/subject/author_name/refs/...` | string/string[]/boolean | body null；refs 空数组 | hash 复制；作者缩写派生 | `git_get_log` |
| diff 文件 | `FileDiff.new_path/old_path/hunks/additions/deletions` | string/hunks/number | 无文件时空列表 | 路径重命名展示 | `git_get_commit_diff` |
| 冲突文件 | `git_list_conflicted_files` | string[] | 空数组表示无冲突 | 路径原样 | remote.rs |
| 操作状态 | `OperationState` | normal/merging/rebasing/cherrypicking/conflict | normal | 按类型分派 continue/abort | `git_get_operation_state` |
| 储藏 | `StashInfo.index/message/branch/hash` | string | 空列表 | 名称 trim；默认 all scope | stash.rs；Q6 |
| 设置项 | settings store 字段 | string/boolean/enum | 缺失用默认值 | 路径/模板/时间格式校验 | settings.ts |

## 模块职责、组件拆分与数据流

新增目录建议 `src/rewrite/`：

- `RewriteApp.vue`：新应用壳，负责标题栏/项目栏/主区、启动 watcher、恢复项目、全局 toast/loading、路由式视图状态（commits/settings）、审查弹窗挂载。
- `components/AppTitleBar.vue`：品牌 + 项目标题 + 主题 + 窗口控制；使用 `data-tauri-drag-region` 和 `getCurrentWindow`。
- `components/ProjectRail.vue`：项目列表、添加/移除、右键重命名、拖拽排序、项目搜索、折叠状态；读取 `repoStore`，调用项目布局 composable。
- `components/AppHeader.vue`：项目名/路径、分支按钮、ahead/behind、同步按钮、储藏按钮、提交搜索、设置按钮。
- `components/BranchPopover.vue`：本地/远程分支、当前态、上游、行内拉取、⋯ 操作菜单；操作由 `useGitActions` 提供。
- `components/CommitList.vue`：真实提交、日期分组、refs/作者、行进入动画、加载更多、空/失败；右键菜单。
- `components/ReviewDialog.vue`：提交审查，文件列表 + diff 视图 + 上一/下一 + 复制 + Esc/焦点。
- `components/ReviewDiff.vue`：复用 DiffViewer 的词级/双栏/换行纯逻辑，配新视觉；支持代码词法高亮与长内容滚动。
- `components/SettingsView.vue`：外观（主题/密度）+ 旧设置项；即时保存。
- `components/StashPopover.vue`：stash 列表、新建、应用、查看、删除。
- `components/ConflictBar.vue`、`ConflictDialog.vue`：操作态、冲突文件、外部打开、标记解决、检查标记、继续、中止。
- `components/ActionMenu.vue`、`components/ActionDialog.vue`、`components/ConfirmDialog.vue`：项目/分支/远程/储藏/选择的统一菜单和表单；支持键盘、锚点定位、危险色。
- `components/ToastHost.vue`、`components/GlobalProgress.vue`：操作反馈；复用现有 `useToast` 思路。
- `composables/useGitActions.ts`：新 UI 的分支/远程/冲突/储藏/cherry-pick action，直接 `invoke` 后端；不引入旧 selectionStore 的 working/commit/squash 行为。包含防重复、错误归一、刷新顺序。
- `composables/useCommitReview.ts`：当前提交、diffs、文件、视图/换行、前后切换、请求序号防竞态。
- `composables/useProjectLayout.ts`：项目别名/顺序/当前项 localStorage；迁移旧 `git-client-recent-repos` 路径列表。
- `styles/rewrite.css`：新视觉 token（原型色板/圆角/阴影/字体）、组件样式、动效；在 `.gittrail-app` 下作用，避免污染旧组件。
- `styles/fonts.css` + `src/assets/fonts/`：Archivo、IBM Plex Mono、Parisienne 本地字体；回退系统字体，保证离线可用。

数据流：

1. `App.vue` 初始化 theme/settings/repo；`repoStore.restoreRepos()` 读取旧路径列表；`useProjectLayout` 应用别名/顺序/当前项；新壳挂载。
2. `ProjectRail` 点击 -> `repoStore.setActive(id)` -> watcher 切换 -> `RewriteApp` watch `activeRepo` -> `commitStore.switchRepo()` + `useGitActions.refreshOperation()`。
3. 提交列表读 `commitStore.commits`；搜索输入防抖 -> `setSearch`；滚动 -> `loadMore`。
4. 点击提交 -> `useCommitReview.open(commit)` -> `git_get_commit_diff`；弹窗；文件/视图/换行本地状态。
5. 头部/分支/储藏按钮 -> 对应 popover/menu；action -> `useGitActions` -> invoke -> 刷新 repo/commit/branches/stashes/operation；toast 依据真实结果。
6. 冲突 action -> `useGitActions.loadOperation()`；冲突条全局可见（设置页隐藏）；继续按 operation 类型调用。
7. 设置 -> store 持久化 + 主题/密度应用；旧设置项原样保留。

## 页面与提交状态流转

- 启动：无项目（显示添加项目/空态）-> 恢复中（轻量 loading）-> 有项目（加载分支/储藏/提交）-> 失败（项目级错误 + 重试，不清空其他项目）。
- 提交列表：初始 -> loading -> 有数据/空仓库/搜索空/失败；失败保留已加载数据，提供重试；分页 loading 与首屏 loading 分离。
- Review：关闭 -> 打开（加载 diff）-> 有文件/无文件/失败；切换文件/视图使用局部 loading；关闭恢复列表焦点。
- 分支/远程/储藏：空闲 -> 操作中（按钮/行内 spinner，禁用重复）-> 成功（刷新 + toast）/失败（原因 + 保留旧数据）/冲突（进入冲突条）。
- 冲突：normal -> 检测到操作 -> 冲突文件列表 -> 标记解决（部分完成）-> 全部解决 -> 继续中 -> 成功 normal / 失败保留冲突；中止 -> normal。
- 设置：读取默认/本地 -> 修改即时生效 -> 写入失败（隐私模式/配额）不阻断当前值，提示持久化失败。

## 相关场景的技术处理

| 维度 | 本次适用性 | 方案/复用位置 | 后端或环境依赖 | 风险与未确认项 |
| --- | --- | --- | --- | --- |
| 表单校验与输入保留 | 分支名、别名、储藏名、上游 | ActionDialog 统一 trim/空值/重复校验；失败保留输入 | Git 返回重名/非法引用 | 分支命名规则交给 Git，前端只做空/空白与本地重复提示 |
| 搜索/筛选/排序/分页 | 提交搜索、作者/哈希、项目搜索 | 复用 commitStore；项目行本地过滤 | `git_get_log` search | 搜索模式固定上限，不触发分页（沿用现有契约） |
| 快速操作、请求竞态、生命周期和幂等 | 连点拉取/推送/合并、快速切项目 | `useGitActions` busy set；commitStore 已有 requestSequence；新 store 使用请求序号 | Tauri invoke 并发 | 操作中切换项目需丢弃旧刷新结果；按钮禁用不能替代后端 |
| 高风险/批量对象、去重、状态跳过、部分失败 | 删除分支/远程分支/储藏、合并、中止 | 二次确认明确对象/范围；当前分支保护；失败不重复执行 | Git 命令 | 部分成功（如批量不适用本次）不虚构；删除远程分支危险提示 |
| 超时/断网/重试与恢复路径 | fetch/pull/push、外部编辑器 | 捕获 invoke 错误；toast 真实原因；保留列表；可重试 | 系统 git、网络、凭据 | 凭据交互由系统 git 处理；应用不保存密码 |
| 灰度、权限、数据范围和登录过期 | 本地桌面应用，无账号权限 | 不做前端权限；不做登录；仅路径可读性 | 本地文件系统 | 只允许用户打开的仓库；不做权限声明 |
| 性能、数据量、渲染、请求和内存 | 大仓库、长 diff、多项目 | 提交分页 100；diff 按文件懒加载；长列表/长 diff 限制滚动；避免重复请求 | WebView2 | 大 diff/hunk 虚拟化列为后续；本次不做 |
| 兼容性、小屏和缩放 | 桌面窗口 1280×720 起 | 项目栏可折叠；弹窗 max-height/宽度；长文本省略；按原型 900/1280 断点 | Windows WebView2 | 未做浏览器/缩放实测，留人工验证 |

## 实现范围、成本与决策

- 前端新增：`src/rewrite/**`（约 15 个组件/composable）、`src/styles/rewrite.css`、字体资源；修改 `App.vue`、`repo.ts`、`theme.ts`（必要时 settings）；新增轻量 `useProjectLayout`/`useGitActions`/`useCommitReview`。
- 前端不再挂载：`MainView`、旧 `TitleBar`、旧 `TopBar`、`Sidebar`、`CommitList`、`FileList`、`CommitBox`、`StatusBar`、`CommitGraphView`/`Swipe...`（旧历史视图入口不出现）。
- 后端新增：`git_set_upstream`、`git_merge_continue`（merge/pull 冲突继续，内部自动提交），注册命令；其余复用。
- 不删除旧组件文件/旧后端 squash 命令（避免无关删除；新 UI 不暴露 squash）。`SquashPickDialog` 不挂载。
- 字体：本地打包 woff2；若字体文件获取失败，使用系统字距回退，不阻断功能。
- 实现顺序：基础壳/项目/提交/Review/设置 -> 分支/远程 -> 冲突/储藏/cherry-pick -> 旧入口清理/静态验证。
- 成本：高（UI 重写 + 真实 Git 接线），分阶段交付；每阶段可运行/可静态检查。

## 风险、迁移与回滚

- 迁移：旧 localStorage `git-client-recent-repos` 为字符串路径数组；新 `useProjectLayout` 读取后合并默认顺序，不丢失旧项目。别名/顺序/当前项新 key 独立，损坏时回退默认。
- 回滚：App.vue 改回旧 `MainView` 可回滚；新组件/新 store 独立，旧文件未删除；后端新增命令为增量，可移除注册。旧工作区/提交能力仍在旧组件和旧 selection store 中，但新 UI 不暴露。
- 风险：真实 Git 脏工作区检出/合并失败、网络/凭据、外部编辑器权限、大 diff 性能、主题/密度与旧 CSS token 冲突、旧组件样式泄漏。新 CSS 限定 `.gittrail-app`，旧 UI 不挂载；主题 data-theme 继续在 documentElement。
- 安全：不保存密码/Token；凭据交给系统 git；外部编辑器仅打开用户冲突文件；删除/合并确认。

## 未决问题与确认状态

- Q1-Q4 已确认（直接替换/内部 add/外部编辑器/移除压缩挑拣）。
- Q5 设置能力保留：已采用，不改变业务；如用户要求删减旧设置，另行调整。
- Q6 新建储藏默认全部改动：可撤回假设；实现后如需要范围选择再补。
- Q7 补 `git_set_upstream`/`git_merge_continue`：技术必需，已采用。
- 无其他阻塞未决问题。实现中出现 Git 契约/UI 新歧义时按 clarification 规则重新提问并同步规划。

## 验证与不执行项

- 默认仅代码阅读 + `git diff` 静态核对；禁止未经授权的构建、类型检查、浏览器/自动化测试。
- 本次计划的人工验证：启动应用、打开真实仓库、项目/提交/Review/分支/远程/冲突/储藏/拣选/设置主流程；在允许时由用户实际运行确认。
- `verification.md` 在实施后记录静态检查、未执行项和人工步骤；不预填通过。
