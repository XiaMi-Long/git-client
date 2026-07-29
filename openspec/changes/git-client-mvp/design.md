## Context

全新项目，无存量代码。目标用户为本人（单一用户），日常管理多个本地 Git 仓库。现有 Git 图形客户端（Fork、SourceTree、GitKraken 等）或信息密度不足、或中文支持差、或需付费 / 登录。本项目自建一个扁平化、暗色优先、纯中文的轻量客户端，聚焦本地高频操作。

约束：

- 运行环境：Windows 11，系统已安装 git
- 单用户，无协作需求
- 仓库规模混合，需按大仓库标准设计性能

## Goals / Non-Goals

**Goals:**

- 多仓库标签页管理，每标签独立状态
- 覆盖拉取 / 推送 / 分支 CRUD / 合并 / cherry-pick / 暂存 / 提交 / 更改阅读
- 扁平化暗色界面，纯中文
- 大仓库可用（分页 + 虚拟滚动 + 懒加载 diff）
- 零配置鉴权（复用 Windows 凭据管理器）

**Non-Goals:**

- 远程仓库托管（GitHub / GitLab 集成、PR / MR）
- 子模块、LFS
- 交互式 rebase 编辑器
- 内置合并 / 冲突解决编辑器
- 多用户协作、权限管理
- 跨平台（仅 Windows）

## Decisions

### D1: Tauri 2 + Vue 3（而非 Electron）

理由：安装包小、内存占用低、Rust 后端适合做 git 进程管理与文件监听。Electron 体积过大，与"轻量自用工具"定位不符。
替代方案：Electron（生态成熟但重）、Wails（Go 后端，但 Tauri 体积优势更明显）。

### D2: shell 调用系统 git（而非 libgit2 / isomorphic-git）

理由：git CLI 功能完整、行为与命令行一致、冲突 / cherry-pick 等复杂操作无需自己实现。用户环境已装 git，零额外依赖。
替代方案：libgit2（Rust 绑定，cherry-pick / merge 支持弱）；isomorphic-git（Node 侧，功能不全）。
代价：依赖外部 git 进程，需处理路径与版本差异。

### D3: git 命令通过 Rust 后端 spawn，输出结构化解析

理由：Tauri 前端不能直接 spawn 进程；Rust 后端用 `tokio::process::Command` 调 git，按命令选择 `--porcelain` / `-z` / `--format` 等机器友好输出，解析后通过 IPC 返回结构化数据。
关键命令：`git log --format` / `git status --porcelain` / `git diff` / `git rev-parse` 等。

### D4: 状态管理 Pinia，多仓库状态隔离

理由：每个仓库标签页一个独立 store 实例（或 store 内按 repoId 分片），避免状态串扰。仓库切换时保留各自滚动位置、选中项、展开状态。

### D5: 文件监听用 notify crate + .gitignore 过滤 + 500ms 防抖

理由：notify 是 Rust 成熟的 fs 监听库；遵守 .gitignore 避免频繁触发；500ms 防抖避免批量改动时抖动。触发后只刷新工作区状态与提交列表，不全量重载。

### D6: 提交列表分页 + 虚拟滚动

理由：大仓库提交数可达数万。`git log` 按 `--skip` / `-n` 分页，每页 100 条；前端列表虚拟滚动，仅渲染可视区。mini 图谱随分页局部计算。

### D7: diff 按文件懒加载

理由：一次提交可能改动数百文件，预加载全部 diff 浪费。提交详情先加载文件列表，选中某文件才请求该文件 diff。工作区同理。

### D8: 鉴权复用 git credential helper（Windows 凭据管理器）

理由：git 默认在 Windows 上使用 manager-core 凭据助手，拉取 / 推送时自动读写凭据管理器，应用无需自建鉴权 UI。首次需登录时 git 会触发系统弹窗或终端提示。
代价：首次鉴权可能需系统弹窗，非完全无感。

### D9: 主题用 CSS 变量，不引入 i18n 框架

理由：单用户纯中文，文案硬编码中文即可，i18n 框架是过度设计。主题切换通过 `data-theme` 属性 + CSS 变量，持久化到本地配置。

### D10: 目录结构

```
git-client/
  src-tauri/          Rust 后端（git 调用、fs 监听、IPC）
    src/
      git/            git 命令封装与解析
      watcher/        文件监听
      commands/       Tauri command 处理
  src/                Vue 3 前端
    components/       通用组件
    views/            三栏主视图
    stores/           Pinia 仓库状态
    composables/      复用逻辑
    styles/           主题 token / 全局样式
  docs/               设计语言 / UI 规范（已建）
  openspec/           规范（已建）
```

## Risks / Trade-offs

- [依赖系统 git 版本] 不同 git 版本 porcelain 输出可能有差异 -> 启动时检测 git 版本，锁定最低版本要求，解析按版本分支处理
- [mini 图谱局部计算] 分页后图谱连线跨页断裂 -> 图谱按可见页 + 前后各 N 条缓冲计算，跨页连线用占位
- [首次鉴权弹窗] 首次拉取 / 推送可能弹系统凭据窗 -> 状态栏提示"正在鉴权"，不阻塞其他操作
- [大文件 diff 卡顿] 单文件 diff 过大 -> diff 区虚拟滚动，单文件超阈值时分段渲染
- [Tauri 学习成本] 本人偏前端，Rust 后端有学习成本 -> 后端保持薄，复杂逻辑尽量用 git CLI 完成，Rust 仅做进程管理与解析

## Open Questions

- 仓库标签页数量上限？是否需要内存警戒？（暂定无硬上限，按需）
- 是否需要 stash 功能？（本次不在范围，后续 change）
- 主题切换是否跟随系统？（暂定手动切换，不跟随系统）
