## ADDED Requirements

### Requirement: 统一视图默认

系统 SHALL 默认以统一（unified）视图展示 diff，新增行绿底、删除行红底、hunk 头灰底。

#### Scenario: 默认统一视图

- **WHEN** 用户选中一个文件
- **THEN** diff 区以统一视图展示该文件改动

### Requirement: 双栏视图切换

系统 SHALL 提供统一 / 双栏视图切换，双栏左侧为改动前、右侧为改动后。

#### Scenario: 切换双栏

- **WHEN** 用户点击"双栏"
- **THEN** diff 区切换为左右双栏对比

### Requirement: 词级高亮

系统 SHALL 对 diff 行内改动的词级片段做高亮，而非仅整行高亮。

#### Scenario: 词级改动

- **WHEN** 某行仅个别词改动
- **THEN** 改动词片段以词级高亮色标记

### Requirement: 按文件懒加载

系统 SHALL 在用户选中某文件时才请求并加载该文件的 diff，不预加载全部文件 diff。

#### Scenario: 选中文件加载 diff

- **WHEN** 用户在文件列表选中某文件
- **THEN** 系统请求并展示该文件 diff

#### Scenario: 未选中不加载

- **WHEN** 提交详情仅展示文件列表
- **THEN** 未被选中的文件 diff 不被请求

### Requirement: 行号与换行

系统 SHALL 在 diff 行展示行号，并提供自动换行开关（默认关闭）。

#### Scenario: 行号展示

- **WHEN** diff 渲染
- **THEN** 每行展示对应行号
