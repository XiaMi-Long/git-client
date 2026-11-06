# 交付记录

## 交付范围与状态

- Change：`rewrite-gittrail-ui`（frontend-team-v2）。
- 分支：`feat/ui-rewrite`。
- 开发状态：原重写代码已提交为 `55d6091`；本轮按用户 Q8 完善单个/批量项目添加提示与选择窗口错误反馈，仅做代码阅读和 Diff。
- 运行状态：2026-11-06 已确认本项目的 Tauri 桌面窗口及 1731 开发服务在运行，直接复用；未构建、未做类型检查或测试；真实添加/浏览器交互未执行。
- 代码状态：旧 UI 入口已下线，新 `RewriteApp` 挂载；旧组件文件暂留，不在新入口引用。

## 实际修改

- 新增 `src/rewrite/RewriteApp.vue` 及组件：Review、ReviewDiff、Settings、ConflictDialog、StashViewDialog。
- 新增 composables：`useProjectLayout.ts`、`useGitActions.ts`；新增作者/日期/高亮工具。
- 新增 `src/styles/rewrite.css`、`src/styles/fonts.css`、`src/assets/fonts/*.woff2`。
- 修改 `src/App.vue`、`src/main.ts`、`src/stores/theme.ts`、`src/stores/commit.ts`、`index.html`。
- 后端新增 `git_set_upstream`、`git_merge_continue` 并注册；`src-tauri/capabilities/default.json` 增加 `shell:allow-open`。
- 无手工暂存/提交 UI；冲突标记内部使用 `git add`；cherry-pick 保留，压缩挑拣不提供。
- 项目添加：保留现有单个/批量两个按钮，按入口启用系统目录单选/多选；批量标题和按钮提示说明 Ctrl/Shift 多选。补充原生窗口异常反馈，沿用重复跳过、部分失败继续、顺序保存和最终保留当前项目的逻辑；无新增 Hook、组件或后端接口。

## 验证状态

- 初次重写的 SFC/TS/CSS/JSON 历史检查保留在 `verification.md`；本轮只做代码阅读和 `git diff`，未重复执行解析检查。
- 未执行：构建、类型检查、浏览器、Playwright、真实项目添加及其他 Git 功能操作、Rust 编译；本轮 Git 提交按用户要求执行。
- 风险：新 UI 运行时/类型问题、Rust 新命令编译、Tauri shell 打开权限、真实 Git 脏工作区/冲突/网络错误、字体与视觉差异、旧组件残留引用。
- UI 原型对照（UI-C01..08）和项目添加 MF-02a 均待用户实际操作；启动项目的授权不视为浏览器或测试授权。

## 回滚与后续

- 回滚入口：将 `src/App.vue` 恢复挂载旧 `MainView`，移除 `main.ts` 的 rewrite/fonts CSS 导入；新增文件可保留。
- 后端新增命令为增量；可从 `lib.rs`/`commands::all_commands` 移除注册回退。
- 下一步：用户在当前应用中按 MF-02a 验证单个添加及 Ctrl/Shift 多选添加，再按需验证其余主流程；真实结果和报错反馈后更新 verification。未收到反馈前不提前标记体验验收或上线完成。
- 未决业务：新建储藏默认全部改动（Q6 可撤回假设）；CSS/原型未覆盖的细节按 specs 验收。
