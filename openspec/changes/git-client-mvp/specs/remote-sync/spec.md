## ADDED Requirements

### Requirement: 拉取

系统 SHALL 提供拉取操作（快捷键 Ctrl+P），从当前分支对应远程分支拉取并合并。

#### Scenario: 拉取成功

- **WHEN** 用户点击拉取
- **THEN** 系统执行拉取，成功后刷新提交列表与状态栏

#### Scenario: 无远程

- **WHEN** 当前分支无对应远程
- **THEN** 系统提示"当前分支未设置远程"

### Requirement: 推送

系统 SHALL 提供推送操作（快捷键 Ctrl+Shift+P），推送当前分支到远程。

#### Scenario: 推送成功

- **WHEN** 用户点击推送
- **THEN** 系统执行推送，成功后刷新领先 / 落后状态

### Requirement: 凭据管理器鉴权

系统 SHALL 复用 git 在 Windows 上的凭据助手（凭据管理器）完成鉴权，不自建鉴权 UI。

#### Scenario: 首次鉴权

- **WHEN** 首次拉取 / 推送需要凭据
- **THEN** 系统交由 git 凭据助手处理，状态栏提示"正在鉴权"

### Requirement: 领先 / 落后状态

系统 SHALL 在状态栏展示当前分支相对远程的领先 / 落后提交数。

#### Scenario: 领先落后展示

- **WHEN** 本地与远程存在差异
- **THEN** 状态栏显示"领先 X 落后 Y"
