## Why

自用的桌面端 Git 客户端，需要一个界面扁平化、信息密度高、纯中文、暗色优先的工具，覆盖日常 Git 操作（拉取 / 推送 / 分支 / 暂存 / 提交 / cherry-pick / 更改阅读）。现有工具要么信息密度不足、要么中文支持差、要么功能臃肿。本项目面向本人单一用户，去掉协作与远程托管类功能，聚焦本地高频操作。

## What Changes

- 新建 Tauri 2 + Vue 3 桌面应用，通过 shell 调用系统 git
- 多仓库标签页，每标签独立状态 + 文件监听（遵守 .gitignore，500ms 防抖）
- Fork 式三栏布局：侧栏（分支 / 远程 / 标签）/ 纯提交列表（mini 图谱 + 分页 + 虚拟滚动）/ 右侧上下分栏（文件列表 + diff）
- 工作区伪节点钉顶，点击进入工作区模式，提交框出现在右侧底部
- 暂存粒度：文件级 + hunk 级；diff 默认统一视图，可切双栏，词级高亮
- 远程：拉取 / 推送，鉴权走 Windows 凭据管理器
- 分支：新建 / 检出 / 删除 / 重命名 + 合并到当前 + 领先 / 落后对比
- cherry-pick 提交
- 冲突：检测 + 列表 + 继续 / 中止，不内置合并编辑器
- 搜索：同时匹配提交信息 / 作者 / 哈希
- 主题：暗色默认 + 亮色可切；纯中文，不引入 i18n 框架
- 大仓库标准：git log 分页、虚拟滚动、按文件懒加载 diff

## Capabilities

### New Capabilities

- `repository-management`: 多仓库标签页、打开 / 切换仓库、文件系统监听与自动刷新、仓库连接状态
- `commit-history`: 提交列表展示、分支 mini 图谱、分页 + 虚拟滚动、提交搜索（信息 / 作者 / 哈希）
- `working-area`: 工作区伪节点、暂存 / 取消暂存（文件级 + hunk 级）、提交信息输入与提交、工作区模式切换
- `diff-viewer`: diff 展示（统一视图 / 双栏切换、词级高亮、按文件懒加载）
- `branch-operations`: 分支新建 / 检出 / 删除 / 重命名、合并到当前、领先 / 落后对比、侧栏浏览与检出交互
- `remote-sync`: 拉取、推送、Windows 凭据管理器鉴权、领先 / 落后状态
- `cherry-pick`: 对任意提交执行 cherry-pick
- `conflict-handling`: 拉取 / 合并 / cherry-pick 冲突检测、冲突文件列表、继续 / 中止
- `theme-and-locale`: 暗色 / 亮色主题切换、纯中文界面

### Modified Capabilities

（无，本项目为全新应用）

## Impact

- 新项目目录 `D:\项目文件夹\git-client`，无存量代码影响
- 依赖：Tauri 2、Vue 3、系统 git（用户环境自带）
- 平台：Windows 11（本机），鉴权依赖 Windows 凭据管理器
- 设计基线：`docs/design-language.md`、`docs/ui-spec.md`（项目级长期参考）
- 不涉及：远程仓库托管、PR / MR、子模块、LFS、交互式 rebase 编辑器、内置合并工具
