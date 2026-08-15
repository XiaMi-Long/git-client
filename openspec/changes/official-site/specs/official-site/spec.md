# 官方站点（official-site）

## ADDED Requirements

### Requirement: 站点可构建
官方站点 SHALL 是基于 VitePress 的静态站点工程，位于仓库 `site/` 目录，提供 `dev`（本地预览）与 `build`（静态构建）脚本，且 `build` 能成功产出静态文件。

#### Scenario: 构建成功
- **WHEN** 在 `site/` 目录执行 `npm run build`
- **THEN** 站点构建成功并输出静态产物，无类型/渲染错误

### Requirement: 落地页首页
站点首页 SHALL 提供产品介绍落地页，包含产品名「GitTrail」、一句话定位、功能亮点与操作入口（使用文档 / 功能 / 下载）。

#### Scenario: 首页展示
- **WHEN** 访问站点首页
- **THEN** 页面显示 GitTrail 名称、定位语、功能亮点卡片与入口按钮

### Requirement: 功能页
站点 SHALL 提供功能页，介绍核心功能：多仓库标签页、分支管理、提交泳道图、暂存与提交、diff 阅读、cherry-pick 等。

#### Scenario: 功能页可访问
- **WHEN** 通过导航访问「功能」页
- **THEN** 页面按模块展示各项功能说明

### Requirement: 使用文档
站点 SHALL 提供使用文档（快速开始），内容覆盖环境要求、开发启动、构建发布，来源于并适配 `docs/getting-started.md`。

#### Scenario: 文档可访问
- **WHEN** 通过导航访问「使用文档」
- **THEN** 页面展示快速开始等使用说明

### Requirement: 更新日志
站点 SHALL 提供更新日志页，含面向用户的版本记录与更新/下载说明，来源于并适配 `docs/RELEASE.md`。

#### Scenario: 更新日志可访问
- **WHEN** 通过导航访问「更新日志」
- **THEN** 页面展示版本记录与更新说明

### Requirement: 品牌与暗色主题
站点 SHALL 默认暗色优先，品牌色与产品设计语言一致（主色 `#3b82f6` 系），并包含 GitTrail logo。

#### Scenario: 品牌一致
- **WHEN** 打开站点任意页面
- **THEN** 页面为暗色优先、品牌色一致，导航栏与页脚显示 GitTrail 标识
