## ADDED Requirements

### Requirement: cherry-pick 提交

系统 SHALL 支持对提交列表中任意提交执行 cherry-pick，入口为提交项右键菜单。

#### Scenario: cherry-pick 成功

- **WHEN** 用户对某提交选择 cherry-pick
- **THEN** 系统将该提交的更改应用到当前分支，成功后刷新工作区与列表

#### Scenario: cherry-pick 产生冲突

- **WHEN** cherry-pick 过程中产生冲突
- **THEN** 系统转入冲突处理流程，工作区标记冲突文件
