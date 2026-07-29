## ADDED Requirements

### Requirement: 打开本地仓库

系统 SHALL 允许用户通过选择本地目录打开一个 Git 仓库，并验证该目录存在 `.git`。

#### Scenario: 打开有效仓库

- **WHEN** 用户点击 [+] 选择一个包含 .git 的目录
- **THEN** 系统新建一个仓库标签页并加载该仓库的分支与状态

#### Scenario: 打开非仓库目录

- **WHEN** 用户选择的目录不含 .git
- **THEN** 系统提示"所选目录不是 Git 仓库"且不创建标签页

### Requirement: 多仓库标签页

系统 SHALL 支持同时打开多个仓库标签页，每个标签页维护独立的状态（选中分支、滚动位置、展开状态）。

#### Scenario: 切换标签页保留状态

- **WHEN** 用户从标签 A 切换到标签 B 再切回 A
- **THEN** 标签 A 的提交列表滚动位置与选中项保持不变

#### Scenario: 关闭标签页

- **WHEN** 用户关闭某仓库标签页
- **THEN** 该标签页状态被释放，文件监听停止

### Requirement: 文件系统监听与自动刷新

系统 SHALL 监听仓库工作区文件变更（遵守 .gitignore），并以 500ms 防抖触发工作区状态与提交列表的自动刷新。

#### Scenario: 工作区文件变更

- **WHEN** 仓库工作区内 .gitignore 忽略以外的文件发生增删改
- **THEN** 系统在 500ms 防抖后刷新工作区文件状态

#### Scenario: 忽略文件不触发

- **WHEN** 被 .gitignore 匹配的文件发生变更
- **THEN** 系统不触发刷新

### Requirement: 仓库连接状态展示

系统 SHALL 在状态栏展示当前仓库与远程的连接状态及远程分支名。

#### Scenario: 已配置远程

- **WHEN** 当前仓库存在 remote
- **THEN** 状态栏显示"已连接 origin/<分支>"或对应远程名

#### Scenario: 无远程

- **WHEN** 当前仓库未配置 remote
- **THEN** 状态栏显示"无远程"
