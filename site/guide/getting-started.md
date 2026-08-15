# 快速开始

> GitTrail：自用桌面 Git 客户端，Tauri 2 + Vue 3，通过系统 git 执行操作。

## 环境要求

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | 18+（推荐 22） | 前端构建 |
| Rust 工具链 | 稳定版 | 通过 [rustup](https://rustup.rs) 安装，后端编译 |
| git | 任意现代版本 | 系统 PATH 中，应用通过 shell 调用 |
| WebView2 | - | Windows 11 自带 |
| Visual Studio Build Tools | - | 含"使用 C++ 的桌面开发"（提供 MSVC link.exe） |

## 安装依赖

```bash
npm install
```

## 开发启动

```bash
npm run tauri dev
```

首次会编译 Rust 依赖（约 1-2 分钟），完成后自动打开桌面窗口。
开发模式默认打开 DevTools（F12）。

> 改动前端会 HMR 热更新；改动 Rust（`src-tauri/`）需重启 `npm run tauri dev`。

## 构建发布

```bash
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/`。已安装版本可通过应用内自动更新（GitHub Releases + 签名校验）。

## 下载安装

前往 [GitHub Releases](https://github.com/XiaMi-Long/git-client/releases) 下载 `git-client_x.x.x_x64-setup.exe` 安装包，或从源码自行构建。

## 目录结构

```
git-client/
├─ src/                Vue 前端
│  ├─ components/      组件（layout/ 下为三栏布局组件）
│  ├─ stores/          Pinia 状态（repo / commit / selection / theme / settings）
│  ├─ composables/     复用逻辑（useResizable / useRepoWatcher）
│  ├─ types/           TypeScript 类型（与后端 serde 对齐）
│  ├─ styles/          tokens.css 设计 token + main.css 全局样式
│  └─ views/           MainView 三栏主视图
├─ src-tauri/          Rust 后端
│  ├─ src/
│  │  ├─ git/          git 命令封装（executor / status / log / diff / branch / remote / types）
│  │  ├─ commands/     Tauri command（前端 invoke 入口）
│  │  └─ watcher/      文件监听（notify + .gitignore + 防抖）
│  ├─ capabilities/    Tauri 权限配置
│  └─ tauri.conf.json  Tauri 配置
├─ docs/               设计语言 + UI 规范 + 发布指南
├─ openspec/           需求规范（proposal / design / specs / tasks）
└─ site/               官方站点（本站点，VitePress）
```

## 常见问题

| 问题 | 解决 |
|---|---|
| `cargo` 无法识别 | rustup 装完重启终端；或 PowerShell 临时加 `$env:PATH += ";$env:USERPROFILE\.cargo\bin"` |
| `link.exe` 未找到 | 装 Visual Studio Build Tools，勾选"使用 C++ 的桌面开发" |
| 端口 1731 被占用 | 关闭占用进程，或重启释放 |
| 拉取/推送鉴权失败 | 首次会走 Windows 凭据管理器；若失败检查凭据或用 `git credential-manager` 配置 |
| 前端改了没生效 | HMR 通常自动更新；Pinia store 改动有时需刷新页面 |

## 相关链接

- [GitHub 仓库](https://github.com/XiaMi-Long/git-client)
- [功能一览](/features)
- [更新日志](/changelog)
