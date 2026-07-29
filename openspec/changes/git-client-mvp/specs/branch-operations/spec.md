## ADDED Requirements

### Requirement: 新建分支

系统 SHALL 支持基于当前 HEAD 新建分支，并可选择是否立即检出。

#### Scenario: 新建并检出

- **WHEN** 用户输入新分支名并选择立即检出
- **THEN** 系统创建分支并切换到该分支

### Requirement: 检出分支

系统 SHALL 支持检出已有分支，双击侧栏分支等效于检出。

#### Scenario: 双击检出

- **WHEN** 用户双击侧栏某分支
- **THEN** 系统检出该分支并刷新状态

#### Scenario: 工作区有未提交更改

- **WHEN** 用户检出时工作区有未提交更改且会冲突
- **THEN** 系统提示并阻止检出

### Requirement: 删除分支

系统 SHALL 支持删除分支，删除前需用户确认。

#### Scenario: 删除确认

- **WHEN** 用户对分支选择删除
- **THEN** 系统弹出确认提示，确认后删除

#### Scenario: 删除当前分支

- **WHEN** 用户尝试删除当前所在分支
- **THEN** 系统拒绝并提示"不能删除当前分支"

### Requirement: 重命名分支

系统 SHALL 支持重命名分支。

#### Scenario: 重命名

- **WHEN** 用户输入新名并确认
- **THEN** 系统重命名该分支并刷新侧栏

### Requirement: 合并到当前

系统 SHALL 支持将选中分支合并到当前分支。

#### Scenario: 合并成功

- **WHEN** 用户对某分支选择"合并到当前"
- **THEN** 系统执行合并，成功后刷新提交列表与状态

### Requirement: 领先 / 落后对比

系统 SHALL 支持分支与当前分支的领先 / 落后提交数对比。

#### Scenario: 对比展示

- **WHEN** 用户对某分支选择"与当前对比"
- **THEN** 系统展示该分支相对当前的领先 / 落后提交数
