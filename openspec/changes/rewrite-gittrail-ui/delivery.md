# 交付记录

## 交付范围与状态

- Change：`rewrite-gittrail-ui`（frontend-team-v2）。
- 分支：`feat/ui-rewrite`。
- 开发状态：代码实现完成；静态语法/模板检查通过。
- 运行状态：未启动；未构建；未做类型检查；真实 Git/浏览器交互未执行。
- 代码状态：旧 UI 入口已下线，新 `RewriteApp` 挂载；旧组件文件暂留，不在新入口引用。

## 实际修改

- 新增 `src/rewrite/RewriteApp.vue` 及组件：Review、ReviewDiff、Settings、ConflictDialog、StashViewDialog。
- 新增 composables：`useProjectLayout.ts`、`useGitActions.ts`；新增作者/日期/高亮工具。
- 新增 `src/styles/rewrite.css`、`src/styles/fonts.css`、`src/assets/fonts/*.woff2`。
- 修改 `src/App.vue`、`src/main.ts`、`src/stores/theme.ts`、`src/stores/commit.ts`、`index.html`。
- 后端新增 `git_set_upstream`、`git_merge_continue` 并注册；`src-tauri/capabilities/default.json` 增加 `shell:allow-open`。
- 无手工暂存/提交 UI；冲突标记内部使用 `git add`；cherry-pick 保留，压缩挑拣不提供。

## 验证状态

- 静态 SFC 解析、TS 语法、CSS 结构、capability JSON、`git diff` 已完成；见 `verification.md`。
- 未执行：构建、`vue-tsc`、Tauri 启动、浏览器、Playwright、真实仓库操作、Rust 编译。
- 风险：新 UI 运行时/类型问题、Rust 新命令编译、Tauri shell 打开权限、真实 Git 脏工作区/冲突/网络错误、字体与视觉差异、旧组件残留引用。
- UI 原型对照（UI-C01..08）待用户实际运行；当前没有浏览器/运行授权。

## 回滚与后续

- 回滚入口：将 `src/App.vue` 恢复挂载旧 `MainView`，移除 `main.ts` 的 rewrite/fonts CSS 导入；新增文件可保留。
- 后端新增命令为增量；可从 `lib.rs`/`commands::all_commands` 移除注册回退。
- 下一步：用户运行应用，优先验证项目/提交/Review/设置主流程，再验证分支、远程、冲突、储藏、cherry-pick；将真实报错回报后修复并更新 verification。
- 未决业务：新建储藏默认全部改动（Q6 可撤回假设）；CSS/原型未覆盖的细节按 specs 验收。
