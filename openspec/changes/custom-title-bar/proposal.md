# 自定义标题栏（custom-title-bar）

## Why

当前窗口使用系统原生标题栏（`decorations: true`），与应用的扁平化、暗色优先设计风格割裂，且挤占顶部空间。需要去掉原生边框，改用应用内自绘的标题栏，使窗口外观与整体 UI 统一，并支持主题切换。

## What Changes

- 将 `src-tauri/tauri.conf.json` 窗口配置改为无边框（`decorations: false`），仍保持可调整大小。
- 新增独立一行自定义标题栏组件 `TitleBar.vue`（约 32px），位于现有顶栏（TopBar）上方。
- 标题栏包含：应用图标 + 应用标题「GitTrail」、窗口拖拽区域、最小化 / 最大化（还原） / 关闭按钮。
- 窗口按钮调用 Tauri 窗口 API 实现最小化、最大化/还原、关闭；最大化状态变化时按钮图标同步切换。
- 在应用能力配置（`capabilities/default.json`）中授权 `core:window:allow-start-dragging` / `allow-minimize` / `allow-toggle-maximize` / `allow-close`，否则拖拽与按钮点击会被权限系统拒绝。
- 软件名称统一为「GitTrail」（标题栏、窗口标题、启动画面、关于面板）。
- 关闭按钮 hover 采用危险色反馈（红色），符合桌面惯例。
- 标题栏整体为拖拽区域，可拖动窗口；保留系统边缘拖拽调整窗口大小能力。
- 标题栏颜色、字号、圆角均使用设计语言 token，随明暗主题自动切换。

## Capabilities

### New Capabilities

- `window-title-bar`: 自定义窗口标题栏 —— 无边框窗口、自绘标题栏、窗口控制按钮（最小化/最大化/还原/关闭）、窗口拖拽区域、最大化状态同步。

### Modified Capabilities

（无。现有能力均为 MVP 业务功能，不涉及窗口外壳行为。）

## Impact

- 后端配置：`src-tauri/tauri.conf.json`（窗口 `decorations` 由 `true` 改为 `false`、标题统一为「码迹」）。
- 能力配置：`src-tauri/capabilities/default.json`（新增 4 项窗口权限）。
- 前端布局：`src/views/MainView.vue`（顶部插入 `<TitleBar />`），`src/components/layout/TopBar.vue` 保持不变。
- 新增组件：`src/components/layout/TitleBar.vue`。
- 名称统一：`index.html`（标题 + 启动画面）、`src/components/layout/SettingsDialog.vue`（关于面板）。
- 依赖：复用既有 `@tauri-apps/api`（`window` 模块），无需新增依赖。
- 风险：能力权限需重新编译 Rust 后生效，否则拖动/按钮仍被拒绝；Windows 下无边框窗口需确认边缘拖拽调整大小与双击最大化行为仍可用。
