# 官方站点（official-site）

## Why

GitTrail 需要一个官方站点来展示产品：产品介绍落地页、功能说明、使用文档与更新日志。用 VitePress（基于 Vite 的静态站点生成器，Vue/Vite 官方文档同款）在仓库内 `site/` 目录搭建，可整套部署到 GitHub Pages。

## What Changes

- 在仓库根新增 `site/` 目录，内含独立 VitePress 工程（独立 package.json）。
- 站点内容（中文，暗色优先、贴合产品设计语言）：
  - 落地页首页：产品名 + 定位 + 亮点 + CTA（下载/文档/功能）
  - 功能页：多仓库、分支管理、泳道图、暂存/提交、diff、cherry-pick 等
  - 使用文档：复用 `docs/getting-started.md` 改编
  - 更新日志：复用 `docs/RELEASE.md` 改编为面向用户的版本记录
- 主题定制：品牌色与产品一致（accent #3b82f6、暗色优先），导航/侧边栏/页脚。
- 提供 `npm run dev`（本地预览）与 `npm run build`（构建静态产物）脚本。

## Capabilities

### New Capabilities

- `official-site`: 官方站点 —— 基于 VitePress 的落地页/功能/文档/更新日志站点，暗色优先、品牌一致、可构建部署。

### Modified Capabilities

（无。）

## Impact

- 新增目录：`site/`（package.json、.vitepress/、index.md、features.md、guide/、changelog.md、public/）。
- 复用内容：`docs/getting-started.md`、`docs/RELEASE.md`（改编，原文保留）。
- 依赖：`site/` 内新增 devDependency `vitepress@^1.6`；不影响主工程依赖。
- 部署：静态产物可用 GitHub Pages 托管；本次不部署，仅提供可构建站点。
- 风险：站点为独立工程，主工程构建（vite.config.ts）不受影响；根 `.gitignore` 已忽略 `node_modules/`，`site/node_modules` 不会被提交。
