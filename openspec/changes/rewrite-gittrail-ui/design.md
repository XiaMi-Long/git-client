# 重写 GitTrail 主界面技术方案

## 现有项目与复用能力

| 路径或接口 | 当前职责/行为 | 可复用能力 | 新增/修改/复用 | 原因与影响范围 |
| --- | --- | --- | --- | --- |
| `src/App.vue` | 挂载旧 `MainView` | 主题初始化、设置加载、恢复仓库 | 修改 | 改为挂载新应用壳；旧 MainView 不再从入口挂载 |
| `src/views/MainView.vue` | 旧三栏布局 + 工作区 + 提交框 | 窗口/监听/布局经验 | 不复用挂载 | 旧 UI 下线；文件暂留不删除 |
| `src/components/layout/TitleBar.vue` | 旧独立 32px 标题栏 | Tauri `getCurrentWindow` 最小化/最大化/关闭、拖拽区 | 逻辑复用，视觉重写 | 新头部整合窗口控制，避免双标题栏 |
| `src/stores/repo.ts` | 多仓库、分支/标签/储藏/状态、路径持久化 | `repos`、`activeRepo`、`openRepo`、`refreshRepo`、`closeRepo`、`setActive`、`restoreRepos` | 复用 | 单个和批量添加均调用现有 `openRepo`；别名、顺序和当前路径由 `useProjectLayout` 独立保存，不修改 store 契约 |
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

项目启动恢复（Q14）由 `repoStore.restoreRepos()` 同步读取旧路径数组，过滤无效条目格式和重复路径，一次创建项目行。`useProjectLayout` 在首屏渲染前恢复顺序、别名和上次激活路径。挂载后按上次路径优先校验和激活，失败时按显示顺序尝试其他项目。激活项目的本地仓库数据、提交和冲突状态并行读取，待仓库数据和首屏提交完成后顺序补齐其他项目的本地分支摘要。

后台摘要复用 `git_list_branches`。工作区、标签、储藏、提交及文件监听在项目激活时准备。目录校验请求由前台和后台共用。激活序号及仓库刷新标识隔离旧响应，监听命令按激活状态串行更新。后台结果只应用到仍在列表且未被前台接管的项目。失效路径从当次列表跳过，启动恢复沿用原有存储格式和显示偏好。

提交作者快捷筛选（Q13/Q18）由 `CommitSearchBox` 展示，`useCommitSearch` 管理防抖和作者请求。打开时按当前视图传入的分支范围调用 `git_list_recent_commit_authors`，读取最近六个月的作者身份。候选按原始姓名和邮箱去重，附带一条代表提交。仓库或分支范围变化时使旧请求失效，读取失败在浮层内提示并提供重试。顶栏把分支操作与搜索作为两个换行项，搜索在同排时靠右，独占一排时靠左。

`commitStore` 将作者和关键词作为独立条件一次应用，第一页和后续页均传给 `git_get_log`。`LogQuery.author` 可省略。选中作者后用带边界的 Git 作者模式限制日志范围，哈希命中也校验作者。关键词匹配作者时使用代表提交复用 Git 的作者匹配，因为多个 `--author` 参数在 Git 中按并集处理。提交信息与哈希匹配继续按关键词搜索的既有结果上限执行。清除单个条件时保留另一项，切换项目清除两个条件。[Git 日志文档](https://git-scm.com/docs/git-log/2.20.0)

分支星标（Q12）接入 `RewriteApp.vue` 现有的本地和远程分支菜单。切换后只收起操作菜单，用户可立即在原位置看到星标。`useProjectLayout` 复用 `gittrail-project-layout` 快照，按仓库路径保存 `BranchInfo.full_name`，因此本地引用、远程引用和不同项目的同名分支各自独立。旧快照缺少此字段时保留原有布局，标记按空恢复。标记切换时立即写入，项目从列表移除时清理该项目的标记。整个流程仅处理本地展示偏好。

代码对比主题（Q11）由 `SettingsView.vue` 复用设置页下拉框，读取 `useThemeStore` 的六个主题选项。选择通过 `gittrail-code-theme` 保存，启动时校验标识，缺失或无效时回到跟随界面。根元素的 `data-code-theme` 为 `code-themes.css` 选择预设。预览、提交审查和储藏详情共用 `--code-*` 变量，统一视图和双栏视图随之更新。各预设参考原配色，按现有高亮类别调整注释、行号和差异底色。

远程同步（Q9/Q10）由 `useRemoteSync` 集中管理用户手动发起的操作，以及按仓库和上游保存的检查时间与失败原因。`RewriteApp` 通过菜单点击或失败后的重新检查发起 `git_fetch`，拉取和推送使用各自的点击入口。各命令与 `useGitActions` 共用既有互斥执行器，开始时捕获仓库 ID、路径、分支和上游。完成后刷新原项目，原项目仍激活时刷新提交与冲突视图。成功时间只在远程命令和状态读取成功后更新，失败保留可用数据，在顶栏显示原因。更多菜单的主文字保持单行，长上游名称在提示列省略并可悬停查看。顶栏使用现有明暗配色，远程进度跟随手动操作显示。

分支预览（Q16/Q17）由 `BranchPreviewDialog` 和 `useBranchPreview` 管理。打开时固定仓库路径和完整分支引用，调用 `git_get_branch_info` 读取本地状态。提交查询复用 `git_get_log`，以分支头的提交哈希固定分页，点击提交复用 `ReviewDialog`。打开、分页、关闭均独立于 `commitStore` 的范围及筛选。远程分支只使用本地历史。弹窗关闭后忽略旧响应，操作结束后只刷新原仓库和仍打开的预览。

本地分支预览（Q18）向共用搜索组件提供自己的提交快照、关键词和作者条件。筛选变化时重读第一页，翻页沿用同一快照及条件。审查使用打开时的提交列表，避免防抖查询替换正在审查的提交。弹窗宽度取视口的 80% 并限制在 1600 像素内，高度取 86%，同时保留边距。

`git_sync_branch_upstream` 与原 Git 操作共用互斥器。后端核对 Git 解析出的远程名、远程分支和本地跟踪引用是否仍与弹窗一致。获取仅更新该跟踪引用。拉取获取后检查祖先关系，并在更新 B 前再次核对工作区和原提交哈希。推送使用 B 的提交哈希与上游完整引用执行普通推送。旧分支菜单的快进命令复用同一路径，原分支列表的数据格式保留。 [Git 获取文档](https://git-scm.com/docs/git-fetch/2.20.0) [Git 引用更新文档](https://raw.githubusercontent.com/git/git/v2.20.0/Documentation/git-update-ref.txt) [Git 推送文档](https://git-scm.com/docs/git-push/2.20.0)

项目添加沿用 `RewriteApp.vue` 已有 `addProject(multiple)`：单个入口传 `false`，批量入口传 `true`；系统目录窗口启用 `directory: true`，根据入口切换 `multiple`，批量标题及按钮提示说明 Ctrl/Shift 多选。逐个调用 `repoStore.openRepo`，已打开路径跳过，单个失败继续；成功路径追加布局顺序，按已有逻辑恢复原激活项目或选择首个成功项目。选择取消不变更状态，原生窗口异常由当前 toast 提示，`finally` 释放两个入口共用的禁用状态。此次仅完善现有流程的提示与异常反馈，无新增 Hook、组件或后端接口。依据为用户 Q8。

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

## 前端项目工具实现（Q19～Q25）

- `RewriteApp.vue` 通过 `ProjectTools` 接入右下角 build 直达入口及项目上下文，并在 `projectMeta` 移除「无已知差异」。`ProjectCommandsDialog` 负责双栏展示及头部的 dist 按钮，`useProjectCommands` 管理脚本读取、执行、停止、目录打开及日志订阅。
- 后端单独增加项目命令模块，读取当前项目根目录的 package.json，返回字符串脚本、包管理器线索及 dist 是否存在。优先使用有效的 `packageManager` 声明，其次识别唯一锁文件，存在歧义时由用户在已确认的选择控件中指定。
- 执行绑定真实项目路径、脚本名和所选包管理器。后端重新确认脚本存在，工作目录为该项目根目录。脚本内容及前后置脚本由所选包管理器解释。portable-pty 提供真实终端，标准输出和标准错误保留终端中的实际合并顺序，通过 Tauri Channel 持续传回。
- 任务由应用级后端状态持有，按真实项目路径隔离，任务和日志携带标识与序号。弹窗订阅和恢复最近一次记录时核对项目及任务，避免重新打开时丢失或重复日志。新执行替换该项目的最近一次记录。
- 手动停止及弹窗关闭共用请求。Windows 通过 ConPTY 启动 cmd，在输入屏障处等待，登记 Job 后才放行包管理器及其后代。包管理器路径及脚本名通过环境变量传递，关闭延迟展开，不使用 call；破坏参数引号边界的脚本名按原生参数错误返回。Unix 复用 portable-pty 创建的独立会话及进程组。停止请求按原任务 ID 定位，不依赖原目录仍然存在。确认退出及日志排空后关闭弹窗。
- 打开 dist 使用实际项目目录拼接固定的 dist 子目录，校验文件夹存在后复用现有系统打开能力。目录入口可在构建结束后重新读取可用状态。

新增前端依赖 `@xterm/xterm`、`@xterm/addon-fit` 和 Rust 依赖 `portable-pty`，其余复用已有 tokio、serde_json 和 shell 打开能力。`project_commands` 提供信息读取、快照读取、终端订阅、启动、输入、尺寸、停止及打开 dist 八条命令，均注册到应用入口。PTY 阻塞读取、写入、等待及关闭在阻塞线程执行，输入线程只持有写管道；关闭 ConPTY 时释放注册表锁，并保留读线程排空输出。

新增 `useProjectTerminal` 管理 xterm 的实例、主题、尺寸监听和分批渲染；`useProjectCommands` 负责项目和任务身份、Channel、输入顺序及关闭流程。数据按 UTF-8 边界解码，保留 ANSI 序列，不再剥离颜色或将回车替换成换行。初始化和重新打开通过同一状态锁交接快照与订阅，按任务 ID 和 revision 排除重复。停止回执恢复完整日志，避免晚到 Channel 输出被跳过。显示层串行解析输出、切换前清理旧任务，并隔离历史重放触发的终端响应。终端回滚缓冲从 10000 行按输出需要扩充，不新增固定行数截断；后端保留本次任务的完整原始输出。

官方接口依据：[xterm.js](https://xtermjs.org/)、[尺寸适配插件](https://xtermjs.org/docs/guides/using-addons/)、[portable-pty](https://docs.rs/portable-pty/0.9.0/portable_pty/)、[Tauri Channel](https://v2.tauri.app/develop/calling-frontend/#channels)、[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)。本次仅静态核对，平台和脚本兼容性尚待人工验证。

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
- Q9/Q10 已确认常驻同步按钮、数量和过程反馈。远程获取由用户点击触发。Hook 读取分支和工作区后一起更新原项目，读取失败保留旧数据。
- 无其他阻塞未决问题。实现中出现 Git 契约/UI 新歧义时按 clarification 规则重新提问并同步规划。

## 验证与不执行项

- 默认仅代码阅读 + `git diff` 静态核对；禁止未经授权的构建、类型检查、浏览器/自动化测试。
- 本次计划的人工验证：启动应用、打开真实仓库、项目/提交/Review/分支/远程/冲突/储藏/拣选/设置主流程；在允许时由用户实际运行确认。
- `verification.md` 在实施后记录静态检查、未执行项和人工步骤；不预填通过。
