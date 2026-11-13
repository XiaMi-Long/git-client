## 实施前的需求确认

- [x] 0.1 核对 proposal/ux-review/clarification 的 Q1-Q7 与用户答复，确认无阻塞项；读取 `ui-review.md` 的最终 UI 基准，确认报告结论允许进入实现
- [x] 0.2 复核真实代码契约：`src/stores/*`、`src/types/git.ts`、`src-tauri/src/commands/mod.rs`、`branch.rs`、`remote.rs`、`stash.rs`、`diff.rs`、`log.rs`；确认不删除旧文件、不扩大旧 selectionStore working/squash 使用范围
- [x] 0.3 确认当前授权边界：2026-11-06 用户要求启动、提交代码及完善项目单个/多个添加；复用已有桌面进程和开发服务，只做代码阅读与 Diff，不运行构建、类型检查、浏览器或测试

## 1. 增量实现

### 1.1 基础壳、视觉与主题

- [x] 1.1.1 新建 `src/rewrite/RewriteApp.vue` 应用壳：标题栏/项目栏/主区/设置视图/审查弹窗/全局 toast 与进度；处理启动、仓库监听、项目恢复
- [x] 1.1.2 新建 `src/rewrite/components/AppTitleBar.vue`：品牌、项目名、主题按钮、窗口最小化/最大化/关闭、`data-tauri-drag-region`；复用 Tauri `getCurrentWindow` 逻辑
- [x] 1.1.3 新建 `src/styles/rewrite.css` 与 `.gittrail-app` 视觉 token（原型色板、圆角、阴影、行高、动效、reduced-motion）；导入 `main.ts` 或应用壳，避免污染旧组件
- [x] 1.1.4 字体：新增 `src/styles/fonts.css` 与 `src/assets/fonts/` 的 Archivo/IBM Plex Mono/Parisienne 本地 woff2；失败时回退系统字体，不阻断
- [x] 1.1.5 扩展 `src/stores/theme.ts`：system/light/dark + density comfortable/compact，保留旧 light/dark 调用兼容；持久化并应用 `data-theme`/`data-density`
- [x] 1.1.6 修改 `src/App.vue` 挂载新 `RewriteApp`；旧 `MainView` 不再从入口挂载；旧组件文件暂留
- [ ] 完成依据：应用入口只渲染新壳；主题 system/light/dark 与密度可切换；旧三栏/提交框/状态栏不可见；代码静态检查无未处理导入

### 1.2 项目列表、别名、排序与持久化

- [x] 1.2.1 复用 `src/stores/repo.ts` 的仓库打开及旧路径数组持久化；项目顺序/别名/当前项目由 `useProjectLayout` 单独保存，不修改 `RepoTab` 或已有接口
- [x] 1.2.2 新建 `src/rewrite/composables/useProjectLayout.ts` 或等价逻辑：读取/写入顺序、别名、activePath；路径失效回退
- [x] 1.2.3 新建 `src/rewrite/components/ProjectRail.vue`：项目行、当前态、分支/状态、添加项目、移除项目、右键重命名、拖拽排序、项目搜索、折叠
- [x] 1.2.4 接入 `@tauri-apps/plugin-dialog` 打开目录与 `repoStore.openRepo/closeRepo/setActive`；移除当前项目后监听与激活切换正确
- [x] 1.2.5 项目右键菜单和重命名使用统一 `ActionMenu`/`ActionDialog`；别名空值/重复提示，真实路径不变
- [x] 1.2.6 按用户 Q8 保留单个/批量两个入口，确认原生目录窗口按入口单选或多选，补充 Ctrl/Shift 多选提示和选择窗口异常反馈
- [x] 1.2.7 代码阅读核对重复跳过、部分失败继续、取消、布局持久化、保留当前项目及共用禁用状态；真实目录选择与添加操作未执行，按 MF-02a 待人工验证
- [x] 1.2.8 为 Windows 窗口启用前端拖拽事件，核对项目排序和软件内显示别名按仓库路径保存在本地。实际拖拽和重启恢复按 MF-02 待人工验证
- [x] 1.2.9 按用户要求在主头部同时展示别名和原始目录名，使用单行主次排版，补充长名称提示及新增元素的拖动标记；完成代码阅读与 Diff，界面效果待人工确认
- [x] 1.2.10 项目右键菜单提供「复制绝对路径」，复用剪贴板和结果提示。实际粘贴结果待人工确认
- [x] 1.2.11 按 Q14 拆分项目行恢复和 Git 数据读取。优先激活上次项目并加载首屏提交，再后台补齐其他项目摘要。核对快速切换、失效路径及文件监听，冷启动待 MF-01 人工验证
- [ ] 完成依据：至少 2 个真实仓库可切换/添加/移除；拖拽和别名刷新后保留；路径不改变；旧项目本地存储可迁移

### 1.3 头部、提交列表与搜索

- [x] 1.3.1 新建 `src/rewrite/components/AppHeader.vue`：项目显示名/路径 tooltip、分支按钮、ahead/behind、同步按钮、储藏按钮、搜索、设置
- [x] 1.3.2 新建 `src/rewrite/components/CommitList.vue`：真实 `commitStore.commits`、日期分组、作者缩写/稳定色、refs、unpushed、merge 标记、日期标签、加载更多、空/失败/加载态
- [x] 1.3.3 搜索防抖 + 回车；切换当前分支/所有分支/浏览分支；滚动分页；请求序号防止旧结果覆盖
- [x] 1.3.4 提交行进入动画、右键菜单入口、键盘选择与 Enter 打开审查；加载更多按钮与无更多状态
- [x] 1.3.5 按 Q13 提供近半年作者浮层、选中标签、独立清除和读取反馈。通过 `useCommitSearch` 处理防抖及旧范围响应，通过 `commitStore` 和 Git 日志应用精确作者与关键词条件。实际操作待 MF-03a 人工验证
- [x] 1.3.6 提交行右键菜单提供「复制提交信息」，按标题与可选正文拼接并复用复制结果提示。实际粘贴待人工确认
- [x] 1.3.7 加强提交行的「未推送」徽标，复用明暗主题配色增加底色、描边和粗体。实际视觉效果待人工确认
- [x] 1.3.8 按 Q15 隐藏切换期间的提交加载提示，等待分支继续区分查询中、空态和失败。实际切换效果待人工确认
- [x] 1.3.9 按相对时间和绝对时间设置调整时间列宽，保持单行对齐，过长文字可悬停查看。实际显示待人工确认
- [ ] 完成依据：真实仓库提交可见；搜索/分页/范围切换正确；空/失败不混淆；快速切换不显示旧仓库数据

### 1.4 Review 弹窗与真实 diff

- [x] 1.4.1 新建 `src/rewrite/components/ReviewDialog.vue`：文件列表、提交标题/作者/时间/hash、复制、上一个/下一个、关闭、焦点与 Esc
- [x] 1.4.2 新建 `src/rewrite/composables/useCommitReview.ts`：`git_get_commit_diff`、文件选择、diffs、请求序号、无文件/失败状态
- [x] 1.4.3 新建 `src/rewrite/components/ReviewDiff.vue`：从 `DiffViewer.vue` 抽取词级/双栏/换行纯逻辑并配新视觉；统一/双栏/换行、行号、增删色、长 diff 滚动
- [x] 1.4.4 代码词法高亮与代码主题 token（沿用原型视觉）；文件重命名路径展示；扩散按钮禁用原因
- [ ] 完成依据：任意提交的文件与 diff 对应；三种视图/换行可用；前一/后一提交可用；Esc/焦点正常；无文件/失败有说明

### 1.5 设置页

- [x] 1.5.1 新建 `src/rewrite/components/SettingsView.vue`：原型视觉、主题 system/light/dark、密度、代码预览
- [x] 1.5.2 保留 `settingsStore` 现有设置：Git 路径、默认打开目录、远程保护、储藏名模板、时间格式；新页面读写并持久化
- [x] 1.5.3 设置页入口从头部齿轮/标题栏进入；Esc/返回提交列表；滚动与窄窗口可用
- [x] 1.5.4 按 Q11 提供六个代码对比主题选项，复用现有主题 Store 保存偏好，统一设置预览、提交审查与储藏详情的代码配色。真实切换和重启恢复待 MF-10a 人工验证
- [ ] 完成依据：主题/密度即时生效并持久化；旧设置项仍可修改；切换设置不丢当前项目/提交

### 1.6 分支与远程

- [x] 1.6.1 新建 `src/rewrite/components/BranchPopover.vue`：本地/远程分组、当前态、上游、远程标记、行内拉取、⋯ 操作菜单
- [x] 1.6.2 新建 `src/rewrite/composables/useGitActions.ts`：检出、新建、重命名、删除、合并、从远程创建、设置上游、分支拉取；统一 busy、错误、刷新顺序
- [x] 1.6.3 新建 `src/rewrite/components/ActionMenu.vue`/`ActionDialog.vue`/`ConfirmDialog.vue`：锚点定位、键盘、危险色、确认、表单校验；项目/分支/储藏复用
- [x] 1.6.4 远程同步菜单：fetch/pull/push/设置当前上游；远程分支删除；无上游/鉴权/网络错误提示；操作中防重复
- [x] 1.6.5 后端补齐 `git_set_upstream` 命令（`git branch --set-upstream-to`），注册并与分支弹层/同步菜单接线
- [x] 1.6.6 按 Q9/Q10 接入 `useRemoteSync`，仅由用户点击发起远程操作，提供原位进度、共享 Git 互斥和按仓库隔离的检查结果
- [x] 1.6.7 顶栏常驻拉取与推送按钮和数量，区分无上游、未检查和失败。更多菜单的操作文字保持单行，长上游名称可悬停查看
- [x] 1.6.8 完成新增 Hook 注释及代码阅读、Diff 核对，将开发静态检查与真实体验未执行分别记录，不运行测试、类型检查或构建
- [x] 1.6.9 按 Q12 在本地和远程分支菜单提供标记与取消入口，原位展示星标。复用 `useProjectLayout` 按仓库路径和完整分支引用保存。真实交互和重启恢复待 MF-05a 人工验证
- [x] 1.6.10 按 Q16/Q17 接入独立分支弹窗和 `useBranchPreview`，复用历史查询与提交审查。新增预览查询和手动同步命令，按实际远程上游获取、快进拉取和普通推送。远程分支预览只读，真实行为待 MF-05b 人工验证
- [x] 1.6.11 按 Q18 将提交搜索抽成 `CommitSearchBox` 供主列表和本地分支预览复用。顶栏搜索换行左对齐，预览尺寸随窗口调整，筛选查询按所选分支独立执行。桌面体验待 MF-05c 人工验证
- [ ] 完成依据：真实本地/远程分支可见；六类分支操作与远程命令成功/失败结果真实；当前分支保护；连点不重复；刷新正确

### 1.7 冲突

- [x] 1.7.1 新建 `src/rewrite/components/ConflictBar.vue`：操作类型、来源/目标、文件数、已解决数、查看/继续/中止；设置页隐藏
- [x] 1.7.2 新建 `src/rewrite/components/ConflictDialog.vue`：冲突文件列表、外部编辑器打开、标记已解决、检查冲突标记、继续/中止；外部编辑器用 Tauri shell open 或等价权限
- [x] 1.7.3 `useGitActions` 接入 `git_get_operation_state`、`git_list_conflicted_files`、`git_mark_resolved`、`git_check_conflict_markers`、`git_abort_operation`、`git_cherry_pick_continue`
- [x] 1.7.4 后端补齐 `git_merge_continue`（merge/pull 冲突继续，内部 `git add`/自动提交，使用非交互编辑器），注册；按 operation 类型分派继续
- [x] 1.7.5 冲突状态在 merge/pull/cherry-pick 成功后刷新；中止后回到 normal；残留标记拦截；冲突条/弹窗与真实状态一致
- [ ] 完成依据：可构造冲突的 merge 与 cherry-pick 均可外部解决、标记、继续/中止；残留标记被拦截；不出现手工暂存/提交框

### 1.8 储藏

- [x] 1.8.1 新建 `src/rewrite/components/StashPopover.vue`：真实 stash 列表、新建、应用、查看、删除、计数
- [x] 1.8.2 `useGitActions` 接 `git_list_stashes`/`git_create_stash`/`git_apply_stash`/`git_drop_stash`/`git_show_stash`；新建默认 all（Q6 可撤回假设），名称按设置模板预填
- [x] 1.8.3 查看储藏复用 ReviewDiff 或外部 diff 面板；应用/删除后刷新 stash/状态；失败/空态提示
- [ ] 完成依据：真实 stash 数据；新建/应用/查看/删除成功与失败可区分；计数与列表同步

### 1.9 Cherry-pick

- [x] 1.9.1 提交右键菜单增加 Cherry-pick 到当前分支；不增加压缩挑拣入口；旧 `SquashPickDialog` 不在新壳引用
- [x] 1.9.2 `useGitActions` 接 `git_cherry_pick`；冲突进入冲突条，继续/中止复用 1.7；成功后刷新提交/分支
- [ ] 完成依据：成功挑选刷新；冲突闭环；菜单无压缩挑拣；当前分支/重复提交错误提示真实

### 1.10 旧入口下线与收尾

- [x] 1.10.1 `src/App.vue`/新壳不再引用 `MainView`、旧 `TitleBar`/`TopBar`/`Sidebar`/`CommitList`/`FileList`/`CommitBox`/`StatusBar`/旧历史视图
- [x] 1.10.2 确认新壳没有手工暂存/提交/压缩挑拣入口；旧 `selectionStore` working/commit/squash 方法不被新组件调用
- [x] 1.10.3 清理本次新增代码产生的未使用导入/变量/函数；不删除旧文件、不改无关旧代码
- [x] 1.10.4 补充新文件文件头、关键函数 JSDoc（真实日期 2026-11-04）、复杂状态/错误/竞态注释；不虚构作者
- [ ] 完成依据：入口可见范围只有新界面；静态引用检查无旧组件挂载；diff 无无关格式化

### 1.11 前端项目命令与产物入口（Q19～Q25，代码及静态核对完成）

- [x] 1.11.1 从项目副标题移除「无已知差异」，按 Q24 接入右下角 build 直达入口，并在弹窗内提供打开 dist
- [x] 1.11.2 新增项目脚本读取与包管理器识别，支持用户在弹窗手动切换
- [x] 1.11.3 新增 `ProjectCommandsDialog` 与 `useProjectCommands`，展示实际 scripts 并执行所选命令
- [x] 1.11.4 新增后端脚本任务及实时日志事件，按项目隔离最近一次记录，失败与结束使用确认文案
- [x] 1.11.5 接入停止、关闭、切换项目和退出应用时的子进程清理，关闭后在当前应用会话保留日志
- [x] 1.11.6 按当前授权完成代码阅读与 Diff 核对，记录 MF-13 的待人工验证范围
- [x] 1.11.7 按 Q25 引入 xterm.js、addon-fit 和 portable-pty，替换日志和输入面板，接入增量 Channel、尺寸、任务隔离及原有关闭清理；已完成代码与 Diff 静态核对，实际交互待 MF-13e 人工验证

## 2. 开发自测

- [ ] 2.1 静态自检：读修改后的组件/store/后端命令，检查空值、异常、竞态、重复操作、监听清理、事件解绑；执行 `git diff` 核对无无关改动
- [ ] 2.2 真实环境人工用例：按 test-plan 的 ST-01～ST-14 执行项目/提交/Review/分支/远程/冲突/储藏/拣选/设置/并发/错误流程；未执行项如实记录
- [ ] 2.3 运行验证授权：构建、`vue-tsc`、浏览器/自动化均未获授权；不创建测试代码、不启动服务
- [ ] 完成依据：静态检查结论和 `git diff` 证据写入 `verification.md`；人工用例未执行则保留待办，不伪造通过

## 3. 独立用户体验检查

- [ ] 3.1 从用户视角走“打开项目 -> 浏览提交 -> 审查 -> 分支/冲突 -> 返回”完整流程，检查理解、下一步、反馈、冗余和失败恢复
- [ ] 3.2 有原型：按 `ui-review.md` 的基准与对照用例实际打开新界面逐区域对照；当前无浏览器/运行授权，记录待执行/需人工，不以代码推断替代
- [ ] 完成依据：体验检查记录/截图（获准时）或明确待人工步骤；原型差异有修复/确认

## 4. 问题修复与回归

- [ ] 4.1 修复静态/人工验证发现的问题，回归受影响用例；记录根因和修改文件
- [x] 4.1.1 根据用户截图修复 `rewrite.css` 中主内容区对储藏弹层的裁剪；保留列表滚动，完成代码阅读与 Diff 核对，真实界面效果待人工确认
- [x] 4.1.2 根据用户截图补齐 `RewriteApp.vue` 顶部内边距和窗口按钮间隙的原生拖动标记；核对现有权限及 Tauri 拖动处理源码，完成代码阅读与 Diff，实际拖动和按钮交互待人工确认
- [ ] 4.2 重复问题分析是否需要公共能力/规范/自测项改进；不擅自扩大范围
- [ ] 4.3 测试反馈（如有）跟踪与回归，更新 verification/delivery
- [ ] 完成依据：问题闭环或明确阻塞；回归记录可追踪

## 5. 提测准入与交付

- [ ] 5.1 按 test-plan 准入清单逐项核对，在 `verification.md` 记录通过/失败/阻塞/未执行及证据；未执行不写通过
- [ ] 5.2 按 `delivery.md` 模板记录交付范围、修改文件、验证状态、风险、待人工步骤、上线/回滚安排
- [ ] 完成依据：交付说明可直接阅读；未授权/未执行项明确；后续事项有责任人/触发条件

## 上线后反馈与重要功能复盘安排

- [ ] 6.1 用户实际运行后收集项目/提交/Review/分支/冲突/储藏/拣选反馈；按真实问题修复并更新交付记录
- [ ] 6.2 重要功能（冲突继续、分支删除、远程同步）做复盘，记录是否需要公共能力/规范改进

> 当前阶段只完成 0.x 和 1.x 的代码实现；2.x/3.x 的真实运行与原型对照在用户授权/实际运行前保持待办，不提前勾选。压缩挑拣不纳入本次任务。
