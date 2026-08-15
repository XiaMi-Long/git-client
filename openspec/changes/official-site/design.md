# 官方站点 设计

## Context

- 产品 GitTrail：Tauri 2 + Vue 3 桌面 Git 客户端，扁平化、暗色优先、纯中文（见 `docs/design-language.md`）。
- 现有文档 `docs/getting-started.md`（启动指南）、`docs/RELEASE.md`（发布流程）可改编为站点内容。
- 无既有站点脚手架。

## Goals / Non-Goals

**Goals:**
- 用 VitePress 建一个可构建、可部署的静态官方站点，暗色优先、品牌一致。
- 覆盖落地页 / 功能 / 使用文档 / 更新日志四类内容。
- 复用现有 docs 内容，避免重复编写。

**Non-Goals:**
- 不部署到 GitHub Pages（本次仅交付可构建站点，部署后续单独做）。
- 不做多语言（当前仅中文）。
- 不改动主工程构建与依赖。

## Decisions

**D1. 工具：VitePress 1.x**
基于 Vite、Vue 生态契合（本项目前端为 Vue 3），MD 即页面、默认主题 + 可定制 CSS、GitHub Pages 部署简单。备选 Astro/VuePress 2 见与用户讨论记录，均排除（前者文档站配置更重，后者更老更慢）。

**D2. 目录：仓库内 `site/` 独立工程**
独立 package.json，`devDependencies` 仅 `vitepress`。脚本：`dev` / `build` / `preview`。根 `.gitignore` 的 `node_modules/` 规则已覆盖 `site/node_modules`。

**D3. 页面与导航**
- `index.md`：`layout: home` 落地页（hero + 首页 features + CTA + 附加内容区）。
- `features.md`：功能总览（按模块分组说明）。
- `guide/getting-started.md`：改编 `docs/getting-started.md`。
- `changelog.md`：改编 `docs/RELEASE.md` 为面向用户的版本记录 + 更新说明。
- 导航：首页 / 功能 / 使用文档 / 更新日志；`/guide/` 下配侧边栏。

**D4. 主题与品牌**
- `config.mts`：`lang: zh-CN`、`appearance: 'dark'`（默认暗色可切换）、`title: GitTrail`。
- `theme/style.css`：把 VitePress 品牌变量对齐产品设计语言（`--vp-c-brand-1: #3b82f6` 等），并微调 hero/feature/按钮样式；暗色背景用 `--bg-base #1e1e1e` 系。
- `public/logo.svg`：GitTrail 线性 logo（git branch + trail 意象，品牌蓝）。

**D5. 内容改编**
- getting-started：标题改 GitTrail、链接改为站内相对路径、端口 1420→1731 修正。
- changelog：保留发布/更新原理的简明版 + 版本历史（从 git log 提炼主要版本）+ 指向 GitHub Releases 的下载链接。

## Risks / Trade-offs

- [VitePress 版本漂移] → 锁定 `^1.6.4`，build 验证通过即交付。
- [站点构建依赖网络安装] → `npm install` 在 site/ 内进行；失败则报告，不影响主工程。
- [默认主题观感与产品设计语言有差距] → 通过 CSS 变量与自定义样式收敛品牌色，必要时后续迭代自定义 Vue 首页组件。

## Migration Plan

1. `site/` 骨架 + config + theme + 四类页面 + logo。
2. `npm install`（site/）→ `npm run build` 验证。
3. 提交推送；后续可在 GitHub Actions 配置 Pages 部署（本次不做）。

## Open Questions

- 无。
