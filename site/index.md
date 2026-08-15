---
layout: home

hero:
  name: GitTrail
  text: 扁平化 · 暗色优先 · 纯中文的桌面 Git 客户端
  tagline: 多仓库标签页 · 分支管理 · 提交泳道图 · 暂存/提交 · diff 阅读 · cherry-pick
  image:
    src: /logo.svg
    alt: GitTrail
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 功能一览
      link: /features
    - theme: alt
      text: 更新日志
      link: /changelog

features:
  - icon: 🗂️
    title: 多仓库标签页
    details: 同时打开多个仓库，横向标签快速切换，每个仓库的分支、状态独立管理。
  - icon: 🌿
    title: 分支管理
    details: 新建 / 检出 / 删除 / 重命名 / 合并 / 对比，右键直达，切换自动暂存。
  - icon: 📈
    title: 提交泳道图
    details: 按作者列分泳道，一眼看清提交节奏；本地未推送提交高亮标识。
  - icon: 📥
    title: 暂存与提交
    details: 文件级 + hunk 级暂存，工作区状态一目了然，快捷提交（Ctrl+Enter）。
  - icon: 📄
    title: diff 阅读
    details: 统一 / 双栏 / 词级高亮三种视图，细粒度阅读每一次更改。
  - icon: 🍒
    title: cherry-pick
    details: 右键快速挑选提交，压缩挑拣一步到位，冲突处理有引导。
---

## 为什么选择 GitTrail

面向**本地高频 Git 操作**的轻量桌面客户端，去掉了协作与远程托管类冗余，聚焦你要的那几件事：

- **纯中文**：术语统一，无中英混杂。
- **信息密度高**：三栏布局 + 虚拟滚动 + 提交泳道图，单位面积承载更多有效信息。
- **暗色优先**：扁平化视觉，长时间使用不刺眼，明暗一键切换。
- **安静可靠**：文件监听自动刷新、窗口聚焦即拉取更新、静默自动升级。

## 快速上手

1. 前往 [GitHub Releases](https://github.com/XiaMi-Long/git-client/releases) 下载安装包（或自行从源码构建）。
2. 打开应用，点击顶栏 **「+」** 添加你的 Git 仓库。
3. 拉取 / 提交 / 推送，查看提交泳道图与更改 diff。

更多说明见 [快速开始](/guide/getting-started)。

## 开源

GitTrail 基于 [Tauri 2](https://tauri.app) + [Vue 3](https://vuejs.org)，遵循 MIT 协议开源：

- 源码仓库：[XiaMi-Long/git-client](https://github.com/XiaMi-Long/git-client)
