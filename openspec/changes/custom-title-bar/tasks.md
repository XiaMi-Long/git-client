# 自定义标题栏任务清单

## 1. 窗口配置

- [x] 1.1 将 `src-tauri/tauri.conf.json` 主窗口 `decorations` 由 `true` 改为 `false`

## 2. 标题栏组件

- [x] 2.1 新建 `src/components/layout/TitleBar.vue`：固定高度（约 32px），左侧应用图标 + 标题「Git 客户端」，根元素加 `data-tauri-drag-region`
- [x] 2.2 实现窗口控制按钮（最小化 / 最大化-还原 / 关闭），调用 `@tauri-apps/api/window` 的 `minimize` / `toggleMaximize` / `close`
- [x] 2.3 最大化状态同步：挂载时读取 `isMaximized`，监听 `onResized` 刷新，切换最大化/还原图标
- [x] 2.4 关闭按钮 hover 危险红反馈；按钮区域不继承拖拽区域
- [x] 2.5 样式全部使用设计语言 token（`--bg-panel`、`--border-default`、`--fg-*` 等），明暗主题自适应

## 3. 布局接入与验证

- [x] 3.1 在 `src/views/MainView.vue` 顶栏上方插入 `<TitleBar />`，主体布局不受影响
- [x] 3.2 本地运行验证：窗口无原生标题栏、可拖动、双击最大化、三按钮可用、边缘可调整大小、明暗主题下标题栏正常

## 4. 缺陷修复与名称统一

- [x] 4.1 在 `src-tauri/capabilities/default.json` 授权 `core:window:allow-start-dragging` / `allow-minimize` / `allow-toggle-maximize` / `allow-close`（否则拖动与按钮点击被权限系统拒绝）
- [x] 4.2 修复窗口按钮图标尺寸：`TitleBar.vue` 中 `.win-btn svg` 固定 10px
- [x] 4.3 软件名称统一为「GitTrail」：`TitleBar.vue` 标题、`tauri.conf.json` 窗口 title、`index.html` 标题与启动画面、`SettingsDialog.vue` 关于面板
- [x] 4.4 重新编译 Rust 并重启应用验证：拖动、三按钮、图标尺寸、名称显示均正常
