## ADDED Requirements

### Requirement: 冲突检测

系统 SHALL 在拉取 / 合并 / cherry-pick 后检测是否产生冲突。

#### Scenario: 检测到冲突

- **WHEN** 操作后 git 报告冲突
- **THEN** 系统进入冲突状态，文件列表标记冲突文件 ⚠

### Requirement: 冲突文件列表

系统 SHALL 在冲突状态下展示冲突文件列表，每个冲突文件可标记为已解决。

#### Scenario: 标记已解决

- **WHEN** 用户对冲突文件点击"标记已解决"
- **THEN** 该文件移出冲突列表

### Requirement: 继续与中止

系统 SHALL 在冲突状态下于状态栏提供"继续"与"中止"操作。

#### Scenario: 全部解决后继续

- **WHEN** 所有冲突文件标记已解决且用户点击"继续"
- **THEN** 系统完成原操作（merge / cherry-pick）并刷新

#### Scenario: 中止

- **WHEN** 用户点击"中止"
- **THEN** 系统中止原操作，恢复到操作前状态

### Requirement: 不内置合并编辑器

系统 SHALL 不提供内置合并 / 冲突解决编辑器，冲突内容编辑由外部工具完成。

#### Scenario: 提示外部解决

- **WHEN** 用户查看冲突文件
- **THEN** 系统展示冲突标记内容，提示用户用外部编辑器解决后标记已解决
