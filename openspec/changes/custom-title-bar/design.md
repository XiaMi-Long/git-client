# 自定义标题栏设计

## Context

- 应用为 Tauri 2 + Vue 3 桌面 Git 客户端，暗色优先、扁平化设计（见 `docs/design-language.md`）。
- 当前窗口配置 `decorations: true`，使用系统原生标题栏，与 UI 风格割裂。
- 前端已建立 `MainView` 布局：顶栏 40px + 三栏主体 + 状态栏 24px。本次在其顶部新增独立一行标题栏。
- 设计语言约定：UI 字号 13px、圆角 2px、线性图标（stroke 1.5、16px）、动效仅颜色/透明度 150ms ease、色彩全部走 CSS 变量。

## Goals / Non-Goals

**Goals:**
- 去掉系统原生标题栏，改为应用内自绘。
- 新增独立一行（约 32px）标题栏：应用图标 + 标题 + 最小化 / 最大化(还原) / 关闭。
- 标题栏可拖动窗口；支持双击最大化/还原；窗口仍可边缘调整大小。
- 最大化状态图标实时同步（最大化 ↔ 还原）。
- 全部使用设计 token，明暗主题自动适配。

**Non-Goals:**
- 不合并进现有 40px 顶栏（用户已确认采用单独一行方案）。
- 不做系统任务栏进度 / 图标控制。
- 不引入窗口状态持久化（记忆上次尺寸/位置）——后续可另立变更。
- 不做 macOS / Linux 专属标题栏（当前仅 Windows 为目标运行环境）。

## Decisions

**D1. 无边框方式：`decorations: false`**
在 `tauri.conf.json` 窗口配置中把 `decorations` 改为 `false`，保留 `resizable: true` 与 `minWidth`/`minHeight`。
- 备选：`titleBarStyle: "Overlay"`（仅 macOS 有效，且仍显示原生按钮），不适用于当前 Windows 目标 → 排除。
- 说明：Tauri v2 在 Windows 上对无边框可调整窗口默认提供边缘 resize 边框（`resizeInset` 默认开启），拖拽调整大小不受影响。

**D2. 窗口拖拽：`data-tauri-drag-region` 属性**
标题栏根元素（除按钮区域外）加 `data-tauri-drag-region`，由 Tauri 处理窗口拖动与双击最大化/还原，无需自定义 mousedown 逻辑。
- 窗口按钮（最小化/最大化/关闭）容器不继承拖拽区域，避免与点击冲突。

**D3. 窗口控制：`@tauri-apps/api/window`**
使用 `getCurrentWindow()` 的 `minimize()` / `toggleMaximize()` / `close()` / `isMaximized()`，并监听 `onResized` 事件刷新最大化状态，切换最大化/还原图标。
- 复用现有 `@tauri-apps/api` 依赖，不新增依赖。
- 备选：监听 `tauri://resize` 事件 → 需手写事件名，官方 `onResized` API 更稳。

**D4. 图标风格**
窗口按钮图标沿用 Windows 惯例的细线小图标（10px viewBox、stroke 1，currentColor），与扁平克制风格一致；关闭按钮 hover 用标准危险红 `#e81123` 底 + 白图标，符合桌面习惯。
- 设计语言 §8 的 16px 线性图标用于功能图标；窗口按钮为系统控制元素，按惯例使用紧凑 10px 字形。

**D5. 布局接入**
`MainView.vue` 在 `<TopBar />` 上方插入 `<TitleBar />`，标题栏 `flex-shrink: 0` 固定高度，主体三栏继续占满剩余空间，不受影响。

## Risks / Trade-offs

- [无边框后边缘调整大小失效] → Tauri v2 Windows 默认 `resizeInset` 提供隐形边缘，实测保留；若某平台异常，可后续用 `onResizeStart` 补偿或调大 `resizeInset`。
- [拖拽区域与顶部交互冲突] → 标题栏与顶栏分离为两行，顶栏内容（标签页/搜索/按钮）不在拖拽区内，互不影响。
- [双击最大化行为依赖平台] → Windows 上 Tauri 对 `data-tauri-drag-region` 原生支持双击切换最大化；如需跨平台统一，后续可在组件内显式监听 `dblclick`。
- [窗口最大化后标题栏被遮挡 / 圆角] → 无边框窗口无圆角裁剪问题，无需处理。

## Migration Plan

1. 改 `tauri.conf.json` 的 `decorations: false`。
2. 新增 `TitleBar.vue` 并在 `MainView.vue` 接入。
3. 本地 `npm run tauri dev` 验证：拖拽、双击最大化、三按钮、边缘调整大小、明暗主题。
4. 回滚：将 `decorations` 改回 `true` 并移除 `<TitleBar />` 即可恢复原生标题栏。

## Open Questions

- 无（用户已确认范围与布局；如需任务栏进度等能力，另行变更）。
