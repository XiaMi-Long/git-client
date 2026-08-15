# 官方站点 任务清单

## 1. 站点骨架

- [x] 1.1 创建 `site/package.json`（vitepress 依赖 + dev/build/preview 脚本）
- [x] 1.2 创建 `site/.vitepress/config.mts`（zh-CN、暗色优先、导航/侧边栏/页脚）
- [x] 1.3 创建 `site/.vitepress/theme/style.css`（品牌色对齐设计语言）与 theme 入口
- [x] 1.4 创建 `site/public/logo.svg`（GitTrail logo）

## 2. 页面内容

- [x] 2.1 落地页 `site/index.md`（layout: home：hero + 功能亮点 + CTA + 附加内容）
- [x] 2.2 功能页 `site/features.md`
- [x] 2.3 使用文档 `site/guide/getting-started.md`（改编 docs/getting-started.md）
- [x] 2.4 更新日志 `site/changelog.md`（改编 docs/RELEASE.md + 版本历史）

## 3. 验证与交付

- [x] 3.1 `site/` 内 `npm install` 成功
- [x] 3.2 `site/` 内 `npm run build` 成功产出静态产物
- [x] 3.3 提交并推送到远程

## 4. 用户向改造、截图占位与 Pages 部署

- [x] 4.1 站点文档去除开发内容（环境要求/安装依赖/开发启动/构建发布/目录结构），改为纯用户下载使用向（下载安装/首次使用/常用操作/自动更新/用户 FAQ）
- [x] 4.2 更新日志去除面向维护者的「发布说明」开发内容，保留用户向版本记录
- [x] 4.3 首页新增产品截图区：`ScreenshotGrid` 组件（放 `site/public/screenshots/<id>.png` 即显示，缺失显示虚线占位），并调整首页下载入口
- [x] 4.4 配置 `base: "/git-client/"`（GitHub Pages 子路径）并修正 favicon 路径
- [x] 4.5 新增 GitHub Actions 部署 workflow（`.github/workflows/deploy-site.yml`：build → upload-pages-artifact → deploy-pages）
- [x] 4.6 `site/` 内 `npm run build` 重新验证通过
- [x] 4.7 提交并推送到远程
