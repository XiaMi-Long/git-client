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
- [ ] 3.3 提交并推送到远程
